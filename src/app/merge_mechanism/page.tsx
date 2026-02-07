"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { useRouter } from "next/navigation"
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

export default function MergeMechanismPage() {
    const account = useActiveAccount()
    const router = useRouter()

    const [batteries, setBatteries] = useState<BatteryItem[]>([])
    const [selectedBatteries, setSelectedBatteries] = useState<BatteryItem[]>([])
    const [isLoading, setIsLoading] = useState(true)

    // Modal states
    const [isProfileOpen, setIsProfileOpen] = useState(false)
    const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')
    const [showConfirmModal, setShowConfirmModal] = useState(false)

    // Merge process states
    const [isMerging, setIsMerging] = useState(false)
    const [mergeSuccess, setMergeSuccess] = useState(false)
    const [mergeError, setMergeError] = useState<string | null>(null)

    // Batch transfer hook
    const { transferBatch, isLoading: isTransferring } = useBatchTransfer(BATTERY_CONTRACT_ADDRESS)

    // Fetch standard batteries from wallet
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

                        // Determine battery type from metadata
                        const typeAttr = metadata?.attributes?.find((a: any) => a.trait_type === "Type")
                        const batteryType = typeAttr?.value === "Super" ? "Super" : "Standard"

                        return {
                            id: tokenId,
                            tokenId: tokenId,
                            name: metadata?.name || `Battery #${tokenId}`,
                            image: resolveImageUrl(metadata?.image || nft.metadata?.image),
                            batteryType: batteryType as 'Standard' | 'Super',
                            metadata: metadata,
                        }
                    } catch {
                        return {
                            id: tokenId,
                            tokenId: tokenId,
                            name: `Battery #${tokenId}`,
                            image: resolveImageUrl(nft.metadata?.image),
                            batteryType: 'Standard' as const,
                            metadata: nft.metadata || {}
                        }
                    }
                })
            )

            // Filter only standard batteries for merge
            const standardBatteries = loadedBatteries.filter(b => b.batteryType === 'Standard')
            setBatteries(standardBatteries)
        } catch (error) {
            console.error("Error loading batteries:", error)
        } finally {
            setIsLoading(false)
        }
    }, [account?.address])

    useEffect(() => {
        fetchBatteries()
    }, [fetchBatteries])

    // Redirect if not connected
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!account?.address) router.push('/')
        }, 2000)
        return () => clearTimeout(timer)
    }, [account?.address, router])

    // Toggle battery selection
    const handleToggleSelect = useCallback((battery: BatteryItem) => {
        setSelectedBatteries(prev => {
            const isSelected = prev.some(b => b.id === battery.id)
            if (isSelected) {
                return prev.filter(b => b.id !== battery.id)
            } else if (prev.length < 20) {
                return [...prev, battery]
            }
            return prev // Max 20 reached
        })
    }, [])

    // Select 20 batteries at once
    const handleSelect20 = useCallback(() => {
        const available = batteries.filter(b => !selectedBatteries.some(s => s.id === b.id))
        const toSelect = available.slice(0, 20 - selectedBatteries.length)
        setSelectedBatteries(prev => [...prev, ...toSelect].slice(0, 20))
    }, [batteries, selectedBatteries])

    // Deselect all
    const handleDeselectAll = useCallback(() => {
        setSelectedBatteries([])
    }, [])

    // Start merge process - show confirmation
    const handleStartMerge = useCallback(() => {
        if (selectedBatteries.length !== 20) return
        setShowConfirmModal(true)
    }, [selectedBatteries.length])

    // Execute merge after confirmation
    const executeMerge = useCallback(async () => {
        if (selectedBatteries.length !== 20 || !account?.address) return

        setShowConfirmModal(false)
        setIsMerging(true)
        setMergeError(null)

        try {
            // Battery to keep (first selected)
            const upgradeTokenId = selectedBatteries[0].tokenId
            // Batteries to send (remaining 19)
            const tokensToSend = selectedBatteries.slice(1).map(b => b.tokenId)

            console.log("Merge: Keeping token", upgradeTokenId, "Sending tokens:", tokensToSend)

            // Execute batch transfer
            const txResult = await transferBatch(tokensToSend)

            if (!txResult?.transactionHash) {
                throw new Error("Transaction failed - no hash returned")
            }

            console.log("Transaction successful:", txResult.transactionHash)

            // Verify with API and update database
            const verifyRes = await fetch('/api/merge/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    txHash: txResult.transactionHash,
                    sentTokenIds: tokensToSend,
                    upgradeTokenId: upgradeTokenId,
                    userWallet: account.address
                })
            })

            const verifyData = await verifyRes.json()

            if (!verifyRes.ok) {
                throw new Error(verifyData.error || "Verification failed")
            }

            console.log("Merge verified:", verifyData)
            setMergeSuccess(true)

        } catch (error: any) {
            console.error("Merge failed:", error)
            setMergeError(error.message || "Merge failed")
            setIsMerging(false)
        }
    }, [selectedBatteries, account?.address, transferBatch])

    // Reset after success
    const handleReset = useCallback(() => {
        setMergeSuccess(false)
        setIsMerging(false)
        setSelectedBatteries([])
        fetchBatteries() // Refresh battery list
    }, [fetchBatteries])

    return (
        <main className="relative min-h-screen w-full bg-black font-sans text-white selection:bg-white/20 overflow-x-hidden">
            <div className="fixed inset-0 z-0 opacity-40 pointer-events-none mix-blend-lighten">
                <DigitalBackground />
            </div>

            <div className="relative z-10 min-h-screen lg:h-screen flex flex-col lg:overflow-hidden">
                <Header
                    isDashboard={true}
                    onOpenProfile={() => { setProfileInitialTab('profile'); setIsProfileOpen(true) }}
                    onOpenLeaderboard={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true) }}
                />

                <motion.div
                    className="flex-1 pt-20 pb-4 px-4 sm:px-6 flex flex-col lg:grid lg:grid-cols-12 gap-4 lg:gap-6 lg:overflow-hidden"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5 }}
                >
                    {/* Left Panel: Merge Machine */}
                    <div className="lg:col-span-7 flex flex-col gap-3 min-h-0 order-1 lg:order-none">
                        <MergeMachine
                            selectedCount={selectedBatteries.length}
                            isReady={selectedBatteries.length === 20}
                            isMerging={isMerging || isTransferring}
                            mergeSuccess={mergeSuccess}
                            onStartMerge={handleStartMerge}
                            onReset={handleReset}
                        />
                    </div>

                    {/* Right Panel: Battery Selector */}
                    <div className="lg:col-span-5 min-h-0 order-2 lg:order-none overflow-hidden min-h-[400px] lg:min-h-0">
                        <div className="h-full">
                            <BatterySelector
                                batteries={batteries}
                                selectedBatteries={selectedBatteries}
                                onToggleSelect={handleToggleSelect}
                                onSelect20={handleSelect20}
                                onDeselectAll={handleDeselectAll}
                                onRefresh={fetchBatteries}
                                isLoading={isLoading}
                                disabled={isMerging || mergeSuccess}
                            />
                        </div>
                    </div>
                </motion.div>
            </div>

            {/* Confirmation Modal */}
            <AlertModal
                isOpen={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                type="warning"
                title="Confirm Merge"
                message="You are exchanging 20 Standard Batteries for 1 Super Battery. This action cannot be undone. 19 batteries will be transferred and 1 will be upgraded."
                buttons={[
                    {
                        label: "Cancel",
                        onClick: () => setShowConfirmModal(false),
                        variant: 'secondary'
                    },
                    {
                        label: "Confirm Merge",
                        onClick: executeMerge,
                        variant: 'primary'
                    }
                ]}
            />

            {/* Error Modal */}
            <AlertModal
                isOpen={!!mergeError}
                onClose={() => setMergeError(null)}
                type="error"
                title="Merge Failed"
                message={mergeError || "An error occurred during merge"}
                buttons={[
                    {
                        label: "Close",
                        onClick: () => setMergeError(null),
                        variant: 'secondary'
                    }
                ]}
            />

            <ProfileModal
                isOpen={isProfileOpen}
                onClose={() => setIsProfileOpen(false)}
                initialTab={profileInitialTab}
            />
        </main>
    )
}
