"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { BatteryItem } from "./page"
import { resolveImageUrl } from "@/lib/utils"
import { RefreshCcw, Check } from "lucide-react"

interface BatterySelectorProps {
    batteries: BatteryItem[]
    selectedBatteries: BatteryItem[]
    onToggleSelect: (battery: BatteryItem) => void
    onSelect20: () => void
    onDeselectAll: () => void
    onRefresh: () => void
    isLoading: boolean
    disabled?: boolean
}

// Battery card component
const BatteryCard = ({
    battery,
    isSelected,
    onSelect,
    disabled
}: {
    battery: BatteryItem
    isSelected: boolean
    onSelect: (battery: BatteryItem) => void
    disabled?: boolean
}) => {
    const tokenNumber = battery.name.match(/#(\d+)/)?.[1] || battery.id
    const displayId = `#${tokenNumber}`
    const [isLoaded, setIsLoaded] = useState(false)

    let borderColor = "border-white/20 hover:border-white/50"
    if (isSelected) {
        borderColor = "border-white shadow-[0_0_15px_rgba(255,255,255,0.3)] scale-[0.98]"
    }

    return (
        <div
            onClick={() => !disabled && onSelect(battery)}
            className={`group relative aspect-square rounded-xl overflow-hidden transition-all duration-300 border-2 ${borderColor} ${!isSelected && !disabled && 'hover:bg-white/5'} bg-black ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
            {/* Loading skeleton */}
            {!isLoaded && (
                <div className="absolute inset-0 bg-white/5 animate-pulse" />
            )}

            {/* Battery image */}
            <img
                src={resolveImageUrl(battery.image)}
                alt={battery.name}
                onLoad={() => setIsLoaded(true)}
                className={`w-full h-full object-cover transition-opacity duration-500 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                loading="lazy"
                style={{ imageRendering: 'pixelated' }}
            />

            {/* ID badge */}
            <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded text-[10px] font-mono text-white font-bold border border-white/10 z-20 pointer-events-none">
                {displayId}
            </div>

            {/* Selection checkmark */}
            {isSelected && (
                <div className="absolute top-2 left-2 w-6 h-6 bg-white rounded-full flex items-center justify-center z-20">
                    <Check size={14} className="text-black" strokeWidth={3} />
                </div>
            )}
        </div>
    )
}

export function BatterySelector({
    batteries,
    selectedBatteries,
    onToggleSelect,
    onSelect20,
    onDeselectAll,
    onRefresh,
    isLoading,
    disabled = false
}: BatterySelectorProps) {
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [showAll, setShowAll] = useState(false)

    // Force showAll on desktop
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 1024) {
                setShowAll(true)
            } else {
                setShowAll(false)
            }
        }
        handleResize()
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    const handleRefresh = async () => {
        if (disabled) return
        setIsRefreshing(true)
        await onRefresh()
        setTimeout(() => setIsRefreshing(false), 500)
    }

    // Mobile limit: show 6 batteries initially
    const displayedBatteries = useMemo(() => {
        if (showAll) return batteries
        return batteries.slice(0, 6)
    }, [batteries, showAll])

    const hasHiddenBatteries = batteries.length > 6

    const allSelected = selectedBatteries.length === 20
    const canSelectMore = selectedBatteries.length < 20 && batteries.length > 0

    const loadingSkeletons = Array.from({ length: 6 })

    return (
        <div className="flex flex-col h-full rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-4 relative">
            {/* Header */}
            <div className="flex flex-col gap-2 mb-4 flex-shrink-0 relative z-30 lg:flex-row lg:justify-between lg:items-center">
                <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold tracking-wider text-white/90 uppercase">Standard Batteries</h3>
                    <span className="text-xs text-white/40 font-mono">({batteries.length})</span>

                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing || isLoading || disabled}
                        className="cursor-pointer ml-1 p-1 rounded-full hover:bg-white/10 transition-colors group"
                        title="Refresh"
                    >
                        <RefreshCcw
                            size={14}
                            className={`text-white/40 group-hover:text-white transition-all ${(isRefreshing || isLoading) ? 'animate-spin opacity-50' : ''}`}
                        />
                    </button>
                </div>

                {/* Selection counter */}
                <div className="flex items-center gap-2">
                    <span className={`text-sm font-mono font-bold ${selectedBatteries.length === 20 ? 'text-[#FF7700]' : 'text-white/60'}`}>
                        {selectedBatteries.length}/20
                    </span>
                </div>
            </div>

            {/* Battery grid */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-2">
                    {isLoading ? (
                        loadingSkeletons.map((_, i) => (
                            <div key={i} className="aspect-square rounded-xl overflow-hidden border-2 border-white/10 bg-white/5 animate-pulse" />
                        ))
                    ) : (
                        displayedBatteries.map((battery) => (
                            <BatteryCard
                                key={battery.id}
                                battery={battery}
                                isSelected={selectedBatteries.some(b => b.id === battery.id)}
                                onSelect={onToggleSelect}
                                disabled={disabled || (!selectedBatteries.some(b => b.id === battery.id) && selectedBatteries.length >= 20)}
                            />
                        ))
                    )}
                </div>

                {/* Show All button for mobile */}
                {!showAll && hasHiddenBatteries && (
                    <button
                        onClick={() => setShowAll(!showAll)}
                        className="w-full py-3 mt-2 mb-2 bg-white/5 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest text-white/50 hover:bg-white/10 hover:text-white transition-all lg:hidden"
                    >
                        Show All ({batteries.length})
                    </button>
                )}

                {/* Empty state */}
                {!isLoading && batteries.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <p className="text-white/30 text-sm font-mono mb-2">No standard batteries found</p>
                        <p className="text-white/20 text-xs">Mint or purchase batteries to use merge.</p>
                    </div>
                )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mt-4 pt-4 border-t border-white/10">
                {allSelected ? (
                    <button
                        onClick={onDeselectAll}
                        disabled={disabled}
                        className={`flex-1 h-11 flex items-center justify-center gap-2 rounded-xl border text-xs font-black uppercase tracking-wider transition-all
                            ${disabled
                                ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed'
                                : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/20 hover:text-white cursor-pointer'}`}
                    >
                        Deselect All
                    </button>
                ) : canSelectMore ? (
                    <button
                        onClick={onSelect20}
                        disabled={disabled || batteries.length === 0}
                        className={`flex-1 h-11 flex items-center justify-center gap-2 rounded-xl border text-xs font-black uppercase tracking-wider transition-all
                            ${disabled || batteries.length === 0
                                ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed'
                                : 'bg-white text-black border-white hover:bg-blue-600 hover:border-blue-600 hover:text-white cursor-pointer'}`}
                    >
                        Select 20
                    </button>
                ) : (
                    <div className="flex-1 h-11 flex items-center justify-center text-xs font-mono text-white/40">
                        Need {20 - batteries.length} more batteries
                    </div>
                )}
            </div>
        </div>
    )
}
