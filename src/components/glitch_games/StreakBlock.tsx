"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Zap, CheckCircle, Loader2, Lock, Ticket } from "lucide-react"
import { StreakData, STREAK_REWARDS } from "./types"
import { fadeUp } from "@/lib/animations"
import { useGlitchSession } from "@/hooks/useGlitchSession"

interface StreakBlockProps {
    streak: StreakData
    isHolder: boolean
    wallet: string | undefined
    onClaimed: () => void
}

export function StreakBlock({ streak, isHolder, wallet, onClaimed }: StreakBlockProps) {
    const [isClaiming, setIsClaiming] = useState(false)
    const [claimMsg, setClaimMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
    const { ensureLogin } = useGlitchSession()

    // Position in 7-day cycle (1-7), 0 if no streak yet
    const cyclePos = streak.current_streak > 0 ? ((streak.current_streak - 1) % 7) + 1 : 0

    // The "active" day — today if played, or next available if not
    const activeDayIndex = streak.is_active_today
        ? cyclePos
        : (cyclePos % 7) + 1  // for new users cyclePos=0 → day 1; after day 7 → day 1 (new cycle)

    const canClaimToday = streak.is_active_today && activeDayIndex > streak.streak_reward_claimed_day

    const handleClaim = async () => {
        if (!wallet || isClaiming || !canClaimToday) return
        const ok = await ensureLogin()
        if (!ok) {
            setClaimMsg({ type: "error", text: "Please sign in" })
            return
        }
        setIsClaiming(true)
        setClaimMsg(null)
        try {
            // No body needed — wallet from cookie, isHolder verified server-side.
            const res = await fetch('/api/glitch_games/quest/claim', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({}),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Claim failed')

            let msg = `+${data.xp_gained} XP`
            if (data.tickets_gained > 0) msg += ` · +${data.tickets_gained} Ticket`
            if (data.ape_gained > 0) msg += ` · +${data.ape_gained} APE`
            setClaimMsg({ type: "success", text: msg })
            onClaimed()
        } catch (err: any) {
            setClaimMsg({ type: "error", text: err.message })
        } finally {
            setIsClaiming(false)
        }
    }

    return (
        <motion.div variants={fadeUp} className="flex flex-col gap-3">
            {/* Header row: title + current streak counter */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-orange-400" />
                    <span className="text-xs font-black uppercase tracking-widest text-white/70">Daily Streak</span>
                </div>
                <div className="flex items-center gap-2">
                    {streak.best_streak > 0 && (
                        <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Best: {streak.best_streak}</span>
                    )}
                    {/* Current streak pill */}
                    <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-black ${
                        streak.current_streak > 0
                            ? "bg-orange-500/15 border-orange-500/30 text-orange-400"
                            : "bg-white/5 border-white/10 text-white/30"
                    }`}>
                        <Zap className="w-2.5 h-2.5" />
                        <span>{cyclePos}/7</span>
                    </div>
                </div>
            </div>

            {/* 7-day grid */}
            <div className="grid grid-cols-7 gap-1">
                {STREAK_REWARDS.map((reward) => {
                    const dayNum = reward.day
                    const isPastClaimed = dayNum < activeDayIndex && streak.streak_reward_claimed_day >= dayNum
                    const isPastUnclaimed = dayNum < activeDayIndex && streak.streak_reward_claimed_day < dayNum
                    const isActiveToday = dayNum === activeDayIndex && streak.is_active_today
                    const isPendingToday = dayNum === activeDayIndex && !streak.is_active_today
                    const isFuture = dayNum > activeDayIndex

                    const hasTicket = reward.ticket > 0
                    const hasApe = reward.ape > 0

                    return (
                        <div
                            key={dayNum}
                            className={`relative flex flex-col items-center gap-0.5 py-2 px-0.5 rounded-xl border transition-all ${
                                isPastClaimed || isPastUnclaimed
                                    ? "bg-white/5 border-white/10"
                                    : isActiveToday
                                        ? "bg-orange-500/15 border-orange-500/40 shadow-[0_0_10px_rgba(249,115,22,0.12)]"
                                        : isPendingToday
                                            ? "bg-white/[0.05] border-white/20"
                                            : "bg-white/[0.02] border-white/5"
                            }`}
                        >
                            {/* Day number */}
                            <span className={`text-[8px] font-black uppercase tracking-widest ${
                                isActiveToday ? "text-orange-400"
                                : isPendingToday ? "text-white/50"
                                : isPastClaimed || isPastUnclaimed ? "text-white/40"
                                : "text-white/20"
                            }`}>{dayNum}</span>

                            {/* State icon */}
                            {isPastClaimed ? (
                                <CheckCircle className="w-3.5 h-3.5 text-white/25" />
                            ) : isActiveToday ? (
                                <Zap className="w-3.5 h-3.5 text-orange-400" />
                            ) : isPendingToday ? (
                                <Zap className="w-3.5 h-3.5 text-white/40" />
                            ) : isPastUnclaimed ? (
                                <CheckCircle className="w-3.5 h-3.5 text-white/15" />
                            ) : (
                                <Lock className="w-3 h-3 text-[#262626]" />
                            )}

                            {/* XP reward */}
                            <span className={`text-[7px] font-black leading-none ${
                                isActiveToday ? "text-orange-300"
                                : isPendingToday ? "text-white/40"
                                : isPastClaimed || isPastUnclaimed ? "text-white/25"
                                : "text-white/15"
                            }`}>{reward.xp}</span>

                            {/* Bonus badge — ticket or APE */}
                            {(hasTicket || hasApe) && (
                                <span className={`flex items-center gap-0.5 text-[6px] font-black leading-none px-1 py-0.5 rounded-full border mt-0.5 ${
                                    isHolder
                                        ? isActiveToday
                                            ? "bg-orange-500/25 border-orange-400/40 text-orange-300"
                                            : isPendingToday
                                                ? "bg-white/5 border-white/20 text-white/40"
                                                : isPastClaimed || isPastUnclaimed
                                                    ? "bg-white/5 border-white/15 text-white/30"
                                                    : "bg-white/[0.03] border-white/10 text-white/20"
                                        : "bg-white/[0.02] border-white/5 text-white/15"
                                }`}>
                                    {hasApe ? "+5 APE" : (
                                        <><Ticket className="w-2 h-2" />+1</>
                                    )}
                                </span>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Claim button */}
            {canClaimToday && (
                <button
                    onClick={handleClaim}
                    disabled={isClaiming}
                    className="w-full h-10 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-black uppercase tracking-[0.12em] flex items-center justify-center gap-2 transition-all shadow-lg shadow-orange-900/20 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                    {isClaiming ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Claiming...</>
                    ) : (
                        <>
                            <Zap className="w-3.5 h-3.5" />
                            Claim Day {activeDayIndex} · +{STREAK_REWARDS[activeDayIndex - 1]?.xp ?? 0} XP
                            {isHolder && STREAK_REWARDS[activeDayIndex - 1]?.ticket > 0 && " · +1 Ticket"}
                            {isHolder && STREAK_REWARDS[activeDayIndex - 1]?.ape > 0 && " · +5 APE"}
                        </>
                    )}
                </button>
            )}

            {/* Status text */}
            {!streak.is_active_today && streak.current_streak === 0 && (
                <p className="text-[10px] text-white/25 font-medium text-center">
                    Play any game to start your streak
                </p>
            )}
            {!streak.is_active_today && streak.current_streak > 0 && (
                <p className="text-[10px] text-white/25 font-medium text-center">
                    Play a game today to continue your streak!
                </p>
            )}

            <AnimatePresence>
                {claimMsg && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-2 ${
                            claimMsg.type === "success"
                                ? "bg-green-500/10 border border-green-500/20 text-green-400"
                                : "bg-red-500/10 border border-red-500/20 text-red-400"
                        }`}
                    >
                        {claimMsg.text}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}
