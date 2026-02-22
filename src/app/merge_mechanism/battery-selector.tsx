"use client"

import { useState, useMemo, useEffect } from "react"
import { BatteryItem } from "./page"
import { resolveImageUrl } from "@/lib/utils"
import { RefreshCcw, Check } from "lucide-react"

const SHARD_IMAGE = "https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/cards/shard_01.webp"

/* ─── Types ─── */
interface BatterySelectorProps {
    batteries: BatteryItem[]
    selectedBatteries: BatteryItem[]
    onToggleSelect: (battery: BatteryItem) => void
    onSelect20: () => void
    onDeselectAll: () => void
    onRefresh: () => void
    isLoading: boolean
    disabled?: boolean
    activeTab: 'batteries' | 'shards'
    onTabChange: (tab: 'batteries' | 'shards') => void
    shardBalance: number
    selectedShardIndices: Set<number>
    onShardToggle: (index: number) => void
    onShardSelectMany: (count: number) => void
    onShardDeselect: () => void
    shardImageUrl?: string | null
    isLoadingShards?: boolean
    isShardDisabled?: boolean
}

/* ─── Battery Card ─── */
const BatteryCard = ({
    battery, isSelected, onSelect, disabled
}: {
    battery: BatteryItem
    isSelected: boolean
    onSelect: (b: BatteryItem) => void
    disabled?: boolean
}) => {
    const tokenNumber = battery.name.match(/#(\d+)/)?.[1] || battery.id
    const [isLoaded, setIsLoaded] = useState(false)

    return (
        <div
            onClick={() => !disabled && onSelect(battery)}
            className={`group relative aspect-square rounded-xl overflow-hidden transition-all duration-300 border-2 bg-black
                ${isSelected ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.3)] scale-[0.98]' : 'border-white/20 hover:border-white/50'}
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
            {!isLoaded && <div className="absolute inset-0 bg-white/5 animate-pulse" />}
            <img
                src={resolveImageUrl(battery.image)}
                alt={battery.name}
                onLoad={() => setIsLoaded(true)}
                className={`w-full h-full object-cover transition-opacity duration-500 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                loading="lazy"
                style={{ imageRendering: 'pixelated' }}
            />
            <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded text-[10px] font-mono text-white font-bold border border-white/10 z-20 pointer-events-none">
                #{tokenNumber}
            </div>
            {isSelected && (
                <div className="absolute top-2 left-2 w-6 h-6 bg-white rounded-full flex items-center justify-center z-20">
                    <Check size={14} className="text-black" strokeWidth={3} />
                </div>
            )}
        </div>
    )
}

/* ─── Shard Card ─── */
const ShardCard = ({
    index, isSelected, onToggle, disabled
}: {
    index: number
    isSelected: boolean
    onToggle: (i: number) => void
    disabled?: boolean
}) => {
    const [isLoaded, setIsLoaded] = useState(false)

    return (
        <div
            onClick={() => !disabled && onToggle(index)}
            className={`group relative aspect-square rounded-xl overflow-hidden transition-all duration-300 border-2 bg-black
                ${isSelected ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.3)] scale-[0.98]' : 'border-white/20 hover:border-white/50'}
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
            {!isLoaded && <div className="absolute inset-0 bg-white/5 animate-pulse" />}
            <img
                src={SHARD_IMAGE}
                alt={`Shard #${index + 1}`}
                onLoad={() => setIsLoaded(true)}
                className={`w-full h-full object-cover transition-opacity duration-500 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                loading="lazy"
            />
            <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] font-mono text-white/70 font-bold border border-white/10 z-20 pointer-events-none">
                #{index + 1}
            </div>
            {isSelected && (
                <div className="absolute top-2 left-2 w-6 h-6 bg-white rounded-full flex items-center justify-center z-20">
                    <Check size={14} className="text-black" strokeWidth={3} />
                </div>
            )}
        </div>
    )
}

/* ─── Main Component ─── */
export function BatterySelector({
    batteries, selectedBatteries, onToggleSelect, onSelect20, onDeselectAll,
    onRefresh, isLoading, disabled = false,
    activeTab, onTabChange,
    shardBalance, selectedShardIndices, onShardToggle, onShardSelectMany, onShardDeselect,
    isLoadingShards = false, isShardDisabled = false,
}: BatterySelectorProps) {
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [showAll, setShowAll] = useState(false)

    useEffect(() => {
        const handleResize = () => { if (window.innerWidth >= 1024) setShowAll(true) }
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

    const displayedBatteries = useMemo(() => showAll ? batteries : batteries.slice(0, 6), [batteries, showAll])
    const hasHiddenBatteries = batteries.length > 6

    const selectedShardCount = selectedShardIndices.size

    /* ────── BATTERIES TAB ────── */
    const renderBatteriesTab = () => {
        const selected = selectedBatteries.length
        const canSelect = batteries.length >= 20
        return (
            <>
                <div className="flex items-center gap-2 mb-3 px-1 flex-shrink-0">
                    <h2 className="text-sm font-black text-white/90 uppercase tracking-[0.15em]">
                        Standard Batteries{' '}
                        <span className="text-white/40 font-medium normal-case">({batteries.length})</span>
                    </h2>
                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing || isLoading || disabled}
                        className="cursor-pointer p-1.5 rounded-full hover:bg-white/10 transition-colors group flex-shrink-0"
                        title="Refresh"
                    >
                        <RefreshCcw
                            size={13}
                            className={`text-white/40 group-hover:text-white transition-all ${(isRefreshing || isLoading) ? 'animate-spin opacity-50' : ''}`}
                        />
                    </button>
                    <div className="flex-1" />
                    <span className="text-sm font-mono font-bold text-white/60 whitespace-nowrap">
                        <span className={selected === 20 ? 'text-[#FF7700]' : ''}>{selected}</span>/20
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-2">
                        {isLoading
                            ? Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="aspect-square rounded-xl border-2 border-white/10 bg-white/5 animate-pulse" />
                            ))
                            : displayedBatteries.map(b => (
                                <BatteryCard
                                    key={b.id}
                                    battery={b}
                                    isSelected={selectedBatteries.some(s => s.id === b.id)}
                                    onSelect={onToggleSelect}
                                    disabled={disabled || (!selectedBatteries.some(s => s.id === b.id) && selected >= 20)}
                                />
                            ))
                        }
                    </div>

                    {!showAll && hasHiddenBatteries && (
                        <button
                            onClick={() => setShowAll(true)}
                            className="w-full py-3 mt-2 mb-2 bg-white/5 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest text-white/50 hover:bg-white/10 hover:text-white transition-all lg:hidden"
                        >
                            Show All ({batteries.length})
                        </button>
                    )}

                    {!isLoading && batteries.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <p className="text-white/30 text-sm font-mono mb-2">No standard batteries found</p>
                            <p className="text-white/20 text-xs">Mint or purchase batteries to use merge.</p>
                        </div>
                    )}
                </div>

                <div className="flex gap-2 mt-4 pt-4 border-t border-white/10 flex-shrink-0">
                    {selected > 0 ? (
                        <button
                            onClick={onDeselectAll}
                            disabled={disabled}
                            className={`flex-1 h-11 flex items-center justify-center gap-2 rounded-xl border text-xs font-black uppercase tracking-wider transition-all
                                ${disabled ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed' : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/20 hover:text-white cursor-pointer'}`}
                        >
                            Deselect All
                        </button>
                    ) : batteries.length > 0 ? (
                        <button
                            onClick={onSelect20}
                            disabled={disabled}
                            className={`flex-1 h-11 flex items-center justify-center gap-2 rounded-xl border text-xs font-black uppercase tracking-wider transition-all
                                ${disabled ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed' : 'bg-white text-black border-white hover:bg-blue-600 hover:border-blue-600 hover:text-white cursor-pointer'}`}
                        >
                            Select {Math.min(batteries.length, 20)}
                        </button>
                    ) : (
                        <div className="flex-1 h-11 flex items-center justify-center text-xs font-mono text-white/40">
                            Need {Math.max(0, 20 - batteries.length)} more batteries
                        </div>
                    )}
                </div>
            </>
        )
    }

    /* ────── SHARDS TAB ────── */
    const renderShardsTab = () => {
        const selectTarget = Math.min(shardBalance, 30)
        const canSelect = shardBalance > 0
        return (
            <>
                <div className="flex items-center gap-2 mb-3 px-1 flex-shrink-0">
                    <h2 className="text-sm font-black text-white/90 uppercase tracking-[0.15em]">
                        Energy Shards{' '}
                        <span className="text-white/40 font-medium normal-case">({shardBalance})</span>
                    </h2>
                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing || isLoadingShards || isShardDisabled}
                        className="cursor-pointer p-1.5 rounded-full hover:bg-white/10 transition-colors group flex-shrink-0"
                        title="Refresh"
                    >
                        <RefreshCcw
                            size={13}
                            className={`text-white/40 group-hover:text-white transition-all ${(isRefreshing || isLoadingShards) ? 'animate-spin opacity-50' : ''}`}
                        />
                    </button>
                    <div className="flex-1" />
                    <span className="text-sm font-mono font-bold text-white/60 whitespace-nowrap">
                        <span className={selectedShardCount === 30 ? 'text-[#FF7700]' : ''}>{selectedShardCount}</span>/30
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-2">
                        {isLoadingShards
                            ? Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="aspect-square rounded-xl border-2 border-white/10 bg-white/5 animate-pulse" />
                            ))
                            : Array.from({ length: shardBalance }).map((_, i) => (
                                <ShardCard
                                    key={i}
                                    index={i}
                                    isSelected={selectedShardIndices.has(i)}
                                    onToggle={onShardToggle}
                                    disabled={isShardDisabled}
                                />
                            ))
                        }
                    </div>

                    {!isLoadingShards && shardBalance === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <p className="text-white/30 text-sm font-mono mb-1">No energy shards found</p>
                            <p className="text-white/20 text-xs">Win shards in the Glitch Game.</p>
                        </div>
                    )}
                </div>

                <div className="flex gap-2 mt-4 pt-4 border-t border-white/10 flex-shrink-0">
                    {selectedShardCount > 0 ? (
                        <button
                            onClick={onShardDeselect}
                            disabled={isShardDisabled}
                            className={`flex-1 h-11 flex items-center justify-center gap-2 rounded-xl border text-xs font-black uppercase tracking-wider transition-all
                                ${isShardDisabled ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed' : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/20 hover:text-white cursor-pointer'}`}
                        >
                            Deselect All
                        </button>
                    ) : canSelect ? (
                        <button
                            onClick={() => onShardSelectMany(selectTarget)}
                            disabled={isShardDisabled}
                            className={`flex-1 h-11 flex items-center justify-center gap-2 rounded-xl border text-xs font-black uppercase tracking-wider transition-all
                                ${isShardDisabled ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed' : 'bg-white text-black border-white hover:bg-blue-600 hover:border-blue-600 hover:text-white cursor-pointer'}`}
                        >
                            Select {selectTarget}
                        </button>
                    ) : (
                        <div className="flex-1 h-11 flex items-center justify-center text-xs font-mono text-white/40">
                            Need {Math.max(0, 30 - shardBalance)} more shards
                        </div>
                    )}
                </div>
            </>
        )
    }

    return (
        <div className="flex flex-col h-full rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden relative">
            {/* Flat tab header */}
            <div className="flex border-b border-white/10 relative flex-shrink-0">
                <button
                    onClick={() => onTabChange('batteries')}
                    className={`flex-1 py-4 flex items-center justify-center text-xs font-bold uppercase tracking-wider transition-all
                        ${activeTab === 'batteries'
                            ? 'text-white bg-white/5 shadow-[inset_0_-1px_0_0_#fff]'
                            : 'text-white/40 hover:text-white/60 hover:bg-white/[0.02]'}`}
                >
                    Batteries
                </button>
                <div className="w-px bg-white/10 flex-shrink-0" />
                <button
                    onClick={() => onTabChange('shards')}
                    className={`flex-1 py-4 flex items-center justify-center text-xs font-bold uppercase tracking-wider transition-all
                        ${activeTab === 'shards'
                            ? 'text-white bg-white/5 shadow-[inset_0_-1px_0_0_#fff]'
                            : 'text-white/40 hover:text-white/60 hover:bg-white/[0.02]'}`}
                >
                    Shards
                </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 p-4 overflow-hidden flex flex-col">
                {activeTab === 'batteries' ? renderBatteriesTab() : renderShardsTab()}
            </div>
        </div>
    )
}
