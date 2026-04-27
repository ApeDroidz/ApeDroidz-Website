"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { Wallet } from "lucide-react"
import { GlitchDashboard } from "./types"
import { UserStatsBlock } from "./UserStatsBlock"
import { StreakBlock } from "./StreakBlock"
import { DailyQuestsBlock } from "./DailyQuestsBlock"
import { WeeklyQuestsBlock } from "./WeeklyQuestsBlock"
import { InviteBlock } from "./InviteBlock"
import { staggerContainer, fadeUp } from "@/lib/animations"

interface GlitchGamesPanelProps {
    wallet: string | undefined
    onOpenLeaderboard?: () => void
    onDashboardLoaded?: (isHolder: boolean) => void
}

export function GlitchGamesPanel({ wallet, onOpenLeaderboard, onDashboardLoaded }: GlitchGamesPanelProps) {
    const [dashboard, setDashboard] = useState<GlitchDashboard | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [fetchError, setFetchError] = useState<string | null>(null)
    const [refreshTick, setRefreshTick] = useState(0)

    const fetchDashboard = useCallback(async () => {
        if (!wallet) {
            setDashboard(null)
            setIsLoading(false)
            return
        }
        setIsLoading(true)
        setFetchError(null)
        try {
            const res = await fetch(`/api/glitch_games/dashboard?wallet=${encodeURIComponent(wallet)}`, { cache: 'no-store' })
            const json = await res.json()
            if (!res.ok) {
                const msg = json?.error || `HTTP ${res.status}`
                console.error('[Panel] Dashboard error:', msg)
                setFetchError(msg)
            } else {
                setDashboard(json)
                onDashboardLoaded?.(json.isHolder ?? false)
            }
        } catch (err: any) {
            console.error('[Panel] Dashboard fetch error:', err)
            setFetchError(err.message || 'Network error')
        } finally {
            setIsLoading(false)
        }
    }, [wallet])

    useEffect(() => { fetchDashboard() }, [fetchDashboard, refreshTick])

    // Re-fetch when a game is played — delayed to let fire-and-forget RPCs finish writing
    useEffect(() => {
        const handleGamePlayed = () => setTimeout(() => setRefreshTick(t => t + 1), 1500)
        window.addEventListener('game_history_updated', handleGamePlayed)
        window.addEventListener('flight_round_complete', handleGamePlayed)
        return () => {
            window.removeEventListener('game_history_updated', handleGamePlayed)
            window.removeEventListener('flight_round_complete', handleGamePlayed)
        }
    }, [])

    const handleQuestClaimed = useCallback((_xpGained: number, _ticketsGained: number) => {
        // Refresh dashboard after claim to update XP and progress
        setTimeout(() => setRefreshTick(t => t + 1), 400)
    }, [])

    const handleStreakClaimed = useCallback(() => {
        setTimeout(() => setRefreshTick(t => t + 1), 400)
    }, [])

    if (!wallet) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[240px] py-12 px-4 text-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <Wallet className="w-5 h-5 text-white/20" />
                </div>
                <p className="text-sm font-bold text-white/30 uppercase tracking-widest">Connect wallet to track progress</p>
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="flex flex-col gap-4 animate-pulse">
                {([80, 128, 192, 96] as const).map((h, i) => (
                    <div key={i} className="rounded-2xl bg-white/[0.04]" style={{ height: h }} />
                ))}
            </div>
        )
    }

    if (!dashboard) {
        return (
            <div className="flex flex-col items-center justify-center py-12 gap-3 px-4">
                <p className="text-xs text-white/25 font-bold uppercase tracking-widest">Failed to load</p>
                {fetchError && (
                    <p className="text-[10px] text-red-400/60 font-mono text-center break-all">{fetchError}</p>
                )}
                <button
                    onClick={() => setRefreshTick(t => t + 1)}
                    className="text-[10px] text-white/30 hover:text-white/60 transition-colors font-bold uppercase tracking-widest underline underline-offset-2 cursor-pointer"
                >
                    Retry
                </button>
            </div>
        )
    }

    return (
        <motion.div
            className="flex flex-col gap-5"
            variants={staggerContainer}
            initial="hidden"
            animate="show"
        >
            {/* ── User Stats ── */}
            <UserStatsBlock
                wallet={wallet}
                isHolder={dashboard.isHolder}
                season2={dashboard.season2}
                gamesBalance={dashboard.games_balance}
                apeBalance={dashboard.ape_balance ?? 0}
                isFetching={isLoading}
                onOpenLeaderboard={onOpenLeaderboard}
            />

            <div className="h-[1px] bg-white/5" />

            {/* ── Streak ── */}
            <StreakBlock
                streak={dashboard.streak}
                isHolder={dashboard.isHolder}
                wallet={wallet}
                onClaimed={handleStreakClaimed}
            />

            <div className="h-[1px] bg-white/5" />

            {/* ── Daily Quests ── */}
            <DailyQuestsBlock
                quests={dashboard.daily_quests}
                isHolder={dashboard.isHolder}
                wallet={wallet}
                onQuestClaimed={handleQuestClaimed}
            />

            <div className="h-[1px] bg-white/5" />

            {/* ── Weekly Quests ── */}
            <WeeklyQuestsBlock
                quests={dashboard.weekly_quests}
                isHolder={dashboard.isHolder}
                wallet={wallet}
                onQuestClaimed={handleQuestClaimed}
            />

            <div className="h-[1px] bg-white/5" />

            {/* ── Invite & Earn ── */}
            <InviteBlock wallet={wallet} />

        </motion.div>
    )
}
