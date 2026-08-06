"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { motion } from "framer-motion"
import { useRouter, useSearchParams } from "next/navigation"
import { useActiveAccount } from "thirdweb/react"
import { client, apeChain } from "@/lib/thirdweb"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { MergeMachine } from "./merge-machine"
import { BatterySelector } from "./battery-selector"
import { ProfileModal } from "@/components/profile-modal"
import { AlertModal } from "@/components/alert-modal"
import { useBatchTransfer } from "@/hooks/useBatchTransfer"
import { useShardTransfer } from "@/hooks/useShardTransfer"
import { batteryUrl } from "@/lib/media"

export type BatteryItem = {
    id: string
    name: string
    image: string
    tokenId: string
    batteryType: 'Standard' | 'Super'
    metadata?: any
}

const BATTERY_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || ""

function MergeMechanismContent() {
    const account = useActiveAccount()
    const router = useRouter()
    const searchParams = useSearchParams()

    // Tab State
    const initialMode = searchParams.get('tab') === 'shards' ? 'shards' : 'batteries'
    const [mode, setMode] = useState<'batteries' | 'shards'>(initialMode)

    // Batteries State
    const [batteries, setBatteries] = useState<BatteryItem[]>([])
    const [selectedBatteries, setSelectedBatteries] = useState<BatteryItem[]>([])
    const [isLoading, setIsLoading] = useState(true)

    // Shards State
    const [shardBalance, setShardBalance] = useState(0)
    const [selectedShardIndices, setSelectedShardIndices] = useState<Set<number>>(new Set())
    const [isLoadingShards, setIsLoadingShards] = useState(true)
    const [shardImageUrl, setShardImageUrl] = useState<string | null>(null)

    // Modal states
    const [isProfileOpen, setIsProfileOpen] = useState(false)
    const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')
    const [showConfirmModal, setShowConfirmModal] = useState(false)

    // Merge process states
    const [isMerging, setIsMerging] = useState(false)
    const [mergeSuccess, setMergeSuccess] = useState(false)
    const [mergeError, setMergeError] = useState<string | null>(null)
    const [isBulkMerge, setIsBulkMerge] = useState(false)

    // Transfer hooks
    const { transferBatch, isLoading: isTransferring } = useBatchTransfer(BATTERY_CONTRACT_ADDRESS)
    const { transferShards, isLoading: isTransferringShards } = useShardTransfer()

    // ──────────────────────────────────────────────────────────
    // FETCHING LOGIC
    // ──────────────────────────────────────────────────────────

    const fetchBatteries = useCallback(async () => {
        setIsLoading(true)
        if (!account?.address) {
            setBatteries([])
            setSelectedBatteries([])
            setIsLoading(false)
            return
        }
        try {
            // Same RPC-free path as the dashboard and upgrade module: the
            // indexer plus one DB query, instead of getOwnedNFTs (which costs a
            // thirdweb RPC call per token) and a metadata fetch per battery.
            const res = await fetch(`/api/owned-batteries?owner=${account.address}`, { cache: 'no-store' })
            const json = res.ok ? await res.json() : {}
            const loadedBatteries = (json?.batteries || []).map((b: any) => ({
                id: b.tokenId,
                tokenId: b.tokenId,
                name: b.name,
                image: b.image,
                batteryType: b.batteryType as 'Standard' | 'Super',
                metadata: b.metadata || {},
            }))
            // Merging consumes Standard batteries only.
            setBatteries(loadedBatteries.filter((b: any) => b.batteryType === 'Standard'))
        } catch (error) {
            console.error("Error loading batteries:", error)
        } finally {
            setIsLoading(false)
        }
    }, [account?.address])

    const fetchShards = useCallback(async () => {
        setIsLoadingShards(true)
        if (!account?.address) {
            setShardBalance(0)
            setSelectedShardIndices(new Set())
            setIsLoadingShards(false)
            return
        }
        try {
            const res = await fetch(`/api/merge/shards-balance?wallet=${account.address}`, { cache: 'no-store' })
            if (res.ok) {
                const data = await res.json()
                setShardBalance(data.balance || 0)
                if (data.imageUrl) setShardImageUrl(data.imageUrl)
            }
        } catch (error) {
            console.error("Failed to fetch shards:", error)
        } finally {
            setIsLoadingShards(false)
        }
    }, [account?.address])

    useEffect(() => {
        fetchBatteries()
        fetchShards()
    }, [account?.address, fetchBatteries, fetchShards])



    // Update URL when mode changes
    useEffect(() => {
        if (mode === 'shards') {
            router.replace('/merge_mechanism?tab=shards', { scroll: false })
            setSelectedBatteries([])
        } else {
            router.replace('/merge_mechanism', { scroll: false })
            setSelectedShardIndices(new Set())
        }
        // If the user had just merged and switches tab, reset the success screen
        // so the result card doesn't visually flip to wrong battery type
        setMergeSuccess(false)
    }, [mode, router])

    // ──────────────────────────────────────────────────────────
    // SELECTION HANDLERS
    // ──────────────────────────────────────────────────────────

    const handleToggleSelect = useCallback((battery: BatteryItem) => {
        if (mode !== 'batteries') setMode('batteries')
        setSelectedBatteries(prev => {
            if (prev.some(b => b.id === battery.id)) return prev.filter(b => b.id !== battery.id)
            if (prev.length < 20) return [...prev, battery]
            return prev
        })
    }, [mode])

    const handleSelect20 = useCallback(() => {
        if (mode !== 'batteries') setMode('batteries')
        const available = batteries.filter(b => !selectedBatteries.some(s => s.id === b.id))
        const toSelect = available.slice(0, 20 - selectedBatteries.length)
        setSelectedBatteries(prev => [...prev, ...toSelect].slice(0, 20))
    }, [batteries, selectedBatteries, mode])

    const handleDeselectAll = useCallback(() => setSelectedBatteries([]), [])

    // Toggle a specific shard index on/off
    const handleShardToggle = useCallback((index: number) => {
        if (mode !== 'shards') setMode('shards')
        setIsBulkMerge(false)
        setSelectedShardIndices(prev => {
            const next = new Set(prev)
            if (next.has(index)) {
                next.delete(index)
            } else if (next.size < 30) {
                next.add(index)
            }
            return next
        })
    }, [mode])

    // Select up to N shards at once (for "Select 30" button)
    const handleShardSelectMany = useCallback((count: number) => {
        if (mode !== 'shards') setMode('shards')
        setIsBulkMerge(false)
        const indices = Array.from({ length: Math.min(count, shardBalance) }, (_, i) => i)
        setSelectedShardIndices(new Set(indices))
    }, [mode, shardBalance])

    // Select maximum shards (largest multiple of 30)
    const handleShardSelectMaximum = useCallback(() => {
        if (mode !== 'shards') setMode('shards')
        const maxShards = Math.floor(shardBalance / 30) * 30
        if (maxShards <= 0) return
        const indices = Array.from({ length: maxShards }, (_, i) => i)
        setSelectedShardIndices(new Set(indices))
        setIsBulkMerge(maxShards > 30)
    }, [mode, shardBalance])

    const handleShardDeselectAll = useCallback(() => {
        setSelectedShardIndices(new Set())
        setIsBulkMerge(false)
    }, [])

    // ──────────────────────────────────────────────────────────
    // MERGE EXECUTION
    // ──────────────────────────────────────────────────────────

    const handleStartMerge = useCallback(() => {
        if (mode === 'batteries' && selectedBatteries.length === 20) setShowConfirmModal(true)
        if (mode === 'shards' && selectedShardIndices.size >= 30 && selectedShardIndices.size % 30 === 0) setShowConfirmModal(true)
    }, [mode, selectedBatteries.length, selectedShardIndices.size])

    const executeBatteryMerge = async () => {
        if (selectedBatteries.length !== 20 || !account?.address) return

        setShowConfirmModal(false)
        setIsMerging(true)
        setMergeError(null)

        try {
            // Send ALL 20 standard batteries to admin wallet
            const allTokenIds = selectedBatteries.map(b => b.tokenId)

            console.log("Merge: Sending all 20 tokens:", allTokenIds)

            const txResult = await transferBatch(allTokenIds)

            if (!txResult?.transactionHash) {
                throw new Error("Transaction failed - no hash returned")
            }

            console.log("Transaction successful:", txResult.transactionHash)

            // Verify on server → server sends Super Battery back to user
            const res = await fetch("/api/merge/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    txHash: txResult.transactionHash,
                    sentTokenIds: allTokenIds,
                    userWallet: account.address
                })
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Verification failed")

            console.log("Merge verified! Super Battery received:", data.superBattery)
            setMergeSuccess(true)
        } catch (error: any) {
            console.error("Merge failed:", error)
            setMergeError(error.message || "Merge failed")
        } finally {
            setIsMerging(false)
        }
    }

    const executeShardMerge = async () => {
        const shardCount = selectedShardIndices.size
        if (shardCount < 30 || shardCount % 30 !== 0 || !account?.address) return

        setShowConfirmModal(false)
        setIsMerging(true)
        setMergeError(null)

        try {
            // ── Preflight: verify the vault has enough batteries BEFORE asking
            // the user to sign the on-chain shard transfer. Without this gate
            // a vault stockout meant the user lost their shards (multiple
            // historical cases on 2026-03-21 and 2026-05-05). The server now
            // also auto-refunds, but blocking here saves a round trip and a
            // confusing UX.
            try {
                const pf = await fetch(`/api/merge/preflight?shardCount=${shardCount}`, { cache: 'no-store' })
                const pfData = await pf.json()
                if (!pf.ok) throw new Error(pfData.error || 'Preflight check failed')
                if (!pfData.ok) {
                    throw new Error(
                        `Vault is short ${pfData.shortfall} batter${pfData.shortfall === 1 ? 'y' : 'ies'} ` +
                        `(${pfData.available}/${pfData.needed} ready). Try again later or pick fewer shards.`
                    )
                }
            } catch (e: any) {
                throw new Error(e?.message || 'Preflight check failed')
            }

            const transferResult = await transferShards(shardCount)
            if (!transferResult || !transferResult.transactionHash) throw new Error("Transaction failed or was rejected")

            const response = await fetch("/api/merge/shards", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userWallet: account.address,
                    txHash: transferResult.transactionHash,
                    shardCount,
                })
            })

            const data = await response.json()
            if (!response.ok) throw new Error(data.error || "Server error processing shard merge")

            // Server may have auto-refunded part of the order — surface that
            // to the user so they understand why fewer batteries arrived.
            if (data.partial && data.shardsRefunded) {
                setMergeError(
                    `Got ${data.batteriesReceived}/${data.needed} batteries — ${data.shardsRefunded} shards refunded automatically.`
                )
            } else if (data.refunded) {
                // Stockout: full refund. Treat as a soft error, not success.
                setMergeError(`Vault was empty — ${data.refunded} shards refunded automatically. Try again shortly.`)
                return
            }

            setMergeSuccess(true)
            fetchShards()
            window.dispatchEvent(new Event("user_shards_updated"))
        } catch (error: any) {
            console.error("Shard merge error:", error)
            setMergeError(error.message || "Failed to process shard merge")
        } finally {
            setIsMerging(false)
        }
    }

    const executeMerge = () => {
        if (mode === 'batteries') executeBatteryMerge()
        else executeShardMerge()
    }

    const handleReset = useCallback(() => {
        setMergeSuccess(false)
        setIsMerging(false)
        setIsBulkMerge(false)
        if (mode === 'batteries') {
            setSelectedBatteries([])
            fetchBatteries()
        } else {
            setSelectedShardIndices(new Set())
            fetchShards()
        }
    }, [mode, fetchBatteries, fetchShards])

    // ──────────────────────────────────────────────────────────
    // RENDER
    // ──────────────────────────────────────────────────────────

    const isReady = mode === 'batteries'
        ? selectedBatteries.length === 20
        : selectedShardIndices.size >= 30 && selectedShardIndices.size % 30 === 0
    const shardCount = selectedShardIndices.size
    const batteriesFromShards = Math.floor(shardCount / 30)
    const mergeModalMessage = mode === 'batteries'
        ? "You are exchanging 20 Standard Batteries for 1 Super Battery. All 20 batteries will be sent and you will receive a Super Battery in return. This action cannot be undone."
        : isBulkMerge
            ? `You are exchanging ${shardCount} Energy Shards for ${batteriesFromShards} Standard Batteries. All ${shardCount} shards will be sent and you will receive ${batteriesFromShards} batteries in return. This action cannot be undone.`
            : "You are exchanging 30 Energy Shards for 1 Standard Battery. This action cannot be undone."

    return (
        <main className="relative min-h-screen w-full bg-black font-sans text-white selection:bg-white/20 overflow-x-hidden">
            <div className="fixed inset-0 z-0 opacity-40 pointer-events-none mix-blend-lighten">
                <DigitalBackground />
            </div>

            <div className="relative z-10 min-h-screen lg:h-screen flex flex-col lg:overflow-hidden">
                <Header
                    isDashboard={false}
                    onOpenProfile={() => { setProfileInitialTab('profile'); setIsProfileOpen(true) }}
                    onOpenLeaderboard={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true) }}
                />

                <motion.div
                    className="flex-1 pt-16 sm:pt-20 pb-2 sm:pb-4 px-4 sm:px-6 flex flex-col lg:grid lg:grid-cols-12 gap-3 lg:gap-4 lg:overflow-hidden"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
                >
                    <div className="lg:col-span-7 flex flex-col min-h-0 order-1 lg:order-none">
                        <MergeMachine
                            mode={mode}
                            selectedCount={mode === 'batteries' ? selectedBatteries.length : selectedShardIndices.size}
                            isReady={isReady}
                            isMerging={isMerging || isTransferring || isTransferringShards}
                            mergeSuccess={mergeSuccess}
                            onStartMerge={handleStartMerge}
                            onReset={handleReset}
                            targetImageUrl={mode === 'shards' ? batteryUrl(false) : null}
                            isBulkMerge={isBulkMerge}
                        />
                    </div>

                    <div className="lg:col-span-5 min-h-[400px] lg:min-h-0 order-2 lg:order-none flex flex-col overflow-hidden lg:pt-2">
                        <div className="flex-1 h-full min-h-0 relative">
                            <div className="absolute inset-0">
                                <BatterySelector
                                    batteries={batteries}
                                    selectedBatteries={selectedBatteries}
                                    onToggleSelect={handleToggleSelect}
                                    onSelect20={handleSelect20}
                                    onDeselectAll={handleDeselectAll}
                                    onRefresh={mode === 'batteries' ? fetchBatteries : fetchShards}
                                    isLoading={isLoading}
                                    disabled={isMerging || mergeSuccess}
                                    activeTab={mode}
                                    onTabChange={setMode}
                                    shardBalance={shardBalance}
                                    selectedShardIndices={selectedShardIndices}
                                    onShardToggle={handleShardToggle}
                                    onShardSelectMany={handleShardSelectMany}
                                    onShardSelectMaximum={handleShardSelectMaximum}
                                    onShardDeselect={handleShardDeselectAll}
                                    isLoadingShards={isLoadingShards}
                                    isShardDisabled={isMerging || mergeSuccess}
                                    shardImageUrl={shardImageUrl}
                                    isBulkMerge={isBulkMerge}
                                />
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>

            <AlertModal
                isOpen={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                type="warning" title="Confirm Merge"
                message={mergeModalMessage}
                buttons={[
                    { label: "Cancel", onClick: () => setShowConfirmModal(false), variant: 'secondary' },
                    { label: "Confirm Merge", onClick: executeMerge, variant: 'primary' }
                ]}
            />
            <AlertModal
                isOpen={!!mergeError}
                onClose={() => setMergeError(null)}
                type="error" title="Merge Failed"
                message={mergeError || "An error occurred during merge"}
                buttons={[{ label: "Close", onClick: () => setMergeError(null), variant: 'secondary' }]}
            />

            <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} initialTab={profileInitialTab} />
        </main>
    )
}

export default function MergeMechanismPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-black" />}>
            <MergeMechanismContent />
        </Suspense>
    )
}
