"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Star, Trophy, Ticket, Coins } from "lucide-react"
import { Season2Data, getS2LevelProgress } from "./types"
import { fadeUp } from "@/lib/animations"

interface UserStatsBlockProps {
    wallet: string | undefined
    isHolder: boolean
    season2: Season2Data
    gamesBalance: number
    apeBalance: number
    isFetching: boolean
    onOpenLeaderboard?: () => void
}

export function UserStatsBlock({ wallet, season2, gamesBalance, apeBalance, onOpenLeaderboard }: UserStatsBlockProps) {
    const s2Progress = getS2LevelProgress(season2.season_xp)
    const [s2Rank, setS2Rank] = useState<number | null>(null)

    useEffect(() => {
        if (!wallet) return
        fetch(`/api/leaderboard/season2?limit=1&wallet=${wallet}`)
            .then(r => r.json())
            .then(d => { if (d.player?.rank) setS2Rank(d.player.rank) })
            .catch(() => {})
    }, [wallet])

    return (
        <motion.div variants={fadeUp} className="flex flex-col gap-3">
            {/* Balances row: Tickets + APE */}
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.03]">
                    <Ticket className="w-3 h-3 text-white/40" />
                    <span className="text-[10px] font-black text-white/60">{gamesBalance}</span>
                    <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">tickets</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.03]">
                    <Coins className={`w-3 h-3 ${apeBalance > 0 ? "text-white" : "text-white/40"}`} />
                    <span className={`text-[10px] font-black ${apeBalance > 0 ? "text-white" : "text-white/50"}`}>{apeBalance.toFixed(apeBalance > 0 && apeBalance < 10 ? 2 : 0)}</span>
                    <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">APE</span>
                </div>
            </div>

            {/* S2 Level card */}
            <div className="flex flex-col gap-2 rounded-xl bg-white/[0.03] border border-white/5 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Star className="w-3.5 h-3.5 text-[#3b82f6]" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Season 2 Level</span>
                    </div>
                    {/* S2 Leaderboard rank — more prominent */}
                    <button
                        onClick={onOpenLeaderboard}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#3b82f6]/30 bg-[#3b82f6]/10 text-[10px] font-black uppercase tracking-widest text-[#3b82f6] hover:bg-[#3b82f6]/20 transition-colors cursor-pointer"
                    >
                        <Trophy className="w-3 h-3" />
                        {s2Rank ? `#${s2Rank}` : '—'}
                    </button>
                </div>

                <div className="flex items-end justify-between">
                    <div>
                        <span className="text-3xl font-black text-white leading-none">{season2.s2_level}</span>
                        <span className="text-white/20 text-lg font-black ml-1">/10</span>
                    </div>
                    <div className="text-right">
                        <p className="text-xs font-black text-white/50 uppercase tracking-tight">{season2.s2_rank_title}</p>
                        <p className="text-[9px] text-white/25 font-bold mt-0.5">{season2.season_xp.toLocaleString()} XP</p>
                    </div>
                </div>

                {/* S2 XP progress bar */}
                <div className="flex flex-col gap-1">
                    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-[#3b82f6]/70"
                            style={{ width: `${s2Progress.progress}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-[8px] text-white/20 font-bold">
                        <span>{s2Progress.currentMilestone.toLocaleString()}</span>
                        <span>{s2Progress.nextMilestone.toLocaleString()}</span>
                    </div>
                </div>
            </div>
        </motion.div>
    )
}
