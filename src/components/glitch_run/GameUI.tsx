'use client'

import { useMemo, useState, useEffect, useRef, useCallback, CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useActiveAccount, useSendAndConfirmTransaction } from 'thirdweb/react'
import { createThirdwebClient, defineChain, prepareTransaction, toWei } from 'thirdweb'
import { X, Trophy, ExternalLink, Loader2 } from 'lucide-react'

const thirdwebClient = createThirdwebClient({ clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID! })
const apeChain = defineChain(33139)
const VAULT_WALLET = process.env.NEXT_PUBLIC_FLIGHT_VAULT_WALLET_ADDRESS!

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
    lastXpGained,
}: {
    phase: 'waiting' | 'running' | 'crashed'
    multiplier: number
    countdown: number
    crashPoint?: number
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
                        <div className={`text-4xl sm:text-6xl md:text-7xl font-black font-mono transition-all duration-75 ${color} ${glow}`}>
                            {phase === 'crashed'
                                ? `${crashPoint?.toFixed(2)}x`
                                : `${multiplier.toFixed(2)}x`}
                        </div>
                        {phase === 'crashed' && lastXpGained ? (
                            <motion.div
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="text-white/50 font-bold text-xs uppercase tracking-[0.25em] mt-1"
                            >
                                +{lastXpGained} XP
                            </motion.div>
                        ) : null}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

// ─── Round history pills ──────────────────────────────────────────────────────
function crashPillColor(cp: number): string {
    // Match MultiplierOverlay colors, but muted
    if (cp < 2)  return 'bg-[#00FF94]/5 border-[#00FF94]/15 text-[#00FF94]/55'
    if (cp < 5)  return 'bg-yellow-950/50 border-yellow-700/20 text-yellow-300/60'
    return 'bg-orange-950/50 border-orange-700/20 text-orange-400/65'
}

export function RoundHistoryPills({ history }: { history: RoundResult[] }) {
    return (
        <div className="flex gap-1.5 items-center overflow-hidden flex-nowrap flex-1 min-w-0">
            {history.slice(0, 20).map((r, i) => (
                <span
                    key={i}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border shrink-0 ${crashPillColor(r.crashPoint)}`}
                >
                    {r.crashPoint.toFixed(2)}x
                </span>
            ))}
        </div>
    )
}

// ─── Round history list (inside history tab) ──────────────────────────────────
function RoundHistoryList({ history }: { history: RoundResult[] }) {
    return (
        <div className="flex flex-col divide-y divide-white/5">
            {history.slice(0, 20).map((r, i) => (
                <div key={i} className="px-5 py-2.5 flex items-center justify-between">
                    <span className="text-white/30 text-[11px] font-mono">Round #{history.length - i}</span>
                    <span
                        className={`text-[11px] font-mono font-bold ${
                            r.userResult === 'won'
                                ? 'text-[#00FF94]'
                                : r.userResult === 'lost'
                                ? 'text-red-400'
                                : 'text-white/30'
                        }`}
                    >
                        {r.crashPoint.toFixed(2)}x
                    </span>
                </div>
            ))}
        </div>
    )
}

// ─── S2 Leaderboard popup ─────────────────────────────────────────────────────
function rankColor(rank: number, isMe: boolean): string {
    if (rank === 1) return 'text-yellow-400'
    if (rank === 2) return 'text-slate-300'
    if (rank === 3) return ''
    if (isMe) return 'text-[#00FF94]'
    return 'text-[#00FF94]'
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

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                onClick={e => e.stopPropagation()}
                className="relative w-full max-w-2xl bg-black/80 backdrop-blur-3xl border border-white/10 rounded-[40px] shadow-2xl overflow-hidden flex flex-col h-[80vh] max-h-[800px]"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 sm:p-8 border-b border-white/5 bg-white/[0.02] shrink-0">
                    <div className="flex flex-col">
                        <div className="text-xl sm:text-2xl font-black text-white uppercase tracking-tight leading-none flex items-center gap-2">
                            <span className="text-[#00FF94]">SEASON 2</span> LEADERBOARD
                        </div>
                        <span className="text-[10px] sm:text-xs text-white/40 uppercase font-bold tracking-[0.2em] mt-1">Glitch Game + Glitch Flight XP</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-3 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-full transition-all"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* No separate rank banner — user's row is highlighted in the list */}

                {/* List */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                    <div className="flex flex-col gap-3">
                        {loading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="flex items-center p-4 sm:p-5 rounded-[24px] border border-white/5 bg-white/[0.02] animate-pulse">
                                    <div className="w-10 sm:w-12 h-6 sm:h-7 bg-white/10 rounded-lg" />
                                    <div className="flex-1 min-w-0 pr-4 flex flex-col gap-2">
                                        <div className="h-5 sm:h-6 w-32 sm:w-40 bg-white/10 rounded-md" />
                                        <div className="h-3 w-48 sm:w-56 bg-white/5 rounded-md" />
                                    </div>
                                    <div className="text-right flex flex-col items-end gap-1.5">
                                        <div className="h-6 sm:h-7 w-16 sm:w-20 bg-[#00FF94]/20 rounded-md" />
                                        <div className="h-3 w-12 sm:w-14 bg-white/10 rounded-md" />
                                    </div>
                                </div>
                            ))
                        ) : data.length === 0 ? (
                            <div className="py-12 text-center text-white/20 text-xs font-mono">No data yet</div>
                        ) : (
                            data.map((entry: any) => {
                                const isMe = entry.wallet?.toLowerCase() === wallet?.toLowerCase()
                                return (
                                    <div
                                        key={entry.wallet}
                                        className={`flex items-center p-4 sm:p-5 rounded-[24px] border transition-all ${
                                            isMe
                                                ? 'bg-[#00FF94]/5 border-[#00FF94]/30 shadow-[0_0_20px_rgba(0,255,148,0.08)]'
                                                : 'bg-white/5 border-transparent hover:border-white/10 hover:bg-white/10'
                                        }`}
                                    >
                                        <div className={`w-10 sm:w-12 font-black text-lg sm:text-xl shrink-0 ${rankColor(entry.rank, isMe)}`} style={rankStyle(entry.rank)}>
                                            #{entry.rank}
                                        </div>
                                        <div className="flex-1 min-w-0 pr-4">
                                            <div className={`text-sm sm:text-base font-black uppercase tracking-tight truncate ${isMe ? 'text-[#00FF94]' : 'text-white'}`}>
                                                {isMe ? 'You' : `${entry.wallet?.slice(0, 6)}…${entry.wallet?.slice(-4)}`}
                                            </div>
                                            <div className="text-[9px] sm:text-[10px] text-white/30 uppercase font-black tracking-widest flex items-center gap-2 mt-1">
                                                <span>{entry.games_played} games</span>
                                                <span className="opacity-40">·</span>
                                                <span>{entry.flights_played} flights</span>
                                            </div>
                                        </div>
                                        <div className="text-right flex flex-col items-end">
                                            <div className={`text-lg sm:text-xl font-black ${isMe ? 'text-[#00FF94]' : 'text-[#00FF94]'}`}>
                                                {new Intl.NumberFormat().format(entry.season_xp)}
                                            </div>
                                            <div className="text-[8px] sm:text-[9px] font-black uppercase text-white/30 tracking-widest">Season XP</div>
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
                                    return (
                                        <div key={f.id} className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[9px] font-mono text-white/40">#{total - page * PAGE - i}</span>
                                                    <span className={`text-[10px] font-black ${won ? 'text-emerald-400/65' : 'text-red-400/55'}`}>
                                                        {won ? `Aped Out ${f.cashout_at?.toFixed(2)}x` : '✕ Crashed'}
                                                    </span>
                                                    <span className="text-[9px] font-mono text-white/40 ml-auto">crash {f.flight_sessions?.crash_point?.toFixed(2)}x</span>
                                                </div>
                                                <div className="text-[9px] font-mono text-white/40 mt-0.5">
                                                    +{f.xp_gained} XP · {new Date(f.created_at).toLocaleDateString()}
                                                </div>
                                            </div>
                                            <span className={`text-[11px] font-black shrink-0 ${won ? 'text-emerald-400/65' : 'text-red-400/55'}`}>
                                                {won ? `+${f.profit?.toFixed(2)}` : `-${f.bet_amount.toFixed(2)}`}
                                            </span>
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

// ─── Fuel tab (deposit / withdraw) ───────────────────────────────────────────
function FuelTab({
    balance,
    onBalanceChange,
    onRefreshBalance,
}: {
    balance: number
    onBalanceChange: (b: number) => void
    onRefreshBalance?: () => void
}) {
    const account = useActiveAccount()
    const { mutateAsync: sendAndConfirm, isPending: isSending } = useSendAndConfirmTransaction()

    const [fuelMode, setFuelMode] = useState<'deposit' | 'withdraw'>('deposit')
    const [depositAmt, setDepositAmt] = useState(10)
    const [withdrawAmt, setWithdrawAmt] = useState(100)
    const [depositStatus, setDepositStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
    const [withdrawStatus, setWithdrawStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
    const [statusMsg, setStatusMsg] = useState('')

    // ── DEPOSIT ──
    const handleDeposit = useCallback(async () => {
        if (!account || depositAmt <= 0) return
        setDepositStatus('pending')
        setStatusMsg('')
        try {
            const tx = prepareTransaction({
                chain: apeChain,
                client: thirdwebClient,
                to: VAULT_WALLET,
                value: toWei(String(depositAmt)),
            })
            const receipt = await sendAndConfirm(tx)
            // Tell server about the deposit — amount is read from chain, not sent here
            const res = await fetch('/api/flight/deposit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Wallet-Address': account.address },
                body: JSON.stringify({ wallet: account.address, tx_hash: receipt.transactionHash }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            onBalanceChange(data.new_balance)
            onRefreshBalance?.()
            setDepositStatus('success')
            setStatusMsg(`Deposited ${depositAmt} APE`)
        } catch (e: any) {
            setDepositStatus('error')
            setStatusMsg(e.message?.slice(0, 80) ?? 'Deposit failed')
        }
    }, [account, depositAmt, sendAndConfirm, onBalanceChange, onRefreshBalance])

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
                // 500s or blockchain failures → friendly message with error code
                if (!res.ok && (res.status >= 500 || msg.toLowerCase().includes('blockchain') || msg.toLowerCase().includes('internal'))) {
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
        }
    }, [account, withdrawAmt, balance, onBalanceChange, onRefreshBalance])

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
                        {depositStatus === 'pending' || isSending ? `In Process — ${depositAmt} APE…` : `Deposit ${depositAmt} APE`}
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
}

export function RunControlPanel({
    phase, multiplier, betAmount, setBetAmount, balance, balanceLoading, onBalanceChange, onRefreshBalance,
    seasonRank, rankLoading, roundHistory, onBet, onCashout,
    hasBet, cashedOutAt, crashPoint, lastXpGained,
    queueBet, onQueueBet, historyRefreshTrigger, socketError,
}: RunControlPanelProps) {
    const account = useActiveAccount()
    const [activeTab, setActiveTab] = useState<'play' | 'fuel'>('play')
    const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false)

    const canBet = phase === 'waiting' && !hasBet && (balance ?? 0) >= betAmount && betAmount >= 5
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
                        onClick={() => setActiveTab('play')}
                        className={`flex-1 py-2.5 sm:py-4 flex items-center justify-center text-xs font-bold uppercase tracking-wider transition-all ${
                            activeTab === 'play'
                                ? 'bg-white/5 text-white shadow-[inset_0_-1px_0_0_#fff]'
                                : 'text-white/40 hover:text-white/60 hover:bg-white/[0.02]'
                        }`}
                    >
                        Play
                    </button>
                    <button
                        onClick={() => setActiveTab('fuel')}
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
                                <span className="text-[11px] font-bold text-white/50 uppercase tracking-widest">
                                    Flight amount
                                </span>

                                <AmountStepper
                                    value={betAmount}
                                    onChange={setBetAmount}
                                    min={5}
                                    max={Math.min(50, balance ?? 0) || 5}
                                    step={5}
                                    disabled={(phase === 'waiting' && hasBet) || !!queueBet || (phase === 'running' && !!cashedOutAt) || (phase === 'crashed' && hasBet)}
                                />

                                {/* Quick picks */}
                                <div className="grid grid-cols-4 gap-1.5">
                                    {[5, 10, 25, 50].map(v => (
                                        <button
                                            key={v}
                                            onClick={() => setBetAmount(Math.min(v, balance ?? 0))}
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
                                        onClick={onBet}
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
                                                disabled={!account || (balance ?? 0) < betAmount || betAmount < 5}
                                                className={`w-full py-3 sm:py-4 rounded-2xl font-black text-sm tracking-widest uppercase transition-all ${
                                                    (!account || (balance ?? 0) < betAmount || betAmount < 5)
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
                                        onClick={onCashout}
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
                            <FuelTab balance={balance ?? 0} onBalanceChange={onBalanceChange} onRefreshBalance={onRefreshBalance} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>

            {/* === HISTORY SECTION === */}
            <FlightHistorySection wallet={account?.address} refreshTrigger={historyRefreshTrigger} />

        </div>
    )
}
