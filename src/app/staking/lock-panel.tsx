"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowDown, TriangleAlert, Zap } from "lucide-react"
import { NFTItem } from "@/app/upgrade_module/page"
import { resolveImageUrl } from "@/lib/utils"
import { formatMultiplier, multiplierX100Of, type DroidTier } from "@/lib/locker"

export type Quote = {
    items: Array<{ tokenId: string; tier: DroidTier; multiplierX100: number }>
    addedPointsX100: number
    totalPointsX100: number
    freemintsBefore: number
    freemintsAfter: number
    freemintsGained: number
    remainderX100: number
}

const TIER_ORDER: DroidTier[] = ['lvl1', 'lvl2', 'lvl2super']

const GAP = 8
const MIN_COLS = 4
const MAX_COLS = 26

/**
 * Picks the column count that shows every selected droid as large as it can while still fitting.
 *
 * The grid used to scroll once the selection outgrew the box, which hid part of what you were about
 * to lock forever — the worst possible thing to put behind a scrollbar. Instead the tiles shrink:
 * walk column counts from few to many and take the first that fits the measured box, so the tiles
 * are always the largest size that keeps the whole selection on screen.
 */
function useFittedColumns(ref: React.RefObject<HTMLDivElement>, count: number) {
    const [cols, setCols] = useState(8)

    useEffect(() => {
        const el = ref.current
        if (!el) return

        const compute = () => {
            const width = el.clientWidth
            const height = el.clientHeight
            if (!width || !height || count === 0) return setCols(8)

            for (let c = MIN_COLS; c <= MAX_COLS; c++) {
                const tile = (width - (c - 1) * GAP) / c
                const rows = Math.ceil(count / c)
                if (rows * tile + (rows - 1) * GAP <= height) return setCols(c)
            }
            // Past this the tiles would be unreadable, so the container keeps `overflow-y-auto`
            // as a safety net. In practice it never appears — a 600x300 box fits ~300 tiles at
            // 26 columns — but cropping the selection would be far worse than a rare scrollbar.
            setCols(MAX_COLS)
        }

        compute()
        const observer = new ResizeObserver(compute)
        observer.observe(el)
        return () => observer.disconnect()
    }, [ref, count])

    return cols
}

function DroidGrid({ droids, cols }: { droids: NFTItem[]; cols: number }) {
    const style = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: `${GAP}px` }

    if (droids.length === 0) {
        return (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: `${GAP}px` }}>
                {Array.from({ length: 8 }).map((_, i) => (
                    <div
                        key={i}
                        className="aspect-square rounded-lg border border-dashed border-white/[0.08]"
                        style={{ opacity: 1 - i * 0.1 }}
                    />
                ))}
            </div>
        )
    }

    return (
        <div className="grid" style={style}>
            <AnimatePresence mode="popLayout">
                {droids.map((droid) => {
                    const meta = { level: droid.level, is_super: droid.metadata?.is_super }
                    return (
                        <motion.div
                            key={droid.id}
                            layout
                            initial={{ opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.85 }}
                            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                            className="relative aspect-square rounded-lg overflow-hidden border border-white/15 bg-black"
                        >
                            <img src={resolveImageUrl(droid.image)} alt={droid.name} className="w-full h-full object-cover" />
                            {cols <= 12 && (
                                <span className="absolute bottom-0.5 left-0.5 bg-black/70 backdrop-blur-sm px-1 py-px rounded text-[8px] font-mono font-bold text-white leading-none">
                                    {formatMultiplier(multiplierX100Of(meta))}
                                </span>
                            )}
                        </motion.div>
                    )
                })}
            </AnimatePresence>
        </div>
    )
}

/**
 * The selection broken down by level.
 *
 * Written the same way the badge on each droid is written — the multiplier first, then how many of
 * them are in the basket. Separate rings made the count look like its own metric; keeping one plate
 * per tier means the summary reads as the tiles do, just aggregated.
 */
function TierTotals({ quote }: { quote: Quote | null }) {
    if (!quote || quote.items.length === 0) return null

    const counts = quote.items.reduce<Record<string, { n: number; x100: number }>>((acc, item) => {
        acc[item.tier] = { n: (acc[item.tier]?.n ?? 0) + 1, x100: item.multiplierX100 }
        return acc
    }, {})

    return (
        <div className="flex items-center gap-2 flex-wrap">
            {TIER_ORDER.filter((t) => counts[t]).map((tier) => (
                <span
                    key={tier}
                    className="flex items-baseline gap-1 bg-black/60 border border-white/10 rounded px-2 py-1 text-[11px] font-mono font-bold tabular-nums"
                >
                    <span className="text-white">{formatMultiplier(counts[tier].x100)}</span>
                    <span className="text-white/35">×{counts[tier].n}</span>
                </span>
            ))}

            <span className="text-[10px] font-mono text-white/25 px-1">=</span>
            <span className="text-[11px] font-mono font-bold text-white tabular-nums">
                {(quote.addedPointsX100 / 100).toFixed(2)} pts
            </span>
        </div>
    )
}

export function LockPanel({
    selected,
    quote,
    isQuoting,
    freemintsHeld,
    registryConfigured,
    onContinue,
    onClear,
}: {
    selected: NFTItem[]
    quote: Quote | null
    isQuoting: boolean
    freemintsHeld: number
    registryConfigured: boolean
    onContinue: () => void
    onClear: () => void
}) {
    const gridRef = useRef<HTMLDivElement>(null)
    const cols = useFittedColumns(gridRef, selected.length)

    const hasSelection = selected.length > 0
    const gained = quote?.freemintsGained ?? 0
    const total = quote?.freemintsAfter ?? freemintsHeld
    const carry = quote?.remainderX100 ?? 0

    return (
        <div className="w-full h-full flex flex-col min-h-0">
            {/* ── You lock — the side that actually needs room ─────────────────────── */}
            <div className="flex-1 min-h-0 rounded-xl border border-white/10 bg-black/30 p-4 flex flex-col">
                <div className="flex items-center justify-between gap-3 flex-shrink-0">
                    <span className="text-[9px] font-black uppercase tracking-[0.25em] text-white/35">You lock</span>
                    {hasSelection && (
                        <button
                            onClick={onClear}
                            className="text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-white transition-colors cursor-pointer"
                        >
                            Clear
                        </button>
                    )}
                </div>

                <div ref={gridRef} className="mt-3 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    <DroidGrid droids={selected} cols={cols} />
                </div>

                <div className="mt-3 pt-3 border-t border-white/[0.07] flex-shrink-0 min-h-[28px] flex items-center">
                    {hasSelection ? (
                        <TierTotals quote={quote} />
                    ) : (
                        <span className="text-[10px] font-mono text-white/30">
                            Pick droids from your collection — Level 2 is worth 1.1x, Super 1.5x
                        </span>
                    )}
                </div>
            </div>

            {/* ── Direction ───────────────────────────────────────────────────────── */}
            <div className="flex-shrink-0 flex justify-center py-2">
                <div
                    className={`h-7 w-7 rounded-full border flex items-center justify-center transition-colors ${
                        hasSelection ? 'border-white/25 bg-white/[0.06]' : 'border-white/10'
                    }`}
                >
                    <ArrowDown size={12} className={`text-white ${hasSelection ? 'icon-dim-70' : 'icon-dim-25'}`} />
                </div>
            </div>

            {/* ── You receive — one number, so one line ───────────────────────────── */}
            <div
                className={`flex-shrink-0 rounded-xl border px-4 py-3 flex items-center gap-4 transition-colors ${
                    hasSelection ? 'border-yellow-300/25 bg-yellow-300/[0.05]' : 'border-white/10 bg-black/30'
                }`}
            >
                <div
                    className={`w-12 h-12 rounded-lg overflow-hidden border flex-shrink-0 transition-opacity ${
                        hasSelection ? 'border-yellow-300/30 opacity-100' : 'border-white/10 opacity-25'
                    }`}
                >
                    <img src="/gnanas-logo.png" alt="Gnanas" className="w-full h-full object-cover" />
                </div>

                {/* The thing being traded for. It was a small grey caption next to a number and
                    simply did not register — the reward should be the loudest line in the row. */}
                <div className="min-w-0">
                    <span
                        className={`block text-2xl md:text-[28px] font-black leading-none tracking-tight whitespace-nowrap ${
                            hasSelection ? 'text-yellow-300' : 'text-white/20'
                        }`}
                    >
                        {isQuoting ? '—' : hasSelection ? `+${gained}` : '0'} Gnanas™{' '}
                        {gained === 1 ? 'Freemint' : 'Freemints'}
                    </span>
                </div>

                <div className="ml-auto text-right text-[10px] font-mono text-white/35 tabular-nums whitespace-nowrap">
                    <div className="text-[8px] font-black uppercase tracking-[0.2em] text-white/25">You receive</div>
                    <div className="mt-0.5">
                        {total} total{carry > 0 && <> · {(carry / 100).toFixed(2)} carry</>}
                    </div>
                </div>
            </div>

            {/* ── Terms ───────────────────────────────────────────────────────────── */}
            <div className="flex-shrink-0 mt-3.5 space-y-1.5">
                <div className="flex items-start gap-2">
                    <TriangleAlert size={11} className="text-red-400 mt-[3px] flex-shrink-0" />
                    <p className="text-[10px] font-bold text-red-300/75 leading-snug">
                        Permanent — never sellable or transferable again, not even to your own second wallet.
                    </p>
                </div>
                <div className="flex items-start gap-2">
                    <Zap size={11} className="text-red-400 mt-[3px] flex-shrink-0" />
                    <p className="text-[10px] font-bold text-red-300/75 leading-snug">
                        A locked droid can never be sent to Working.
                    </p>
                </div>
            </div>

            {/* ── Action — same shape and weight as every other primary CTA ───────── */}
            <div className="flex-shrink-0 mt-4">
                <button
                    onClick={onContinue}
                    disabled={!hasSelection || isQuoting || !registryConfigured}
                    className={`group relative w-full h-12 md:h-14 flex items-center justify-center gap-3 uppercase font-black tracking-widest text-sm md:text-base rounded-full border-2 transition-all duration-300 shadow-2xl ${
                        hasSelection && registryConfigured && !isQuoting
                            ? 'bg-white border-white text-black hover:bg-blue-600 hover:border-blue-600 hover:text-white hover:shadow-[0_0_20px_rgba(37,99,235,0.6)] cursor-pointer'
                            : 'bg-white/5 text-white/30 border-white/10 cursor-default'
                    }`}
                >
                    {!registryConfigured
                        ? 'Not Live Yet'
                        : hasSelection
                            ? `Lock ${selected.length} ${selected.length === 1 ? 'Droid' : 'Droidz'} Forever`
                            : 'Select Droidz'}
                </button>
            </div>
        </div>
    )
}
