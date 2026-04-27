"use client"

import React, { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { RefreshCw } from "lucide-react"

interface S2Entry {
    rank: number
    wallet: string
    season_xp: number
    games_played: number
    flights_played: number
    quests_finished: number
    username: string | null
    x_handle: string | null
}

interface S2LeaderboardPanelProps {
    wallet?: string
    onRefresh?: () => void
    hidePlayerBanner?: boolean
    /** increment to trigger a silent re-fetch */
    refreshTrigger?: number
}

function XIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
    )
}

function RankBadge({ rank }: { rank: number }) {
    if (rank === 1) return <span className="font-black text-yellow-400 text-lg w-10 shrink-0">#{rank}</span>
    if (rank === 2) return <span className="font-black text-slate-300 text-lg w-10 shrink-0">#{rank}</span>
    if (rank === 3) return (
        <span
            className="font-black text-lg w-10 shrink-0"
            style={{ background: 'linear-gradient(135deg,#D9A051,#9F602D)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
        >
            #{rank}
        </span>
    )
    return <span className="font-black text-white/40 text-lg w-10 shrink-0">#{rank}</span>
}

function xpColor(rank: number): { className?: string; style?: React.CSSProperties } {
    if (rank === 1) return { className: 'text-yellow-400' }
    if (rank === 2) return { className: 'text-slate-300' }
    if (rank === 3) return { style: { background: 'linear-gradient(135deg,#D9A051,#9F602D)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' } }
    return { className: 'text-white/40' }
}

export function S2LeaderboardPanel({ wallet, onRefresh, hidePlayerBanner, refreshTrigger }: S2LeaderboardPanelProps) {
    const [entries, setEntries] = useState<S2Entry[]>([])
    const [playerRank, setPlayerRank] = useState<number | null>(null)
    const [playerXp, setPlayerXp] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)
    const [spinning, setSpinning] = useState(false)

    const fetchLeaderboard = useCallback(async (silent = false) => {
        if (!silent) setLoading(true)
        else setSpinning(true)

        try {
            const param = wallet ? `&wallet=${encodeURIComponent(wallet)}` : ''
            const res = await fetch(`/api/leaderboard/season2?limit=50${param}`, { cache: 'no-store' })
            const data = await res.json()
            setEntries(data.leaderboard ?? [])
            if (data.player?.rank) setPlayerRank(data.player.rank)
            if (data.player?.season_xp != null) setPlayerXp(data.player.season_xp)
        } catch (e) {
            console.error('S2 leaderboard fetch error', e)
        } finally {
            setLoading(false)
            setSpinning(false)
        }
    }, [wallet])

    useEffect(() => { fetchLeaderboard() }, [fetchLeaderboard])

    // Re-fetch when parent signals a data change (e.g. after quest claim)
    useEffect(() => {
        if (refreshTrigger === undefined || refreshTrigger === 0) return
        fetchLeaderboard(true)
    }, [refreshTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleRefresh = () => {
        fetchLeaderboard(true)
        onRefresh?.()
    }

    return (
        <div className="flex flex-col h-full gap-3">
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-1 shrink-0">
                <div className="flex flex-col">
                    <div className="text-base font-black uppercase tracking-tight leading-none">
                        <span className="text-[#3b82f6]">Season 2</span>
                        <span className="text-white"> Leaderboard</span>
                    </div>
                    <span className="text-[9px] text-white/30 uppercase font-bold tracking-[0.2em] mt-0.5">
                        Glitch Cards + Glitch Flight XP
                    </span>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={loading || spinning}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-[#3b82f6]/20 border border-white/10 hover:border-[#3b82f6]/30 text-white/30 hover:text-[#3b82f6] transition-all disabled:opacity-30 cursor-pointer"
                    title="Refresh"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* ── Player's own rank banner ── */}
            <AnimatePresence>
                {!hidePlayerBanner && wallet && playerRank !== null && !loading && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="shrink-0 flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10"
                    >
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">Your Position</span>
                        <div className="flex items-center gap-2">
                            <span className="font-black text-[#3b82f6] text-sm">#{playerRank}</span>
                            <span className="text-white/15 text-[9px]">·</span>
                            <span className="text-[9px] font-black text-white/40 tabular-nums">
                                {new Intl.NumberFormat('en-US').format(playerXp ?? 0)} XP
                            </span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── List ── */}
            <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-2
                [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent
                [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full"
                style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}
            >
                {loading ? (
                    // Skeleton
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
                ) : entries.length === 0 ? (
                    <div className="py-12 text-center text-white/20 text-xs font-mono">No data yet</div>
                ) : (
                    entries.map(entry => {
                        const isMe = !!wallet && entry.wallet.toLowerCase() === wallet.toLowerCase()
                        const displayName = entry.username
                            ? entry.username
                            : `${entry.wallet.slice(0, 6)}...${entry.wallet.slice(-4)}`

                        return (
                            <motion.div
                                key={entry.wallet}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.15 }}
                                className={`flex items-center px-3 py-2.5 rounded-2xl border transition-all ${
                                    isMe
                                        ? 'bg-[#3b82f6]/10 border-[#3b82f6]/40 shadow-[0_0_16px_rgba(59,130,246,0.12)]'
                                        : 'bg-white/[0.025] border-transparent hover:border-white/10 hover:bg-white/[0.05]'
                                }`}
                            >
                                <RankBadge rank={entry.rank} />

                                {/* Name + stats */}
                                <div className="flex-1 min-w-0 pr-2">
                                    <div className={`text-sm font-black uppercase tracking-tight flex items-center gap-1.5 min-w-0 ${isMe ? 'text-[#3b82f6]' : 'text-white'}`}>
                                        <span className="truncate">
                                            {isMe ? 'You' : displayName}
                                        </span>
                                        {entry.x_handle && (
                                            <a
                                                href={`https://x.com/${entry.x_handle.replace('@', '')}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={e => e.stopPropagation()}
                                                className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
                                                title={entry.x_handle}
                                            >
                                                <XIcon className="w-3.5 h-3.5" />
                                            </a>
                                        )}
                                    </div>
                                    <div className="text-[9px] text-white/30 uppercase font-black tracking-widest flex items-center gap-1.5 mt-0.5">
                                        <span>{entry.games_played} cards</span>
                                        <span className="opacity-40">·</span>
                                        <span>{entry.flights_played} flights</span>
                                        <span className="opacity-40">·</span>
                                        <span>{entry.quests_finished} quests</span>
                                    </div>
                                </div>

                                {/* XP */}
                                <div className="text-right shrink-0">
                                    {(() => {
                                        const c = xpColor(entry.rank)
                                        return (
                                            <div className={`text-base font-black ${c.className ?? ''}`} style={c.style}>
                                                {new Intl.NumberFormat('en-US').format(entry.season_xp)}
                                            </div>
                                        )
                                    })()}
                                    <div className="text-[8px] font-black uppercase text-white/30 tracking-widest">XP</div>
                                </div>
                            </motion.div>
                        )
                    })
                )}
            </div>
        </div>
    )
}
