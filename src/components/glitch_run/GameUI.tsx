'use client'

import { useMemo, useState, useEffect, useRef, useCallback, CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useActiveAccount, useSendAndConfirmTransaction } from 'thirdweb/react'
import { createThirdwebClient, defineChain, prepareTransaction, toWei } from 'thirdweb'
import { X, Trophy, ExternalLink, Loader2, Share2 } from 'lucide-react'

const thirdwebClient = createThirdwebClient({ clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID! })
const apeChain = defineChain(33139)
const VAULT_WALLET = process.env.NEXT_PUBLIC_FLIGHT_VAULT_WALLET_ADDRESS!

// ─── Sound helper ─────────────────────────────────────────────────────────────
function playUiSound(type: 'hover' | 'click' | 'cashout' = 'click') {
    const map = {
        hover:   ['/sounds/fx/ui_hover_buttons.mp3', 0.25],
        click:   ['/sounds/fx/crd_pick_sound.mp3',   0.45],
        cashout: ['/sounds/fx/win(1).MP3',           0.5 ],
    } as const
    const [file, vol] = map[type]
    const a = new Audio(file as string)
    a.volume = vol as number
    a.play().catch(() => {})
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface RoundResult {
    crashPoint: number
    userResult?: 'won' | 'lost' | null  // null = user didn't play this round
}

// ─── Multiplier overlay (sits over the canvas) ────────────────────────────────
export function MultiplierOverlay({
    phase,
    multiplier,
    countdown,
    crashPoint,
    cashedOutAt,
    lastXpGained,
}: {
    phase: 'waiting' | 'running' | 'crashed'
    multiplier: number
    countdown: number
    crashPoint?: number
    cashedOutAt?: number | null
    lastXpGained?: number
}) {
    const color = useMemo(() => {
        if (phase === 'crashed') return 'text-white/80'
        if (multiplier < 2) return 'text-[#00FF94]'
        if (multiplier < 5) return 'text-yellow-300'
        return 'text-orange-400'
    }, [multiplier, phase])

    const glow = useMemo(() => {
        if (phase === 'crashed') return 'drop-shadow-[0_0_20px_rgba(255,255,255,0.25)]'
        if (multiplier < 2) return 'drop-shadow-[0_0_20px_rgba(0,255,148,0.75)]'
        if (multiplier < 5) return 'drop-shadow-[0_0_28px_rgba(255,240,0,0.7)]'
        return 'drop-shadow-[0_0_36px_rgba(255,150,0,0.85)]'
    }, [multiplier, phase])

    const hasCashedOut = cashedOutAt != null && cashedOutAt > 0

    return (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-start pt-5 z-10">
            <AnimatePresence mode="wait">
                {phase === 'waiting' ? (
                    <motion.div
                        key="waiting"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="flex flex-col items-center gap-1"
                    >
                        <span className="text-white/40 text-[10px] uppercase tracking-[0.28em] font-mono">
                            Next flight in
                        </span>
                        <span className="text-5xl font-black font-mono text-[#00FF94] drop-shadow-[0_0_24px_rgba(0,255,148,0.7)]">
                            {countdown}s
                        </span>
                    </motion.div>
                ) : (
                    <motion.div
                        key="multiplier"
                        initial={{ scale: 0.85, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex flex-col items-center gap-1"
                    >
                        {/* Global multiplier (during running) or "CRASHED" (after).
                            We deliberately hide the exact crash multiplier from
                            the public UI — players see only their own cashout
                            value (Aped out below). This prevents pattern-
                            recognition of the cap mechanism and keeps the cap
                            tier values out of public view. Provably-fair audit
                            still works via the revealed serverSeed. */}
                        <div className={`text-4xl sm:text-6xl md:text-7xl font-black font-mono transition-all duration-75 ${color} ${glow}`}>
                            {phase === 'crashed'
                                ? 'CRASHED'
                                : `${multiplier.toFixed(2)}x`}
                        </div>

                        {/* Show your locked cashout + XP immediately when APEd out (running or crashed) */}
                        {hasCashedOut && (phase === 'running' || phase === 'crashed') ? (
                            <motion.div
                                key="cashedOutXp"
                                initial={{ opacity: 0, y: 8, scale: 0.8 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ type: 'spring', damping: 14, stiffness: 260 }}
                                className="flex flex-col items-center gap-0.5 mt-1"
                            >
                                {phase === 'crashed' && (
                                    <span className="text-[9px] text-white/35 font-mono uppercase tracking-[0.25em]">
                                        Aped out {cashedOutAt!.toFixed(2)}x
                                    </span>
                                )}
                                {lastXpGained ? (
                                    <span className="text-xl sm:text-2xl font-black text-[#00FF94] drop-shadow-[0_0_18px_rgba(0,255,148,0.85)]">
                                        +{lastXpGained} XP
                                    </span>
                                ) : null}
                            </motion.div>
                        ) : phase === 'crashed' && lastXpGained ? (
                            /* Crash with no cashout (lost) */
                            <motion.div
                                key="lostXp"
                                initial={{ opacity: 0, y: 8, scale: 0.8 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ type: 'spring', damping: 14, stiffness: 260 }}
                                className="mt-1"
                            >
                                <span className="text-lg sm:text-xl font-black text-white/50 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">
                                    +{lastXpGained} XP
                                </span>
                            </motion.div>
                        ) : null}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

// ─── Round history pills ──────────────────────────────────────────────────────
// Each pill shows the round's actual crash multiplier (e.g. "2.34x") with
// colour banded by tier so a streak of low/high crashes is immediately
// visible. Rounds the player bet on get a stronger outline + W/L tinting
// so you can spot your own rounds in the strip.
//
// Tiers — mirror the live MultiplierOverlay palette so the strip "feels"
// like the running multiplier: starts green and warms toward red as X
// climbs. Adds a red tier for extreme rounds beyond the overlay's reach.
//   green  : < 2x    — safe early-cash zone
//   yellow : 2–5x    — getting hot
//   orange : 5–10x   — danger
//   red    : ≥ 10x   — bank-bender
function tierCls(crash: number): { text: string; border: string } {
    if (crash < 2)   return { text: 'text-[#00FF94]',  border: 'border-[#00FF94]/40' }
    if (crash < 5)   return { text: 'text-yellow-300', border: 'border-yellow-300/30' }
    if (crash < 10)  return { text: 'text-orange-400', border: 'border-orange-400/30' }
    return                  { text: 'text-red-400',    border: 'border-red-500/30' }
}

export function RoundHistoryPills({ history }: { history: RoundResult[] }) {
    return (
        <div className="flex gap-1.5 items-center overflow-hidden flex-nowrap flex-1 min-w-0">
            {history.slice(0, 20).map((r, i) => {
                const x    = r.crashPoint ?? 1
                const tier = tierCls(x)
                const won  = r.userResult === 'won'
                const lost = r.userResult === 'lost'
                // Bet rounds — emphasise outline + a tiny W/L badge before the multiplier.
                const outline = won
                    ? 'bg-[#00FF94]/10 border-[#00FF94]/60'
                    : lost
                    ? 'bg-red-500/10 border-red-500/60'
                    : `bg-white/[0.02] ${tier.border}`
                return (
                    <span
                        key={i}
                        className={`min-w-[36px] px-1.5 py-0.5 rounded text-[10px] font-mono font-black border shrink-0 text-center ${outline} ${tier.text}`}
                        title={won ? 'You won' : lost ? 'You lost' : undefined}
                    >
                        {x.toFixed(2)}x
                    </span>
                )
            })}
        </div>
    )
}

// ─── Round history list (inside history tab) ──────────────────────────────────
function RoundHistoryList({ history }: { history: RoundResult[] }) {
    return (
        <div className="flex flex-col divide-y divide-white/5">
            {history.slice(0, 20).map((r, i) => {
                const x    = r.crashPoint ?? 1
                const tier = tierCls(x)
                const won  = r.userResult === 'won'
                const lost = r.userResult === 'lost'
                return (
                    <div key={i} className="px-5 py-2.5 flex items-center justify-between">
                        <span className="text-white/30 text-[11px] font-mono">Round #{history.length - i}</span>
                        <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-mono font-black ${tier.text}`}>
                                {x.toFixed(2)}x
                            </span>
                            {(won || lost) && (
                                <span className={`text-[9px] font-mono font-black uppercase tracking-widest ${won ? 'text-[#00FF94]' : 'text-red-400'}`}>
                                    {won ? 'Won' : 'Lost'}
                                </span>
                            )}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

// ─── S2 Leaderboard popup ─────────────────────────────────────────────────────
function rankColor(rank: number, isMe: boolean): string {
    if (rank === 1) return 'text-yellow-400'
    if (rank === 2) return 'text-slate-300'
    if (rank === 3) return ''
    if (isMe) return 'text-[#3b82f6]'
    return 'text-[#3b82f6]'
}

function rankStyle(rank: number): CSSProperties | undefined {
    if (rank === 3) return {
        background: 'linear-gradient(135deg, #D9A051, #9F602D)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
    }
    return undefined
}

function S2LeaderboardModal({ isOpen, onClose, wallet }: { isOpen: boolean; onClose: () => void; wallet?: string }) {
    const [data, setData] = useState<any[]>([])
    const [playerRank, setPlayerRank] = useState<number | null>(null)
    const [playerXp, setPlayerXp] = useState<number | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!isOpen) return
        setLoading(true)
        setData([])
        const param = wallet ? `&wallet=${wallet}` : ''
        fetch(`/api/leaderboard/season2?limit=50${param}`)
            .then(r => r.json())
            .then(d => {
                setData(d.leaderboard ?? [])
                if (d.player?.rank) setPlayerRank(d.player.rank)
                if (d.player?.season_xp != null) setPlayerXp(d.player.season_xp)
            })
            .finally(() => setLoading(false))
    }, [isOpen, wallet])

    if (!isOpen) return null

    // Render via portal at document.body — bypasses any ancestor stacking context
    // created by Framer Motion transforms, preventing the game scene from rendering on top
    const modal = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            {/* Full-screen backdrop — blurs and darkens everything behind */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-xl"
                onClick={onClose}
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                onClick={e => e.stopPropagation()}
                className="relative w-full max-w-2xl bg-black/90 backdrop-blur-3xl border border-white/10 rounded-[40px] shadow-[0_0_80px_rgba(0,0,0,0.9),0_0_40px_rgba(59,130,246,0.06)] overflow-hidden flex flex-col h-[80vh] max-h-[800px]"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 sm:p-8 border-b border-white/5 bg-white/[0.02] shrink-0">
                    <div className="flex flex-col">
                        <div className="text-xl sm:text-2xl font-black text-white uppercase tracking-tight leading-none flex items-center gap-2">
                            <span className="text-[#3b82f6]">SEASON 2</span> LEADERBOARD
                        </div>
                        <span className="text-[10px] sm:text-xs text-white/40 uppercase font-bold tracking-[0.2em] mt-1">Glitch Cards + Glitch Flight XP</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-3 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-full transition-all"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* List — compact rows that match S2LeaderboardPanel + ProfileModal */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                    <div className="flex flex-col gap-2">
                        {loading ? (
                            Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="flex items-center px-3 py-3 rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse">
                                    <div className="w-10 h-5 bg-white/10 rounded mr-2 shrink-0" />
                                    <div className="flex-1 flex flex-col gap-1.5">
                                        <div className="h-4 w-28 bg-white/10 rounded" />
                                        <div className="h-2.5 w-20 bg-white/5 rounded" />
                                    </div>
                                    <div className="h-5 w-14 bg-white/10 rounded" />
                                </div>
                            ))
                        ) : data.length === 0 ? (
                            <div className="py-12 text-center text-white/20 text-xs font-mono">No data yet</div>
                        ) : (
                            data.map((entry: any) => {
                                const isMe = entry.wallet?.toLowerCase() === wallet?.toLowerCase()
                                const displayName = entry.username
                                    ? entry.username
                                    : `${entry.wallet?.slice(0, 6)}…${entry.wallet?.slice(-4)}`

                                // Per-rank colours mirror RankBadge / RankXp atoms used elsewhere.
                                const rankCls =
                                    entry.rank === 1 ? 'text-yellow-400'
                                    : entry.rank === 2 ? 'text-slate-300'
                                    : entry.rank === 3 ? '' : 'text-white/40'
                                const rankSty =
                                    entry.rank === 3
                                        ? { background: 'linear-gradient(135deg,#D9A051,#9F602D)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }
                                        : undefined

                                return (
                                    <div
                                        key={entry.wallet}
                                        className={`flex items-center px-3 py-2.5 rounded-2xl border transition-all ${
                                            isMe
                                                ? 'bg-[#3b82f6]/10 border-[#3b82f6]/40 shadow-[0_0_16px_rgba(59,130,246,0.12)]'
                                                : 'bg-white/[0.025] border-transparent hover:border-white/10 hover:bg-white/[0.05]'
                                        }`}
                                    >
                                        <span className={`font-black text-lg w-10 shrink-0 ${rankCls}`} style={rankSty}>
                                            #{entry.rank}
                                        </span>

                                        <div className="flex-1 min-w-0 pr-2">
                                            <div className={`text-sm font-black uppercase tracking-tight flex items-center gap-1.5 min-w-0 ${isMe ? 'text-[#3b82f6]' : 'text-white'}`}>
                                                <span className="truncate">{isMe ? 'You' : displayName}</span>
                                                {entry.x_handle && (
                                                    <a
                                                        href={`https://x.com/${entry.x_handle.replace('@', '')}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={e => e.stopPropagation()}
                                                        className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
                                                        title={entry.x_handle}
                                                    >
                                                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                                                    </a>
                                                )}
                                            </div>
                                            <div className="text-[9px] text-white/30 uppercase font-black tracking-widest flex items-center gap-1.5 mt-0.5">
                                                <span>{entry.games_played} cards</span>
                                                <span className="opacity-40">·</span>
                                                <span>{entry.flights_played} flights</span>
                                                {entry.quests_finished != null && (<>
                                                    <span className="opacity-40">·</span>
                                                    <span>{entry.quests_finished} quests</span>
                                                </>)}
                                            </div>
                                        </div>

                                        <div className="text-right shrink-0">
                                            <div className={`text-base font-black ${rankCls}`} style={rankSty ?? undefined}>
                                                {new Intl.NumberFormat('en-US').format(entry.season_xp)}
                                            </div>
                                            <div className="text-[8px] font-black uppercase text-white/30 tracking-widest">XP</div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    )

    if (typeof document === 'undefined') return null
    return createPortal(modal, document.body)
}

// ─── Top Pilots / My Flights history section ──────────────────────────────────
interface MyFlightEntry {
    id: string
    bet_amount: number
    cashout_at: number | null
    profit: number | null
    xp_gained: number
    created_at: string
    flight_sessions: { round_number: number; crash_point: number } | null
}

interface TopPilotEntry {
    rank: number
    wallet: string
    best_profit: number
    best_multiplier: number
    bet_amount: number
}

function FlightHistorySection({ wallet, refreshTrigger }: { wallet?: string; refreshTrigger?: number }) {
    type Tab = 'pilots' | 'flights'
    const [tab, setTab] = useState<Tab>('pilots')
    const [pilots, setPilots] = useState<TopPilotEntry[]>([])
    const [flights, setFlights] = useState<MyFlightEntry[]>([])
    const [pilotsLoading, setPilotsLoading] = useState(false)
    const [flightsLoading, setFlightsLoading] = useState(false)
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(0)
    const PAGE = 15

    // Always reload pilots when switching to pilots tab
    useEffect(() => {
        if (tab !== 'pilots') return
        setPilotsLoading(true)
        fetch('/api/flight/top-pilots?limit=10')
            .then(r => r.json())
            .then(d => setPilots(d.pilots ?? []))
            .finally(() => setPilotsLoading(false))
    }, [tab])

    // Load My Flights: on tab switch, on wallet connect, on page change, or after a round ends
    useEffect(() => {
        if (!wallet) return
        setFlightsLoading(true)
        setPage(0)
        fetch(`/api/flight/history?wallet=${wallet}&limit=${PAGE}&offset=0`)
            .then(r => r.json())
            .then(d => { setFlights(d.flights ?? []); setTotal(d.total ?? 0) })
            .finally(() => setFlightsLoading(false))
    }, [wallet, refreshTrigger])

    useEffect(() => {
        if (tab !== 'flights' || !wallet) return
        setFlightsLoading(true)
        fetch(`/api/flight/history?wallet=${wallet}&limit=${PAGE}&offset=${page * PAGE}`)
            .then(r => r.json())
            .then(d => { setFlights(d.flights ?? []); setTotal(d.total ?? 0) })
            .finally(() => setFlightsLoading(false))
    }, [tab, wallet, page])

    return (
        <div className="flex flex-col gap-2 mt-2">
            {/* Sub-tabs */}
            <div className="flex items-center gap-4 px-1 border-b border-white/5 pb-2">
                <button
                    onClick={() => setTab('pilots')}
                    className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest transition-colors pb-1 ${tab === 'pilots' ? 'text-white/50 border-b-2 border-white/40' : 'text-white/25 hover:text-white/45'}`}
                >
                    <Trophy size={11} />
                    Top Pilots
                </button>
                <button
                    onClick={() => setTab('flights')}
                    className={`text-[10px] font-black uppercase tracking-widest transition-colors pb-1 ${tab === 'flights' ? 'text-white/50 border-b-2 border-white/40' : 'text-white/25 hover:text-white/45'}`}
                >
                    My Flights
                </button>
            </div>

            {/* Content */}
            {tab === 'pilots' && (
                <div className="flex flex-col gap-2 relative min-h-[100px]">
                    {pilotsLoading ? (
                        <div className="flex items-center justify-center py-8"><Loader2 size={16} className="animate-spin text-white/30" /></div>
                    ) : pilots.length === 0 ? (
                        <div className="text-center py-6 text-[10px] font-bold tracking-widest text-white/20 uppercase">No flights yet</div>
                    ) : (
                        <div className="max-h-[280px] overflow-y-auto flex flex-col gap-1.5 pb-4
                            [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-white/40"
                            style={{ maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
                            {pilots.map(p => (
                                <div key={p.wallet} className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                                    <span className="text-[11px] font-black w-5 shrink-0 text-white/40">#{p.rank}</span>
                                    <a
                                        href={`https://opensea.io/${p.wallet}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-mono text-[10px] text-white/40 hover:text-white/70 flex-1 truncate flex items-center gap-1 transition-colors"
                                    >
                                        {p.wallet?.slice(0, 6)}…{p.wallet?.slice(-4)}
                                        <ExternalLink size={8} className="shrink-0 opacity-40" />
                                    </a>
                                    <div className="text-right">
                                        <div className="text-[11px] font-black text-emerald-400/70">+{p.best_profit.toFixed(2)} APE</div>
                                        <div className="text-[9px] font-mono text-white/40">{p.best_multiplier.toFixed(2)}x · {p.bet_amount.toFixed(0)} APE in</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {tab === 'flights' && (
                <div className="flex flex-col gap-2 relative min-h-[100px]">
                    {!wallet ? (
                        <div className="text-center py-6 text-[10px] font-bold tracking-widest text-white/20 uppercase">Connect wallet</div>
                    ) : flightsLoading ? (
                        <div className="flex items-center justify-center py-8"><Loader2 size={16} className="animate-spin text-white/30" /></div>
                    ) : flights.length === 0 ? (
                        <div className="text-center py-6 text-[10px] font-bold tracking-widest text-white/20 uppercase">No flights yet</div>
                    ) : (
                        <>
                            <div className="max-h-[280px] overflow-y-auto pr-1 flex flex-col gap-1.5 pb-4"
                                style={{ maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)' }}>
                                {flights.map((f, i) => {
                                    const won = f.cashout_at != null
                                    const shareWin = () => {
                                        // Open an X (Twitter) intent prefilled with the result.
                                        // No image gen here — keeps the click instant; players who
                                        // want a card can screenshot the row.
                                        const text = `Just aped out at ${f.cashout_at?.toFixed(2)}x on Glitch Flight — +${f.profit?.toFixed(2)} APE 🚀\n\nplay → https://apedroidz.com/glitch_flight`
                                        const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
                                        window.open(url, '_blank', 'noopener,noreferrer')
                                    }
                                    return (
                                        <div key={f.id} className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[9px] font-mono text-white/40">#{total - page * PAGE - i}</span>
                                                    <span className={`text-[10px] font-black ${won ? 'text-emerald-400/65' : 'text-white/30'}`}>
                                                        {won ? `Aped Out ${f.cashout_at?.toFixed(2)}x` : 'Crashed'}
                                                    </span>
                                                    {/* Crash multiplier intentionally hidden — players see only their own cashout. */}
                                                </div>
                                                <div className="text-[9px] font-mono text-white/40 mt-0.5">
                                                    +{f.xp_gained} XP · {new Date(f.created_at).toLocaleDateString()}
                                                </div>
                                            </div>
                                            <span className={`text-[11px] font-black shrink-0 ${won ? 'text-emerald-400/65' : 'text-red-400/55'}`}>
                                                {won ? `+${f.profit?.toFixed(2)}` : `-${f.bet_amount.toFixed(2)}`}
                                            </span>
                                            {won && (
                                                <button
                                                    onClick={shareWin}
                                                    className="shrink-0 p-1.5 rounded-lg bg-white/5 hover:bg-[#0069FF]/20 border border-white/10 hover:border-[#0069FF]/40 text-white/30 hover:text-[#0069FF] transition-all cursor-pointer"
                                                    title="Share this flight"
                                                >
                                                    <Share2 className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                            {total > PAGE && (
                                <div className="flex justify-between items-center px-1">
                                    <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                                        className="text-[10px] font-mono text-white/25 hover:text-white disabled:opacity-20">← Prev</button>
                                    <span className="text-[9px] font-mono text-white/20">{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} / {total}</span>
                                    <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE >= total}
                                        className="text-[10px] font-mono text-white/25 hover:text-white disabled:opacity-20">Next →</button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    )
}

// ─── Amount stepper ───────────────────────────────────────────────────────────
function AmountStepper({
    value, onChange, min, max, step = 10, disabled,
}: {
    value: number
    onChange: (v: number) => void
    min: number
    max?: number
    step?: number
    disabled?: boolean
}) {
    // Local string state so user can freely type (including clearing the field)
    const [inputStr, setInputStr] = useState(String(value))
    useEffect(() => { setInputStr(String(value)) }, [value])

    const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min, v))

    const dec = () => onChange(clamp(value - step))
    const inc = () => onChange(clamp(value + step))
    const canDec = !disabled && value > min
    const canInc = !disabled && (max === undefined || value < max)

    const handleBlur = () => {
        const parsed = parseFloat(inputStr)
        const clamped = isNaN(parsed) ? min : clamp(parsed)
        onChange(clamped)
        setInputStr(String(clamped))
    }

    const btnCls = (active: boolean) =>
        `w-9 h-9 flex items-center justify-center rounded-lg border transition-all shrink-0 ${
            active
                ? 'bg-white/10 border-white/20 text-white hover:bg-white/20 hover:border-white/30 cursor-pointer'
                : 'bg-white/5 border-white/[0.08] text-white/20 cursor-not-allowed'
        }`

    return (
        <div className={`flex items-center gap-2 ${disabled ? 'opacity-30 pointer-events-none' : ''}`}>
            <button type="button" onClick={dec} disabled={!canDec} className={btnCls(canDec)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                </svg>
            </button>

            <div className="flex-1 flex items-center justify-center gap-1.5 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                <input
                    type="text"
                    inputMode="numeric"
                    value={inputStr}
                    onChange={e => setInputStr(e.target.value)}
                    onBlur={handleBlur}
                    disabled={disabled}
                    className="bg-transparent text-white text-sm font-extrabold font-mono text-center focus:outline-none w-16 min-w-0"
                />
                <span className="text-white/40 text-xs font-bold font-mono shrink-0">APE</span>
            </div>

            <button type="button" onClick={inc} disabled={!canInc} className={btnCls(canInc)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </button>
        </div>
    )
}

// ─── Tx history types & helpers ───────────────────────────────────────────────
interface TxRow {
    id: string
    type: 'deposit' | 'withdraw'
    amount: number
    status: string
    tx_hash: string | null
    created_at: string
}

function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1)  return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
}

function statusColor(status: string) {
    if (status === 'confirmed') return 'bg-[#00FF94]'
    if (status === 'pending')   return 'bg-yellow-400'
    return 'bg-red-500'
}

// ── Full-history modal ──────────────────────────────────────────────────────
function TxHistoryModal({ wallet, onClose }: { wallet: string; onClose: () => void }) {
    const [rows, setRows]     = useState<TxRow[]>([])
    const [total, setTotal]   = useState(0)
    const [page, setPage]     = useState(0)
    const [loading, setLoading] = useState(true)
    const PAGE = 20

    const load = useCallback(async (p: number) => {
        setLoading(true)
        try {
            const res = await fetch(
                `/api/flight/transactions?wallet=${encodeURIComponent(wallet)}&limit=${PAGE}&offset=${p * PAGE}`,
                { cache: 'no-store' }
            )
            const d = await res.json()
            setRows(d.transactions ?? [])
            setTotal(d.total ?? 0)
        } catch { /* silent */ } finally { setLoading(false) }
    }, [wallet])

    useEffect(() => { load(page) }, [load, page])

    const pages = Math.ceil(total / PAGE)

    return createPortal(
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4"
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                className="relative z-10 w-full max-w-sm bg-[#0a0a0a] border border-white/10 rounded-2xl overflow-hidden flex flex-col max-h-[80vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
                    <div>
                        <div className="text-sm font-black text-white uppercase tracking-tight">Transfer History</div>
                        <div className="text-[9px] text-white/30 font-mono mt-0.5">{total} transactions</div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-all"
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M1 1l10 10M11 1L1 11" />
                        </svg>
                    </button>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto min-h-0
                    [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent
                    [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full"
                >
                    {loading ? (
                        <div className="p-5 flex flex-col gap-2">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="h-10 rounded-xl bg-white/5 animate-pulse" />
                            ))}
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="py-12 text-center text-white/20 text-xs font-mono">No transfers yet</div>
                    ) : (
                        <div className="p-3 flex flex-col gap-1.5">
                            {rows.map(tx => (
                                <div key={tx.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.025] border border-white/[0.06]">
                                    {/* Icon */}
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                        tx.type === 'deposit' ? 'bg-[#00FF94]/10' : 'bg-orange-400/10'
                                    }`}>
                                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                            className={tx.type === 'deposit' ? 'text-[#00FF94]' : 'text-orange-400'}
                                            style={{ color: 'currentColor' }}
                                        >
                                            {tx.type === 'deposit'
                                                ? <><path d="M6 1v8M2 5l4 4 4-4" /><path d="M1 11h10" /></>
                                                : <><path d="M6 11V3M2 7l4-4 4 4" /><path d="M1 1h10" /></>
                                            }
                                        </svg>
                                    </div>
                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] font-black text-white uppercase tracking-wide">
                                                {tx.type === 'deposit' ? '+' : '−'}{tx.amount.toFixed(2)} APE
                                            </span>
                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(tx.status)}`} />
                                        </div>
                                        <div className="text-[9px] text-white/30 font-mono mt-0.5">{timeAgo(tx.created_at)}</div>
                                    </div>
                                    {/* Tx link */}
                                    {tx.tx_hash && (
                                        <a
                                            href={`https://apescan.io/tx/${tx.tx_hash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={e => e.stopPropagation()}
                                            className="text-white/20 hover:text-white/60 transition-colors shrink-0"
                                            title="View on explorer"
                                        >
                                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7" />
                                                <path d="M8 1h3v3" />
                                                <path d="M11 1L5 7" />
                                            </svg>
                                        </a>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Pagination */}
                {pages > 1 && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 shrink-0">
                        <button
                            disabled={page === 0}
                            onClick={() => setPage(p => p - 1)}
                            className="text-[10px] font-mono text-white/30 hover:text-white disabled:opacity-20 transition-colors"
                        >← Prev</button>
                        <span className="text-[9px] font-mono text-white/20">{page + 1} / {pages}</span>
                        <button
                            disabled={page >= pages - 1}
                            onClick={() => setPage(p => p + 1)}
                            className="text-[10px] font-mono text-white/30 hover:text-white disabled:opacity-20 transition-colors"
                        >Next →</button>
                    </div>
                )}
            </motion.div>
        </motion.div>,
        document.body
    )
}

// ── Inline mini-history (last 5 rows, no scroll) ────────────────────────────
function TxHistoryPreview({ wallet, onViewAll, refreshKey }: { wallet: string; onViewAll: () => void; refreshKey: number }) {
    const [rows, setRows]     = useState<TxRow[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        fetch(`/api/flight/transactions?wallet=${encodeURIComponent(wallet)}&limit=5`, { cache: 'no-store' })
            .then(r => r.json())
            .then(d => { if (!cancelled) { setRows(d.transactions ?? []); setLoading(false) } })
            .catch(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [wallet, refreshKey])

    return (
        <div className="flex flex-col gap-2">
            {/* Section header */}
            <div className="flex items-center justify-between">
                <span className="text-[9px] font-black text-white/25 uppercase tracking-[0.2em]">Transfers</span>
                <button
                    onClick={onViewAll}
                    className="text-[9px] font-black text-white/25 hover:text-white/60 uppercase tracking-[0.15em] transition-colors"
                >
                    All →
                </button>
            </div>

            {loading ? (
                <div className="flex flex-col gap-1.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-8 rounded-lg bg-white/5 animate-pulse" />
                    ))}
                </div>
            ) : rows.length === 0 ? (
                <div className="text-center text-white/15 text-[10px] font-mono py-3">No transfers yet</div>
            ) : (
                <div className="flex flex-col gap-1">
                    {rows.map(tx => (
                        <div key={tx.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white/[0.025]">
                            <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                                tx.type === 'deposit' ? 'bg-[#00FF94]/10' : 'bg-orange-400/10'
                            }`}>
                                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                                    className={tx.type === 'deposit' ? 'text-[#00FF94]' : 'text-orange-400'}
                                    style={{ color: 'currentColor' }}
                                >
                                    {tx.type === 'deposit'
                                        ? <><path d="M6 1v8M2 5l4 4 4-4" /><path d="M1 11h10" /></>
                                        : <><path d="M6 11V3M2 7l4-4 4 4" /><path d="M1 1h10" /></>
                                    }
                                </svg>
                            </div>
                            <span className={`text-[11px] font-black flex-1 ${tx.type === 'deposit' ? 'text-[#00FF94]/80' : 'text-orange-400/80'}`}>
                                {tx.type === 'deposit' ? '+' : '−'}{tx.amount.toFixed(2)} APE
                            </span>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(tx.status)}`} />
                            <span className="text-[9px] font-mono text-white/20 shrink-0">{timeAgo(tx.created_at)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ─── Fuel tab (deposit / withdraw) ───────────────────────────────────────────
function FuelTab({
    balance,
    onBalanceChange,
    onRefreshBalance,
    depositStatus,
    setDepositStatus,
    withdrawStatus,
    setWithdrawStatus,
    statusMsg,
    setStatusMsg,
}: {
    balance: number
    onBalanceChange: (b: number) => void
    onRefreshBalance?: () => void
    depositStatus: 'idle' | 'pending' | 'success' | 'error'
    setDepositStatus: (s: 'idle' | 'pending' | 'success' | 'error') => void
    withdrawStatus: 'idle' | 'pending' | 'success' | 'error'
    setWithdrawStatus: (s: 'idle' | 'pending' | 'success' | 'error') => void
    statusMsg: string
    setStatusMsg: (s: string) => void
}) {
    const account = useActiveAccount()
    const { mutateAsync: sendAndConfirm, isPending: isSending } = useSendAndConfirmTransaction()

    const [fuelMode, setFuelMode] = useState<'deposit' | 'withdraw'>('deposit')
    const [depositAmt, setDepositAmt] = useState(10)
    const [withdrawAmt, setWithdrawAmt] = useState(100)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

    // ── DEPOSIT ──
    const handleDeposit = useCallback(async () => {
        if (!account || depositAmt <= 0) return
        setDepositStatus('pending')
        setStatusMsg('Sending transaction…')
        try {
            const tx = prepareTransaction({
                chain: apeChain,
                client: thirdwebClient,
                to: VAULT_WALLET,
                value: toWei(String(depositAmt)),
            })
            const receipt = await sendAndConfirm(tx)

            // Retry loop: sendAndConfirm gives us 1 confirmation; server now only
            // requires 1, so the first attempt almost always succeeds immediately.
            // Retries are a safety net for edge cases (node lag, reorgs).
            const MAX_RETRIES = 5   // 5 × 2 s = 10 s max
            let attempt = 0
            while (true) {
                if (attempt > 0) {
                    setStatusMsg(`Verifying… (${attempt}/${MAX_RETRIES})`)
                    await new Promise(r => setTimeout(r, 2000))
                }
                const res = await fetch('/api/flight/deposit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Wallet-Address': account.address },
                    body: JSON.stringify({ wallet: account.address, tx_hash: receipt.transactionHash }),
                })
                const data = await res.json()
                if (res.ok) {
                    onBalanceChange(data.new_balance)
                    onRefreshBalance?.()
                    setDepositStatus('success')
                    setStatusMsg(`Deposited ${depositAmt} APE`)
                    return
                }
                // Retry on "not enough confirmations" (server returns 400 with this wording)
                const isConfirmationErr = typeof data.error === 'string' &&
                    data.error.toLowerCase().includes('confirmation')
                if (isConfirmationErr && attempt < MAX_RETRIES) {
                    attempt++
                    continue
                }
                // Hard error (wrong vault, duplicate tx, etc.)
                throw new Error(data.error)
            }
        } catch (e: any) {
            setDepositStatus('error')
            setStatusMsg(e.message?.slice(0, 80) ?? 'Deposit failed')
        } finally {
            setHistoryRefreshKey(k => k + 1)
        }
    }, [account, depositAmt, sendAndConfirm, onBalanceChange, onRefreshBalance, setDepositStatus, setStatusMsg])

    // ── WITHDRAW ──
    const handleWithdraw = useCallback(async () => {
        if (!account || withdrawAmt <= 0 || withdrawAmt > balance) return
        setWithdrawStatus('pending')
        setStatusMsg('')
        try {
            // Embed timestamp for server-side TTL check, plus random UUID for uniqueness
            const nonce = `${Date.now()}.${crypto.randomUUID()}`
            const message = `Withdraw ${withdrawAmt} APE nonce:${nonce}`
            const signature = await account.signMessage({ message })
            const res = await fetch('/api/flight/withdraw', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Wallet-Address': account.address },
                body: JSON.stringify({ wallet: account.address, amount: withdrawAmt, nonce, signature }),
            })
            const data = await res.json()
            if (!res.ok) {
                const msg: string = data.error ?? 'Withdraw failed'
                const code: string | undefined = data.code

                // Specific reasons we can explain plainly to the player.
                if (code === 'vault_insufficient_funds') {
                    throw new Error('Vault is low on APE — please retry in a moment (your balance is restored)')
                }
                if (code === 'vault_nonce_conflict') {
                    throw new Error('Another withdrawal is finishing — wait 10 s and retry')
                }
                if (msg.toLowerCase().includes('balance restored')) {
                    throw new Error('Withdrawal failed — your balance was restored. Try again.')
                }
                if (msg.toLowerCase().includes('balance has been held') || msg.toLowerCase().includes('status unknown')) {
                    // Pending investigation — admin needs to review.
                    throw new Error(`Withdrawal pending review — contact support${data.request_id ? ` (ID ${data.request_id})` : ''}`)
                }
                // Truly unknown 500 — keep the catch-all support code.
                if (res.status >= 500 || msg.toLowerCase().includes('internal')) {
                    throw new Error('Something went wrong — contact support (ERR-W01)')
                }
                throw new Error(msg.slice(0, 80))
            }
            onBalanceChange(data.new_balance)
            onRefreshBalance?.()
            setWithdrawStatus('success')
            setStatusMsg(`Withdrew ${withdrawAmt} APE → wallet`)
        } catch (e: any) {
            setWithdrawStatus('error')
            setStatusMsg(e.message?.slice(0, 90) ?? 'Withdraw failed')
        } finally {
            setHistoryRefreshKey(k => k + 1)
        }
    }, [account, withdrawAmt, balance, onBalanceChange, onRefreshBalance, setWithdrawStatus, setStatusMsg])

    if (!account) {
        return (
            <div className="p-5 text-center text-white/20 text-xs font-mono">
                Connect wallet to deposit or withdraw
            </div>
        )
    }

    const busy = depositStatus === 'pending' || withdrawStatus === 'pending' || isSending

    const isError = depositStatus === 'error' || withdrawStatus === 'error'

    return (
        <div className="p-4 sm:p-5 flex flex-col gap-4">
            {/* Mode toggle */}
            <div className="flex rounded-xl overflow-hidden border border-white/10 bg-white/[0.03]">
                {(['deposit', 'withdraw'] as const).map(mode => (
                    <button
                        key={mode}
                        onClick={() => { setFuelMode(mode); setStatusMsg('') }}
                        disabled={busy}
                        className={`flex-1 py-2 text-[11px] font-black uppercase tracking-widest transition-all ${
                            fuelMode === mode
                                ? 'bg-white/10 text-white shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.15)]'
                                : 'text-white/30 hover:text-white/60'
                        }`}
                    >
                        {mode}
                    </button>
                ))}
            </div>

            {/* Deposit panel */}
            {fuelMode === 'deposit' && (
                <div className="flex flex-col gap-2">

                    <AmountStepper
                        value={depositAmt}
                        onChange={setDepositAmt}
                        min={10}
                        step={10}
                        disabled={busy}
                    />
                    <div className="grid grid-cols-4 gap-1">
                        {[10, 25, 50, 100].map(v => (
                            <button key={v} disabled={busy} onClick={() => setDepositAmt(v)}
                                className="py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white text-[11px] font-extrabold font-mono disabled:opacity-20 transition-all">
                                {v}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={handleDeposit}
                        disabled={busy || depositAmt < 10}
                        className={`w-full py-2.5 rounded-xl font-black text-sm tracking-widest uppercase transition-all mt-2 ${
                            busy
                                ? 'bg-white/10 text-white/20 cursor-default'
                                : 'bg-white text-black hover:bg-white/90 cursor-pointer'
                        }`}
                    >
                        {(depositStatus === 'pending' || isSending)
                            ? (statusMsg || `Processing — ${depositAmt} APE…`)
                            : `Deposit ${depositAmt} APE`}
                    </button>
                </div>
            )}

            {/* Withdraw panel */}
            {fuelMode === 'withdraw' && (
                <div className="flex flex-col gap-2">
                    <AmountStepper
                        value={withdrawAmt}
                        onChange={setWithdrawAmt}
                        min={100}
                        max={Math.min(balance, 500)}
                        step={25}
                        disabled={busy}
                    />
                    <button
                        onClick={() => setWithdrawAmt(Math.min(balance, 500))}
                        disabled={busy || balance <= 0}
                        className="text-[10px] font-mono text-white/30 hover:text-white/60 transition-colors text-right disabled:opacity-20"
                    >
                        Max: {Math.min(balance, 500).toFixed(2)} APE
                    </button>
                    <button
                        onClick={handleWithdraw}
                        disabled={busy || withdrawAmt < 100 || withdrawAmt > balance}
                        className={`w-full py-2.5 rounded-xl font-black text-sm tracking-widest uppercase transition-all ${
                            busy || withdrawAmt < 100 || withdrawAmt > balance
                                ? 'bg-white/10 text-white/20 cursor-default'
                                : 'bg-white text-black hover:bg-white/90 cursor-pointer'
                        }`}
                    >
                        {withdrawStatus === 'pending' ? 'Signing…' : withdrawAmt < 100 ? 'Min 100 APE' : `Withdraw ${withdrawAmt} APE`}
                    </button>
                </div>
            )}

            {/* Status message */}
            {statusMsg && (
                <motion.p
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`text-[11px] font-mono text-center ${isError ? 'text-red-400' : 'text-[#00FF94]'}`}
                >
                    {statusMsg}
                </motion.p>
            )}

            {/* Vault address */}
            <div className="text-[9px] font-mono text-white/40 text-center leading-relaxed break-all">
                Vault: {VAULT_WALLET ?? '—'}<br />
                Min withdraw: 100 APE · max 500 APE/day
            </div>

            {/* ── Transfer history ── */}
            <div className="border-t border-white/[0.06] pt-4">
                <TxHistoryPreview
                    wallet={account.address}
                    onViewAll={() => setHistoryOpen(true)}
                    refreshKey={historyRefreshKey}
                />
            </div>

            {/* Full-history modal */}
            <AnimatePresence>
                {historyOpen && (
                    <TxHistoryModal
                        wallet={account.address}
                        onClose={() => setHistoryOpen(false)}
                    />
                )}
            </AnimatePresence>
        </div>
    )
}

// ─── XP Pop animation ─────────────────────────────────────────────────────────
function XpPop({ xp }: { xp: number }) {
    return (
        <motion.div
            key={xp}
            initial={{ opacity: 0, y: 0, scale: 0.7 }}
            animate={{ opacity: [0, 1, 1, 0], y: -48, scale: [0.7, 1.1, 1, 0.9] }}
            transition={{ duration: 1.4, ease: 'easeOut' }}
            className="absolute -top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none
                       text-[#00FF94] font-black text-lg drop-shadow-[0_0_10px_rgba(0,255,148,0.9)]"
        >
            +{xp} XP
        </motion.div>
    )
}

// ─── Control panel (right side, matches ControlPanel glitch_game style) ───────
export interface RunControlPanelProps {
    phase: 'waiting' | 'running' | 'crashed'
    multiplier: number
    betAmount: number
    setBetAmount: (v: number) => void
    balance: number | null
    balanceLoading?: boolean
    onBalanceChange: (b: number | null) => void
    onRefreshBalance?: () => void
    seasonRank?: number | null
    rankLoading?: boolean
    roundHistory: RoundResult[]
    onBet: () => void
    onCashout: () => void
    hasBet: boolean
    cashedOutAt?: number
    crashPoint?: number
    lastXpGained?: number
    queueBet?: boolean
    onQueueBet?: (v: boolean) => void
    historyRefreshTrigger?: number
    socketError?: string | null
    // Vault-driven bet bounds — refreshed each round by the server.
    minBet?: number
    maxBet?: number
}

export function RunControlPanel({
    phase, multiplier, betAmount, setBetAmount, balance, balanceLoading, onBalanceChange, onRefreshBalance,
    seasonRank, rankLoading, roundHistory, onBet, onCashout,
    hasBet, cashedOutAt, crashPoint, lastXpGained,
    queueBet, onQueueBet, historyRefreshTrigger, socketError,
    minBet = 5, maxBet = 50,
}: RunControlPanelProps) {
    const account = useActiveAccount()
    const [activeTab, setActiveTab] = useState<'play' | 'fuel'>('play')
    const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false)

    // Fuel tab state lifted here so it survives tab switching
    const [depositStatus, setDepositStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
    const [withdrawStatus, setWithdrawStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
    const [fuelStatusMsg, setFuelStatusMsg] = useState('')

    // Auto-clamp the bet amount to the current dynamic max so a user can't
    // submit a bet that the server will reject. If maxBet shrinks below the
    // current input (vault drained mid-round), pull it down.
    useEffect(() => {
        if (betAmount > maxBet && maxBet > 0) {
            setBetAmount(Math.max(minBet, Math.floor(maxBet)))
        }
    }, [maxBet, minBet, betAmount, setBetAmount])

    const canBet = phase === 'waiting' && !hasBet && (balance ?? 0) >= betAmount
        && betAmount >= minBet && betAmount <= maxBet
    const canCashout = phase === 'running' && hasBet && !cashedOutAt

    // XP pop: show whenever lastXpGained transitions from 0 → non-zero
    const [xpPopKey, setXpPopKey] = useState(0)
    useEffect(() => {
        if (lastXpGained) setXpPopKey(k => k + 1)
    }, [lastXpGained])

    const bestWin = useMemo(
        () => roundHistory.reduce((max, r) => Math.max(max, r.crashPoint), 0),
        [roundHistory]
    )

    return (
        <div className="w-full lg:w-[30%] flex flex-col gap-3 sm:gap-5 p-3 sm:p-6 lg:pt-[50px] shrink-0 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:[&::-webkit-scrollbar]:w-[3px] lg:[&::-webkit-scrollbar-track]:bg-transparent lg:[&::-webkit-scrollbar-thumb]:bg-white/15 lg:[&::-webkit-scrollbar-thumb]:rounded-full"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}>

            {/* ── Stats row ── */}
            <motion.div
                className="grid grid-cols-[1fr_auto_1fr] items-center"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
            >
                {/* Balance */}
                <div className="flex flex-col pr-2">
                    {balanceLoading || balance === null ? (
                        <div className="h-[22px] sm:h-[26px] w-16 bg-white/10 rounded-md animate-pulse mb-1.5" />
                    ) : (
                        <span className="font-mono text-[18px] sm:text-[22px] font-extrabold text-white leading-none tracking-tight mb-1.5">
                            {balance.toFixed(2)}
                        </span>
                    )}
                    <span className="text-[9px] sm:text-[10px] font-bold tracking-widest text-white/50 uppercase leading-none">Balance</span>
                </div>

                <div className="w-[1px] h-8 sm:h-10 bg-white/10" />

                {/* Season rank */}
                <div className="flex flex-col pl-3 sm:pl-4">
                    {rankLoading ? (
                        <div className="h-[22px] sm:h-[26px] w-10 bg-white/10 rounded-md animate-pulse mb-1.5" />
                    ) : (
                        <span className="font-mono text-[18px] sm:text-[22px] font-extrabold text-white leading-none tracking-tight mb-1.5">
                            {seasonRank != null ? `#${seasonRank}` : '--'}
                        </span>
                    )}
                    <div className="flex items-center gap-2 leading-none">
                        <span className="text-[9px] sm:text-[10px] font-bold tracking-widest text-white/50 uppercase">S2 Rank</span>
                        <button
                            onClick={() => setIsLeaderboardOpen(true)}
                            className="text-[8px] text-white/30 hover:text-white uppercase font-bold tracking-widest transition-colors cursor-pointer underline decoration-white/30 hover:decoration-white underline-offset-2"
                        >
                            Leaderboard
                        </button>
                    </div>
                </div>

                {/* S2 Leaderboard popup */}
                <AnimatePresence>
                    {isLeaderboardOpen && (
                        <S2LeaderboardModal
                            isOpen={isLeaderboardOpen}
                            onClose={() => setIsLeaderboardOpen(false)}
                            wallet={account?.address}
                        />
                    )}
                </AnimatePresence>
            </motion.div>

            {/* ── Main card ── */}
            <motion.div
                className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden flex flex-col relative"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
            >
                {/* XP pop overlay */}
                <AnimatePresence>
                    {lastXpGained && xpPopKey > 0 && (
                        <XpPop key={xpPopKey} xp={lastXpGained} />
                    )}
                </AnimatePresence>

                {/* Tab header */}
                <div className="flex border-b border-white/10">
                    <button
                        onClick={() => { playUiSound('click'); setActiveTab('play') }}
                        onMouseEnter={() => playUiSound('hover')}
                        className={`flex-1 py-2.5 sm:py-4 flex items-center justify-center text-xs font-bold uppercase tracking-wider transition-all ${
                            activeTab === 'play'
                                ? 'bg-white/5 text-white shadow-[inset_0_-1px_0_0_#fff]'
                                : 'text-white/40 hover:text-white/60 hover:bg-white/[0.02]'
                        }`}
                    >
                        Play
                    </button>
                    <button
                        onClick={() => { playUiSound('click'); setActiveTab('fuel') }}
                        onMouseEnter={() => playUiSound('hover')}
                        className={`flex-1 py-2.5 sm:py-4 flex items-center justify-center text-xs font-bold uppercase tracking-wider transition-all ${
                            activeTab === 'fuel'
                                ? 'bg-white/5 text-white shadow-[inset_0_-1px_0_0_#fff]'
                                : 'text-white/40 hover:text-white/60 hover:bg-white/[0.02]'
                        }`}
                    >
                        Fuel
                    </button>
                </div>

                {/* Tab content */}
                <AnimatePresence mode="wait">
                    {activeTab === 'play' ? (
                        <motion.div
                            key="play"
                            initial={{ opacity: 0, x: 12 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -12 }}
                            transition={{ duration: 0.18 }}
                            className="p-3 sm:p-5 flex flex-col gap-3 sm:gap-4"
                        >
                            {/* Flight amount */}
                            <div className="flex flex-col gap-2.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-white/50 uppercase tracking-widest">
                                        Flight amount
                                    </span>
                                    <span className="text-[9px] font-mono text-white/30 uppercase tracking-wider" title="Server-set bet limits, refresh each round based on vault liquidity">
                                        Max {Math.floor(maxBet)} · Min {minBet}
                                    </span>
                                </div>

                                <AmountStepper
                                    value={betAmount}
                                    onChange={setBetAmount}
                                    min={minBet}
                                    max={Math.max(minBet, Math.min(Math.floor(maxBet), Math.floor(balance ?? 0)))}
                                    step={5}
                                    disabled={(phase === 'waiting' && hasBet) || !!queueBet || (phase === 'running' && !!cashedOutAt) || (phase === 'crashed' && hasBet)}
                                />

                                {/* Quick picks — generated dynamically from the current
                                    server-set min/max so they always make sense. Anchor
                                    points: minBet, ⅓, ⅔, max. Duplicates deduped so a
                                    narrow window gets 2-3 distinct buttons. If the dynamic
                                    cap drops below minBet (vault temporarily too small),
                                    render an inline notice instead of an empty grid. */}
                                {(() => {
                                    const m = Math.floor(maxBet)
                                    const lo = minBet
                                    if (m < lo) {
                                        return (
                                            <div className="text-[10px] font-mono text-yellow-400/70 bg-yellow-400/5 border border-yellow-400/20 rounded-lg px-3 py-2 leading-snug">
                                                Bets paused for this round — vault is below the per-round liability ceiling.
                                                Wait for the next round.
                                            </div>
                                        )
                                    }
                                    const raw = [
                                        lo,
                                        Math.max(lo, Math.floor(m / 3)),
                                        Math.max(lo, Math.floor((m * 2) / 3)),
                                        m,
                                    ]
                                    const picks = Array.from(new Set(raw)).filter(v => v >= lo && v <= m)
                                    return (
                                        <div
                                            className="grid gap-1.5"
                                            style={{ gridTemplateColumns: `repeat(${Math.max(1, picks.length)}, minmax(0, 1fr))` }}
                                        >
                                            {picks.map(v => (
                                                <button
                                                    key={v}
                                                    onClick={() => { playUiSound('click'); setBetAmount(Math.min(v, balance ?? 0, m)) }}
                                                    onMouseEnter={() => playUiSound('hover')}
                                                    disabled={
                                                        (phase === 'waiting' && hasBet) ||
                                                        !!queueBet ||
                                                        (phase === 'running' && !!cashedOutAt) ||
                                                        (phase === 'crashed' && hasBet) ||
                                                        (balance ?? 0) < v
                                                    }
                                                    className="py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#00FF94]/30 text-white/60 hover:text-white text-[11px] font-extrabold font-mono disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                                                >
                                                    {v}
                                                </button>
                                            ))}
                                        </div>
                                    )
                                })()}
                            </div>

                            {/* Action button — styled like glitch_game PLAY button */}
                            <AnimatePresence mode="wait">
                                {phase === 'waiting' && !hasBet && !queueBet && (
                                    <motion.button
                                        key="bet"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        whileTap={{ scale: 0.97 }}
                                        onClick={() => { playUiSound('click'); onBet() }}
                                        onMouseEnter={() => playUiSound('hover')}
                                        disabled={!canBet}
                                        className={`w-full py-3 sm:py-4 rounded-2xl font-black text-sm sm:text-base tracking-widest uppercase flex items-center justify-center gap-2 transition-all ${
                                            canBet
                                                ? 'bg-white text-black hover:bg-[#00FF94] hover:text-black shadow-lg shadow-white/10 hover:shadow-[#00FF94]/30 hover:scale-[1.02] cursor-pointer'
                                                : 'bg-white/10 text-white/20 cursor-default'
                                        }`}
                                    >
                                        Play {betAmount} APE
                                    </motion.button>
                                )}

                                {phase === 'waiting' && !hasBet && queueBet && (
                                    <motion.div
                                        key="queuedWaiting"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="w-full py-3 sm:py-4 rounded-2xl bg-white/5 border border-white/10 text-white/40 font-black text-sm tracking-widest uppercase flex items-center justify-between px-5"
                                    >
                                        <span>{betAmount} APE — Queued</span>
                                        <button onClick={() => onQueueBet?.(false)} className="text-white/20 hover:text-white/60 text-xs transition-colors font-mono normal-case tracking-normal">✕</button>
                                    </motion.div>
                                )}

                                {phase === 'waiting' && hasBet && (
                                    <motion.div
                                        key="betPlaced"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="w-full py-3 sm:py-4 rounded-2xl bg-[#00FF94]/10 border border-[#00FF94]/30 text-[#00FF94] font-black text-sm tracking-widest uppercase text-center"
                                    >
                                        ✓ {betAmount} APE — Ready
                                    </motion.div>
                                )}

                                {phase === 'running' && !hasBet && (
                                    <motion.div
                                        key="noBet"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                    >
                                        {queueBet ? (
                                            <div className="w-full py-3 sm:py-4 rounded-2xl bg-[#00FF94]/10 border border-[#00FF94]/30 text-[#00FF94] font-black text-sm tracking-widest uppercase flex items-center justify-between px-5">
                                                <span>✓ {betAmount} APE — Next Round</span>
                                                <button onClick={() => onQueueBet?.(false)} className="text-[#00FF94]/40 hover:text-[#00FF94] text-xs transition-colors font-mono normal-case tracking-normal">✕</button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => onQueueBet?.(true)}
                                                disabled={!account || (balance ?? 0) < betAmount || betAmount < minBet || betAmount > maxBet}
                                                className={`w-full py-3 sm:py-4 rounded-2xl font-black text-sm tracking-widest uppercase transition-all ${
                                                    (!account || (balance ?? 0) < betAmount || betAmount < minBet || betAmount > maxBet)
                                                        ? 'bg-white/10 text-white/20 cursor-default'
                                                        : 'bg-white text-black hover:bg-[#00FF94] hover:text-black shadow-lg shadow-white/10 hover:shadow-[#00FF94]/30 hover:scale-[1.02] cursor-pointer'
                                                }`}
                                            >
                                                Play {betAmount} APE — Next Round
                                            </button>
                                        )}
                                    </motion.div>
                                )}

                                {canCashout && (
                                    <motion.button
                                        key="cashout"
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{
                                            opacity: 1,
                                            scale: 1,
                                            boxShadow: [
                                                '0 0 20px rgba(0,255,148,0.3)',
                                                '0 0 45px rgba(0,255,148,0.65)',
                                                '0 0 20px rgba(0,255,148,0.3)',
                                            ],
                                        }}
                                        transition={{ boxShadow: { repeat: Infinity, duration: 1.1 } }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        whileTap={{ scale: 0.96 }}
                                        onClick={() => { playUiSound('cashout'); onCashout() }}
                                        onMouseEnter={() => playUiSound('hover')}
                                        className="w-full py-3 sm:py-5 rounded-2xl font-black text-base sm:text-lg tracking-widest uppercase bg-[#00FF94] text-black hover:scale-[1.02] transition-transform"
                                    >
                                        APE OUT {multiplier.toFixed(2)}x
                                    </motion.button>
                                )}

                                {phase === 'running' && hasBet && cashedOutAt && (
                                    <motion.div
                                        key="cashedOut"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="w-full py-3 sm:py-4 rounded-2xl bg-[#00FF94]/10 border border-[#00FF94]/30 text-[#00FF94] font-black text-sm tracking-widest uppercase text-center"
                                    >
                                        Aped Out {cashedOutAt.toFixed(2)}x<br />
                                        <span className="text-[11px] opacity-70 normal-case tracking-normal font-bold">+{((cashedOutAt - 1) * betAmount).toFixed(2)} APE profit</span>
                                        {lastXpGained ? (
                                            <span className="block text-base font-black text-[#00FF94] drop-shadow-[0_0_10px_rgba(0,255,148,0.7)] mt-0.5 tracking-wide">
                                                +{lastXpGained} XP
                                            </span>
                                        ) : null}
                                    </motion.div>
                                )}

                                {phase === 'crashed' && hasBet && !cashedOutAt && (
                                    <motion.div
                                        key="lost"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="w-full py-3 sm:py-4 rounded-2xl bg-red-950/40 border border-red-600/30 text-red-400 font-black text-sm tracking-widest uppercase text-center"
                                    >
                                        Crashed — {betAmount} APE
                                        {lastXpGained ? (
                                            <span className="block text-sm font-black text-white/50 mt-0.5 tracking-wide normal-case">
                                                +{lastXpGained} XP
                                            </span>
                                        ) : null}
                                    </motion.div>
                                )}

                                {phase === 'crashed' && hasBet && cashedOutAt && (
                                    <motion.div
                                        key="wonAfterCrash"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="w-full py-3 sm:py-4 rounded-2xl bg-[#00FF94]/10 border border-[#00FF94]/30 text-[#00FF94] font-black text-sm tracking-widest uppercase text-center"
                                    >
                                        Aped Out {cashedOutAt.toFixed(2)}x<br />
                                        <span className="text-[11px] opacity-70 normal-case tracking-normal font-bold">+{((cashedOutAt - 1) * betAmount).toFixed(2)} APE</span>
                                        {lastXpGained ? (
                                            <span className="block text-base font-black text-[#00FF94] drop-shadow-[0_0_10px_rgba(0,255,148,0.7)] mt-0.5 tracking-wide">
                                                +{lastXpGained} XP
                                            </span>
                                        ) : null}
                                    </motion.div>
                                )}

                                {phase === 'crashed' && !hasBet && (
                                    <motion.div
                                        key="crashedIdle"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="w-full py-2.5 sm:py-4 rounded-2xl bg-white/5 border border-white/10 text-white/20 text-center text-sm font-mono"
                                    >
                                        Next flight starting…
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Socket error toast */}
                            <AnimatePresence>
                                {socketError && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -4 }}
                                        className="mt-2 px-4 py-2 rounded-xl bg-red-950/60 border border-red-500/30 text-red-400 text-[11px] font-mono text-center"
                                    >
                                        {socketError}
                                    </motion.div>
                                )}
                            </AnimatePresence>

                        </motion.div>
                    ) : (
                        <motion.div
                            key="fuel"
                            initial={{ opacity: 0, x: 12 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -12 }}
                            transition={{ duration: 0.18 }}
                            className="overflow-y-auto max-h-[460px] sm:max-h-[560px] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-white/40"
                            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}
                        >
                            <FuelTab
                                balance={balance ?? 0}
                                onBalanceChange={onBalanceChange}
                                onRefreshBalance={onRefreshBalance}
                                depositStatus={depositStatus}
                                setDepositStatus={setDepositStatus}
                                withdrawStatus={withdrawStatus}
                                setWithdrawStatus={setWithdrawStatus}
                                statusMsg={fuelStatusMsg}
                                setStatusMsg={setFuelStatusMsg}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>

            {/* === HISTORY SECTION === */}
            <FlightHistorySection wallet={account?.address} refreshTrigger={historyRefreshTrigger} />

        </div>
    )
}
