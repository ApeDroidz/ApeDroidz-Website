"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion } from "framer-motion"
import { useRouter } from "next/navigation"
import { useActiveAccount } from "thirdweb/react"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { GridDroidSelector } from "./grid-droid-selector"
import { VisualGrid } from "./visual-grid"
import { GridDownloadButton } from "./grid-download-button"
import { ProfileModal } from "@/components/profile-modal"
import { resolveImageUrl } from "@/lib/utils"
import { GridStyle, supportsStyle } from "./grid-art"


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
    isHonorary?: boolean
}



export default function GridPage() {
    const account = useActiveAccount()
    const router = useRouter()
    const gridRef = useRef<HTMLDivElement>(null)

    const [droids, setDroids] = useState<NFTItem[]>([])
    const [selectedDroids, setSelectedDroids] = useState<NFTItem[]>([])
    const [gridOrder, setGridOrder] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(true)

    // Стиль всего грида — как в дашборде. `standard` даёт каждому дроиду его
    // собственный сохранённый вид, остальные перекрашивают грид целиком.
    const [gridStyle, setGridStyle] = useState<GridStyle>('standard')

    const [isProfileOpen, setIsProfileOpen] = useState(false)
    const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')

    // RPC-free: both collections come from our own indexer-backed endpoints.
    // Honorary is ERC-1155, so it cannot go through the erc721 helpers at all.
    const fetchMyDroids = useCallback(async () => {
        setIsLoading(true)

        // DEBUG: ?owner=0x… для отладки без кошелька, только в dev
        const debugOwner = process.env.NODE_ENV !== 'production'
            ? new URLSearchParams(window.location.search).get('owner')
            : null
        if (!account?.address && !debugOwner) {
            setIsLoading(false)
            return
        }

        try {
            const owner = debugOwner || account!.address
            const [droidRes, honoraryRes] = await Promise.all([
                fetch(`/api/owned-droids?owner=${owner}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})) as Promise<any>,
                fetch(`/api/owned-honorary?owner=${owner}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})) as Promise<any>,
            ])

            // В грид идёт актуальный PFP дроида — тот вид, что холдер сохранил в
            // дашборде (или дефолт коллекции, 3D-бюст). `image` от API уже
            // разрешён с учётом этого; display_view говорит гриду, что это —
            // пиксель, 3D или анимация. GIF-кадры для анимации выгрузка
            // достаёт сама, а пиксельная статика остаётся запасным вариантом.
            const loadedDroids: NFTItem[] = (droidRes?.droids || []).map((d: any) => ({
                id: d.id,
                tokenId: d.tokenId,
                name: d.name,
                image: resolveImageUrl(d.image),
                type: 'droid' as const,
                level: d.level ?? 1,
                metadata: {
                    attributes: d.attributes,
                    is_super: d.is_super,
                    display_view: d.display_view,
                    image_pixel: d.image_pixel,
                    image_animated: d.image_animated,
                    image_3d: d.image_3d,
                },
            }))

            const loadedHonorary: NFTItem[] = (honoraryRes?.droids || []).map((d: any) => ({
                id: d.id,
                tokenId: d.tokenId,
                name: d.name,
                image: resolveImageUrl(d.image),
                type: 'droid' as const,
                level: 1,
                // has_gif drives whether this one can animate — honorary art is
                // per-token, only some of them were animated.
                metadata: {
                    attributes: d.attributes,
                    has_gif: d.has_gif,
                    image_animated: d.image_animated,
                    image_pixel: d.image_pixel,
                    display_view: d.display_view,
                },
                isHonorary: true,
            }))

            // Honorary droids come first
            setDroids([...loadedHonorary, ...loadedDroids])
        } catch (error) {
            console.error("Error loading droids:", error)
        } finally {
            setIsLoading(false)
        }
    }, [account?.address])

    useEffect(() => {
        fetchMyDroids()
    }, [fetchMyDroids])

    // Смена стиля выкидывает из грида тех, у кого такого арта нет: список их
    // тоже прячет, и иначе дроид остался бы в гриде без возможности его снять.
    useEffect(() => {
        setSelectedDroids(prev => {
            const kept = prev.filter(d => supportsStyle(d, gridStyle))
            return kept.length === prev.length ? prev : kept
        })
    }, [gridStyle])

    // Порядок ячеек всегда следует за выбором — чистим осиротевшие id.
    useEffect(() => {
        const ids = new Set(selectedDroids.map(d => d.id))
        setGridOrder(order => (order.every(id => ids.has(id)) ? order : order.filter(id => ids.has(id))))
    }, [selectedDroids])



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
                    className="flex-1 pt-24 pb-4 px-4 sm:px-6 flex flex-col lg:grid lg:grid-cols-12 gap-4 lg:gap-6 lg:overflow-hidden"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5 }}
                >
                    {/* Left Panel: Visual Grid - takes 7 columns on desktop */}
                    <div className="lg:col-span-7 flex flex-col gap-3 min-h-0 order-1 lg:order-none">
                        <div className="min-h-[300px] h-[50vh] lg:flex-1 lg:h-auto relative overflow-hidden flex items-center justify-center">
                            <VisualGrid
                                droids={selectedDroids}
                                gridOrder={gridOrder}
                                onReorder={handleReorder}
                                gridRef={gridRef}
                                style={gridStyle}
                            />
                        </div>

                        {/* Download Button */}
                        <GridDownloadButton
                            droids={selectedDroids}
                            gridOrder={gridOrder}
                            style={gridStyle}
                        />
                    </div>

                    {/* Right Panel: Droid Selector - scrollable on mobile */}
                    <div className="lg:col-span-5 min-h-0 order-2 lg:order-none overflow-hidden min-h-[400px] lg:min-h-0">
                        <div className="h-full">
                            <GridDroidSelector
                                droids={droids}
                                selectedDroids={selectedDroids}
                                onToggleSelect={handleToggleSelect}
                                onSelectAll={handleSelectAll}
                                onRefresh={fetchMyDroids}
                                isLoading={isLoading}
                                style={gridStyle}
                                onStyleChange={setGridStyle}
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
