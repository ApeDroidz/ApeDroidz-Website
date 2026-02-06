"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { NFTItem } from "@/app/dashboard/page"
import { resolveImageUrl } from "@/lib/utils"
import { RefreshCcw, Check, ChevronDown, Lock } from "lucide-react"

type DroidFilter = 'ALL' | 'LVL 1' | 'LVL 2' | 'LVL 2 SUPER' | 'LVL 3'

interface GridDroidSelectorProps {
    droids: NFTItem[]
    selectedDroids: NFTItem[]
    onToggleSelect: (droid: NFTItem) => void
    onSelectAll: (filteredDroids: NFTItem[]) => void
    onRefresh?: () => Promise<void> | void
    isLoading?: boolean
}

// === FILTER DROPDOWN (reused from dashboard) ===
const FilterDropdown = ({ options, activeFilter, onSelect }: { options: any[], activeFilter: string, onSelect: (val: any) => void }) => {
    const [isOpen, setIsOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const activeLabel = options.find(o => o.value === activeFilter)?.label || "FILTER"

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="cursor-pointer flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] uppercase font-bold tracking-wider text-white/70 transition-all hover:bg-white/10 border border-white/10"
            >
                {activeLabel}
                <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className="absolute top-full right-0 mt-2 w-36 bg-[#0a0a0a] border border-white/20 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col py-1">
                    {options.map((opt) => (
                        <button
                            key={opt.value}
                            disabled={opt.locked}
                            onClick={() => { if (!opt.locked) { onSelect(opt.value); setIsOpen(false) } }}
                            className={`flex items-center justify-between px-4 py-2 text-[10px] uppercase font-bold tracking-wider text-left transition-colors w-full ${opt.locked ? 'opacity-40 cursor-not-allowed text-white/50' : 'hover:bg-white/10 cursor-pointer text-white'} ${activeFilter === opt.value ? 'bg-white/5 text-blue-400' : ''} ${opt.color === 'orange' ? 'text-orange-400 hover:text-orange-300' : ''}`}
                        >
                            <span className="flex items-center gap-2">{opt.locked && <Lock size={10} />}{opt.label}</span>
                            {activeFilter === opt.value && <Check size={12} />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// === DROID CARD ===
const GridDroidCard = ({
    item,
    isSelected,
    onToggle,
}: {
    item: NFTItem
    isSelected: boolean
    onToggle: (item: NFTItem) => void
}) => {
    const tokenNumber = item.name.match(/#(\d+)/)?.[1] || item.id.replace(/[^0-9]/g, '') || item.id
    const displayId = `#${tokenNumber}`
    const [isLoaded, setIsLoaded] = useState(false)

    let borderColor = "border-white/20 hover:border-white/50"
    if (isSelected) {
        borderColor = "border-[#3B82F6] shadow-[0_0_15px_rgba(59,130,246,0.4)]"
    }

    return (
        <div
            onClick={() => onToggle(item)}
            className={`group relative aspect-square rounded-lg overflow-hidden cursor-pointer transition-all duration-200 border-2 ${borderColor} bg-black`}
        >
            {!isLoaded && (
                <div className="absolute inset-0 bg-white/5 animate-pulse" />
            )}
            <img
                src={resolveImageUrl(item.image)}
                alt={item.name}
                onLoad={() => setIsLoaded(true)}
                className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                loading="lazy"
            />
            <div className="absolute top-1 right-1 bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded text-[8px] font-mono text-white font-bold z-20">
                {displayId}
            </div>
            {isSelected && (
                <div className="absolute top-1 left-1 bg-[#3B82F6] rounded-full p-0.5 z-20">
                    <Check size={10} className="text-white" />
                </div>
            )}
        </div>
    )
}

export function GridDroidSelector({
    droids,
    selectedDroids,
    onToggleSelect,
    onSelectAll,
    onRefresh,
    isLoading = false
}: GridDroidSelectorProps) {
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [activeFilter, setActiveFilter] = useState<DroidFilter>('ALL')

    const handleRefresh = async () => {
        if (!onRefresh) return
        setIsRefreshing(true)
        await onRefresh()
        setTimeout(() => setIsRefreshing(false), 500)
    }

    const selectedIds = useMemo(() => new Set(selectedDroids.map(d => d.id)), [selectedDroids])

    // Filter droids
    const filteredDroids = useMemo(() => {
        return droids.filter(item => {
            const level = item.level || 1
            const isSuper = item.metadata?.attributes?.some((a: any) =>
                (a.trait_type === "upgrade level" && a.value?.includes("super")) ||
                (a.trait_type === "background" && a.value === "apechain_orange")
            )
            if (activeFilter === 'ALL') return true
            if (activeFilter === 'LVL 1') return level === 1
            if (activeFilter === 'LVL 2') return level === 2 && !isSuper
            if (activeFilter === 'LVL 2 SUPER') return level === 2 && isSuper
            if (activeFilter === 'LVL 3') return level === 3
            return true
        })
    }, [droids, activeFilter])

    const filterOptions = [
        { label: 'All Droidz', value: 'ALL' },
        { label: 'Level 1', value: 'LVL 1' },
        { label: 'Level 2', value: 'LVL 2' },
        { label: 'Level 2 Super', value: 'LVL 2 SUPER', color: 'orange' },
        { label: 'Level 3', value: 'LVL 3', locked: true }
    ]

    const loadingSkeletons = Array.from({ length: 8 })
    const allSelected = filteredDroids.length > 0 && filteredDroids.every(d => selectedIds.has(d.id))

    return (
        <div className="flex flex-col h-full rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-3 md:p-4 relative">
            {/* Header */}
            <div className="flex items-center justify-between mb-3 flex-shrink-0 relative z-30">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold tracking-wider text-white/90 uppercase">Your Droidz</h3>
                    <span className="text-[10px] text-white/40 font-mono">({filteredDroids.length})</span>
                    {onRefresh && (
                        <button
                            onClick={handleRefresh}
                            disabled={isRefreshing || isLoading}
                            className="cursor-pointer p-1 rounded-full hover:bg-white/10 transition-colors group"
                        >
                            <RefreshCcw
                                size={12}
                                className={`text-white/40 group-hover:text-white transition-all ${(isRefreshing || isLoading) ? 'animate-spin opacity-50' : ''}`}
                            />
                        </button>
                    )}
                </div>
                <FilterDropdown options={filterOptions} activeFilter={activeFilter} onSelect={setActiveFilter} />
            </div>

            {/* Selected count */}
            <div className="mb-3 px-2 py-1.5 rounded-lg bg-[#3B82F6]/10 border border-[#3B82F6]/20">
                <span className="text-[10px] text-[#3B82F6] font-bold uppercase tracking-wider">
                    {selectedDroids.length} droid{selectedDroids.length !== 1 ? 'z' : ''} in grid
                </span>
            </div>

            {/* Grid - 4 columns */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 min-h-0">
                <div className="grid grid-cols-4 gap-2 pb-2">
                    {isLoading ? (
                        loadingSkeletons.map((_, i) => (
                            <div key={i} className="aspect-square rounded-lg overflow-hidden border-2 border-white/10 bg-white/5 animate-pulse" />
                        ))
                    ) : (
                        filteredDroids.map((item) => (
                            <GridDroidCard
                                key={item.id}
                                item={item}
                                isSelected={selectedIds.has(item.id)}
                                onToggle={onToggleSelect}
                            />
                        ))
                    )}
                </div>
            </div>

            {/* SELECT ALL button at bottom */}
            <button
                onClick={() => onSelectAll(filteredDroids)}
                className={`w-full py-2.5 mt-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all duration-300 border cursor-pointer flex-shrink-0
          ${allSelected
                        ? 'bg-[#0069FF] border-[#0069FF] text-white hover:bg-[#0055CC]'
                        : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10 hover:text-white hover:border-white/40'
                    }`}
            >
                {allSelected ? '✓ All Selected' : `Select All ${activeFilter === 'ALL' ? 'Droidz' : activeFilter}`}
            </button>
        </div>
    )
}
