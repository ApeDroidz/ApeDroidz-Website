"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { motion } from "framer-motion"
import { useRouter, useSearchParams } from "next/navigation"
import { useActiveAccount } from "thirdweb/react"
import { getContract } from "thirdweb"
import { client, apeChain } from "@/lib/thirdweb"
import { getOwnedNFTs } from "thirdweb/extensions/erc721"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { MergeMachine } from "./merge-machine"
import { BatterySelector } from "./battery-selector"
import { ProfileModal } from "@/components/profile-modal"
import { AlertModal } from "@/components/alert-modal"
import { useBatchTransfer } from "@/hooks/useBatchTransfer"
import { useShardTransfer } from "@/hooks/useShardTransfer"
import { resolveImageUrl } from "@/lib/utils"

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

    // Transfer hooks
    const { transferBatch, isLoading: isTransferring } = useBatchTransfer(BATTERY_CONTRACT_ADDRESS)
    const { transferShards, isLoading: isTransferringShards } = useShardTransfer()

    // ──────────────────────────────────────────────────────────
    // FETCHING LOGIC
    // ──────────────────────────────────────────────────────────

    const fetchBatteries = useCallback(async () => {
        setIsLoading(true)
        if (!account?.address) {
            setIsLoading(false)
            return
        }
        try {
            const batteryContract = getContract({ client, chain: apeChain, address: BATTERY_CONTRACT_ADDRESS })
            const batteryNfts = await getOwnedNFTs({ contract: batteryContract, owner: account.address })
            const loadedBatteries = await Promise.all(
                batteryNfts.map(async (nft) => {
                    const tokenId = nft.id.toString()
                    try {
                        const res = await fetch(`/api/metadata/batteries/${tokenId}`)
                        let metadata = res.ok ? await res.json() : (nft.metadata || {})
                        const typeAttr = metadata?.attributes?.find((a: any) => a.trait_type === "Type")
                        const batteryType = typeAttr?.value === "Super" ? "Super" : "Standard"
                        return {
                            id: tokenId, tokenId,
                            name: metadata?.name || `Battery #${tokenId}`,
                            image: resolveImageUrl(metadata?.image || nft.metadata?.image),
                            batteryType: batteryType as 'Standard' | 'Super',
                            metadata
                        }
                    } catch {
                        return {
                            id: tokenId, tokenId,
                            name: `Battery #${tokenId}`,
                            image: resolveImageUrl(nft.metadata?.image),
                            batteryType: 'Standard' as const,
                            metadata: nft.metadata || {}
                        }
                    }
                })
            )
            setBatteries(loadedBatteries.filter(b => b.batteryType === 'Standard'))
        } catch (error) {
            console.error("Error loading batteries:", error)
        } finally {
            setIsLoading(false)
        }
    }, [account?.address])

    const fetchShards = useCallback(async () => {
        if (!account?.address) return
        setIsLoadingShards(true)
        try {
            const res = await fetch(`/api/merge/shards-balance?wallet=${account.address}`)
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
        if (account?.address) {
            fetchBatteries()
            fetchShards()
        }
    }, [account?.address, fetchBatteries, fetchShards])

    useEffect(() => {
        const timer = setTimeout(() => {
            if (!account?.address) router.push('/')
        }, 2000)
        return () => clearTimeout(timer)
    }, [account?.address, router])

    // Update URL when mode changes
    useEffect(() => {
        if (mode === 'shards') {
            router.replace('/merge_mechanism?tab=shards', { scroll: false })
            setSelectedBatteries([])
        } else {
            router.replace('/merge_mechanism', { scroll: false })
            setSelectedShardIndices(new Set())
        }
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
        const indices = Array.from({ length: Math.min(count, shardBalance) }, (_, i) => i)
        setSelectedShardIndices(new Set(indices))
    }, [mode, shardBalance])

    const handleShardDeselectAll = useCallback(() => setSelectedShardIndices(new Set()), [])

    // ──────────────────────────────────────────────────────────
    // MERGE EXECUTION
    // ──────────────────────────────────────────────────────────

    const handleStartMerge = useCallback(() => {
        if (mode === 'batteries' && selectedBatteries.length === 20) setShowConfirmModal(true)
        if (mode === 'shards' && selectedShardIndices.size === 30) setShowConfirmModal(true)
    }, [mode, selectedBatteries.length, selectedShardIndices.size])

    const executeBatteryMerge = async () => {
        if (selectedBatteries.length !== 20 || !account?.address) return

        setShowConfirmModal(false)
        setIsMerging(true)
        setMergeError(null)

        try {
            const upgradeTokenId = selectedBatteries[0].tokenId
            const burnTokenIds = selectedBatteries.slice(1).map(b => b.tokenId)

            const success = await transferBatch(burnTokenIds)

            if (!success) throw new Error("Transaction failed or was rejected")

            const res = await fetch("/api/merge/batteries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ walletAddress: account.address, targetTokenId: upgradeTokenId, burnedTokenIds: burnTokenIds })
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Failed to upgrade battery on server")

            setMergeSuccess(true)
        } catch (error: any) {
            console.error("Merge error:", error)
            setMergeError(error.message || "An unexpected error occurred during merge")
        } finally {
            setIsMerging(false)
        }
    }

    const executeShardMerge = async () => {
        if (selectedShardIndices.size !== 30 || !account?.address) return

        setShowConfirmModal(false)
        setIsMerging(true)
        setMergeError(null)

        try {
            const transferSuccess = await transferShards()
            if (!transferSuccess) throw new Error("Transaction failed or was rejected")

            const response = await fetch("/api/merge/shards", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ walletAddress: account.address, amount: 30 })
            })

            const data = await response.json()
            if (!response.ok) throw new Error(data.error || "Server error processing shard merge")

            setMergeSuccess(true)
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

    const isReady = mode === 'batteries' ? selectedBatteries.length === 20 : selectedShardIndices.size === 30
    const mergeModalMessage = mode === 'batteries'
        ? "You are exchanging 20 Standard Batteries for 1 Super Battery. This action cannot be undone. 19 batteries will be transferred and 1 will be upgraded."
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
                    className="flex-1 pt-20 pb-4 px-4 sm:px-6 flex flex-col lg:grid lg:grid-cols-12 gap-4 lg:gap-6 lg:overflow-hidden"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
                >
                    <div className="lg:col-span-7 flex flex-col gap-3 min-h-0 order-1 lg:order-none">
                        <MergeMachine
                            mode={mode}
                            selectedCount={mode === 'batteries' ? selectedBatteries.length : selectedShardIndices.size}
                            isReady={isReady}
                            isMerging={isMerging || isTransferring || isTransferringShards}
                            mergeSuccess={mergeSuccess}
                            onStartMerge={handleStartMerge}
                            onReset={handleReset}
                            targetImageUrl={mode === 'shards' ? 'https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/standart_battery.webp' : null}
                        />
                    </div>

                    <div className="lg:col-span-5 min-h-0 order-2 lg:order-none overflow-hidden min-h-[400px] lg:min-h-0 lg:pt-4">
                        <div className="h-full">
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
                                onShardDeselect={handleShardDeselectAll}
                                isLoadingShards={isLoadingShards}
                                isShardDisabled={isMerging || mergeSuccess}
                                shardImageUrl={shardImageUrl}
                            />
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
