"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion } from "framer-motion"
import { useRouter } from "next/navigation"
import { useActiveAccount } from "thirdweb/react"
import { getContract } from "thirdweb/contract"
import { client, apeChain } from "@/lib/thirdweb"
import { getOwnedNFTs } from "thirdweb/extensions/erc721"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { GridDroidSelector } from "./grid-droid-selector"
import { VisualGrid } from "./visual-grid"
import { GridDownloadButton } from "./grid-download-button"
import { ProfileModal } from "@/components/profile-modal"
import { resolveImageUrl } from "@/lib/utils"

// Type reuse
export type NFTItem = {
    id: string
    name: string
    image: string
    type: 'droid' | 'battery'
    level?: number
    tokenId?: string
    batteryType?: 'Standard' | 'Super'
    metadata?: any
}

const APEDROIDZ_CONTRACT = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""

const getDroidLevel = (item: NFTItem | null): number => {
    if (!item) return 1
    if (typeof item.level === 'number' && item.level > 0) return item.level
    const attributes = item.metadata?.attributes || item.metadata?.traits || []
    if (Array.isArray(attributes)) {
        const lvlAttr = attributes.find((a: any) =>
            a.trait_type === "Level" ||
            a.trait_type === "Rank Value" ||
            a.trait_type === "Upgrade Level"
        )
        if (lvlAttr) {
            const val = parseInt(String(lvlAttr.value).replace(/\D/g, ''))
            if (!isNaN(val) && val > 0) return val
        }
    }
    return 1
}

export default function GridPage() {
    const account = useActiveAccount()
    const router = useRouter()
    const gridRef = useRef<HTMLDivElement>(null)

    const [droids, setDroids] = useState<NFTItem[]>([])
    const [selectedDroids, setSelectedDroids] = useState<NFTItem[]>([])
    const [gridOrder, setGridOrder] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const [isProfileOpen, setIsProfileOpen] = useState(false)
    const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')

    const fetchMyDroids = useCallback(async () => {
        setIsLoading(true)

        if (!account?.address) {
            setIsLoading(false)
            return
        }

        try {
            const droidContract = getContract({ client, chain: apeChain, address: APEDROIDZ_CONTRACT })
            const droidNfts = await getOwnedNFTs({ contract: droidContract, owner: account.address })

            const loadedDroids = await Promise.all(
                droidNfts.map(async (nft) => {
                    const tokenId = nft.id.toString()
                    try {
                        const res = await fetch(`/api/metadata/droidz/${tokenId}`)
                        let metadata = res.ok ? await res.json() : (nft.metadata || {})

                        const lvlHelperObj = { level: 0, metadata }
                        const currentLevel = getDroidLevel(lvlHelperObj as any)

                        let imgUrl = resolveImageUrl((metadata as any).image)
                        if (!imgUrl) imgUrl = resolveImageUrl(nft.metadata?.image)

                        return {
                            id: tokenId,
                            tokenId: tokenId,
                            name: (metadata as any).name || `ApeDroid #${tokenId}`,
                            image: imgUrl,
                            type: 'droid' as const,
                            level: currentLevel,
                            metadata: metadata,
                        }
                    } catch {
                        return {
                            id: tokenId,
                            tokenId: tokenId,
                            name: `ApeDroid #${tokenId}`,
                            image: resolveImageUrl(nft.metadata?.image),
                            type: 'droid' as const,
                            level: 1,
                            metadata: nft.metadata || {}
                        }
                    }
                })
            )
            setDroids(loadedDroids)
        } catch (error) {
            console.error("Error loading droids:", error)
        } finally {
            setIsLoading(false)
        }
    }, [account?.address])

    useEffect(() => {
        fetchMyDroids()
    }, [fetchMyDroids])

    useEffect(() => {
        const timer = setTimeout(() => {
            if (!account?.address) router.push('/')
        }, 2000)
        return () => clearTimeout(timer)
    }, [account?.address, router])

    const handleToggleSelect = useCallback((droid: NFTItem) => {
        setSelectedDroids(prev => {
            const isSelected = prev.some(d => d.id === droid.id)
            if (isSelected) {
                setGridOrder(order => order.filter(id => id !== droid.id))
                return prev.filter(d => d.id !== droid.id)
            } else {
                setGridOrder(order => [...order, droid.id])
                return [...prev, droid]
            }
        })
    }, [])

    const handleSelectAll = useCallback((filteredDroids: NFTItem[]) => {
        // Check if all filtered droids are already selected
        const allFilteredSelected = filteredDroids.length > 0 &&
            filteredDroids.every(d => selectedDroids.some(sd => sd.id === d.id))

        if (allFilteredSelected) {
            // Deselect all filtered droids
            const filteredIds = new Set(filteredDroids.map(d => d.id))
            setSelectedDroids(prev => prev.filter(d => !filteredIds.has(d.id)))
            setGridOrder(order => order.filter(id => !filteredIds.has(id)))
        } else {
            // Add all filtered droids that aren't already selected
            const existingIds = new Set(selectedDroids.map(d => d.id))
            const newDroids = filteredDroids.filter(d => !existingIds.has(d.id))
            setSelectedDroids(prev => [...prev, ...newDroids])
            setGridOrder(order => [...order, ...newDroids.map(d => d.id)])
        }
    }, [selectedDroids])

    const handleReorder = useCallback((newOrder: string[]) => {
        setGridOrder(newOrder)
    }, [])

    return (
        <main className="relative min-h-screen w-full bg-black font-sans text-white selection:bg-white/20 overflow-hidden">
            <div className="fixed inset-0 z-0 opacity-40 pointer-events-none mix-blend-lighten">
                <DigitalBackground />
            </div>

            <div className="relative z-10 h-screen flex flex-col overflow-hidden">
                <Header
                    isDashboard={true}
                    onOpenProfile={() => { setProfileInitialTab('profile'); setIsProfileOpen(true) }}
                    onOpenLeaderboard={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true) }}
                />

                <motion.div
                    className="flex-1 pt-20 pb-4 px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 overflow-hidden"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5 }}
                >
                    {/* Left Panel: Visual Grid - takes 7 columns on desktop, more height on mobile */}
                    <div className="lg:col-span-7 flex flex-col gap-3 min-h-0 order-1 lg:order-none h-[55vh] lg:h-auto">
                        <div className="flex-1 min-h-0 relative overflow-hidden flex items-center justify-center">
                            <VisualGrid
                                droids={selectedDroids}
                                gridOrder={gridOrder}
                                onReorder={handleReorder}
                                gridRef={gridRef}
                            />
                        </div>

                        {/* Download Button */}
                        <GridDownloadButton
                            droids={selectedDroids}
                            gridOrder={gridOrder}
                        />
                    </div>

                    {/* Right Panel: Droid Selector - takes 5 columns on desktop, less height on mobile */}
                    <div className="lg:col-span-5 min-h-0 order-2 lg:order-none overflow-hidden h-[35vh] lg:h-auto">
                        <div className="h-full">
                            <GridDroidSelector
                                droids={droids}
                                selectedDroids={selectedDroids}
                                onToggleSelect={handleToggleSelect}
                                onSelectAll={handleSelectAll}
                                onRefresh={fetchMyDroids}
                                isLoading={isLoading}
                            />
                        </div>
                    </div>
                </motion.div>
            </div>

            <ProfileModal
                isOpen={isProfileOpen}
                onClose={() => setIsProfileOpen(false)}
                initialTab={profileInitialTab}
            />
        </main>
    )
}
