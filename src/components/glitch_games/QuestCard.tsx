"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { CheckCircle, Loader2, Ticket, Zap, Lock, ExternalLink } from "lucide-react"
import { GlitchQuest, getPeriodKey } from "./types"
import { useGlitchSession } from "@/hooks/useGlitchSession"

interface QuestCardProps {
    quest: GlitchQuest
    isHolder: boolean
    wallet: string | undefined
    onClaimed: (xpGained: number, ticketsGained: number) => void
}

export function QuestCard({ quest, isHolder, wallet, onClaimed }: QuestCardProps) {
    const [isClaiming, setIsClaiming] = useState(false)
    const [claimMsg, setClaimMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
    const { ensureLogin } = useGlitchSession()

    const periodKey = getPeriodKey(quest.id.startsWith('weekly') ? 'weekly' : 'daily')
    const isClaimed = quest.claimed_at !== null
    const isLocked = quest.is_holder_only && !isHolder
    const isSocial = quest.category === 'social'

    // Compute progress (0-1)
    let progressFraction = 0
    let progressLabel = ""
    if (quest.required_multiplier > 0) {
        progressFraction = quest.max_multiplier >= quest.required_multiplier ? 1 : quest.max_multiplier / quest.required_multiplier
        progressLabel = `${quest.max_multiplier.toFixed(1)}x / ${quest.required_multiplier}x`
    } else {
        const cardsOk  = quest.required_cards === 0 || quest.cards_played >= quest.required_cards
        const flightsOk = quest.required_flights === 0 || quest.flights_played >= quest.required_flights
        if (quest.required_cards > 0 && quest.required_flights > 0) {
            const cf = Math.min(quest.cards_played / quest.required_cards, 1)
            const ff = Math.min(quest.flights_played / quest.required_flights, 1)
            progressFraction = (cf + ff) / 2
            progressLabel = `${quest.cards_played}/${quest.required_cards} Cards · ${quest.flights_played}/${quest.required_flights} Flights`
        } else if (quest.required_cards > 0) {
            progressFraction = Math.min(quest.cards_played / quest.required_cards, 1)
            progressLabel = `${quest.cards_played} / ${quest.required_cards} Cards`
        } else if (quest.required_flights > 0) {
            progressFraction = Math.min(quest.flights_played / quest.required_flights, 1)
            progressLabel = `${quest.flights_played} / ${quest.required_flights} Flights`
        }
    }

    const handleClaim = async () => {
        if (!wallet || isClaiming || !quest.is_complete || isClaimed) return
        const ok = await ensureLogin()
        if (!ok) {
            setClaimMsg({ type: "error", text: "Please sign in" })
            return
        }
        setIsClaiming(true)
        setClaimMsg(null)
        try {
            // Body no longer carries wallet or isHolder — both are derived from
            // the session cookie + on-chain check on the server.
            const res = await fetch('/api/glitch_games/quest/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ questId: quest.id, periodKey }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Claim failed')

            let msg = `+${data.xp_gained} XP`
            if (data.tickets_gained > 0) msg += ` · +${data.tickets_gained} Ticket`
            setClaimMsg({ type: "success", text: msg })
            onClaimed(data.xp_gained, data.tickets_gained)
        } catch (err: any) {
            setClaimMsg({ type: "error", text: err.message })
        } finally {
            setIsClaiming(false)
        }
    }

    return (
        <div className={`flex flex-col gap-2.5 p-3 rounded-xl border transition-all ${
            isClaimed
                ? "bg-white/[0.02] border-white/5 opacity-60"
                : isLocked
                    ? "bg-white/[0.02] border-white/5 opacity-50"
                    : quest.is_complete
                        ? "bg-[#0069FF]/5 border-[#0069FF]/20"
                        : "bg-white/[0.03] border-white/10"
        }`}>
            {/* Title row */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        {isClaimed && <CheckCircle className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />}
                        {isLocked && <Lock className="w-3 h-3 text-white/20 flex-shrink-0" />}
                        <span className={`text-xs font-bold leading-tight ${isClaimed ? "text-white/30 line-through" : isLocked ? "text-white/25" : "text-white/80"}`}>
                            {quest.title}
                        </span>
                    </div>
                    {isLocked && (
                        <span className="text-[9px] text-white/20 font-bold uppercase tracking-widest">Holders only</span>
                    )}
                </div>

                {/* Rewards badge */}
                <div className="flex items-center gap-1 flex-shrink-0">
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
                        <Zap className="w-2.5 h-2.5 text-[#0069FF]" />
                        <span className="text-[9px] font-black text-white/60">+{quest.xp_reward}</span>
                    </div>
                    {quest.ticket_reward > 0 && isHolder && (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-500/10 border border-orange-500/20">
                            <Ticket className="w-2.5 h-2.5 text-orange-400" />
                            <span className="text-[9px] font-black text-orange-400">+{quest.ticket_reward}</span>
                        </div>
                    )}
                    {quest.ticket_reward > 0 && !isHolder && (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/5 opacity-40">
                            <Ticket className="w-2.5 h-2.5 text-white/30" />
                            <span className="text-[9px] font-black text-white/30">+{quest.ticket_reward}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Social quest — link to existing daily flow */}
            {isSocial && !isClaimed && !isLocked && (
                <a
                    href="/glitch_games/cards#daily"
                    className="flex items-center gap-1.5 text-[10px] font-bold text-[#0069FF]/70 hover:text-[#0069FF] transition-colors"
                >
                    <ExternalLink className="w-3 h-3" />
                    Complete via Glitch Cards Daily tab
                </a>
            )}

            {/* Progress bar (non-social quests) */}
            {!isSocial && !isClaimed && !isLocked && (
                <div className="flex flex-col gap-1">
                    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                        <motion.div
                            className={`h-full rounded-full ${quest.is_complete ? "bg-[#0069FF]" : "bg-white/30"}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${progressFraction * 100}%` }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                    </div>
                    {progressLabel && (
                        <span className="text-[9px] text-white/30 font-medium">{progressLabel}</span>
                    )}
                </div>
            )}

            {/* Claim button */}
            {quest.is_complete && !isClaimed && !isSocial && !isLocked && (
                <button
                    onClick={handleClaim}
                    disabled={isClaiming}
                    className="w-full h-8 rounded-lg bg-[#0069FF] hover:bg-[#0055CC] text-white text-[9px] font-black uppercase tracking-[0.12em] flex items-center justify-center gap-1.5 transition-all disabled:opacity-60 cursor-pointer"
                >
                    {isClaiming ? <><Loader2 className="w-3 h-3 animate-spin" /> Claiming...</> : "Claim Reward"}
                </button>
            )}

            {/* Message */}
            <AnimatePresence>
                {claimMsg && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 ${
                            claimMsg.type === "success"
                                ? "bg-green-500/10 border border-green-500/20 text-green-400"
                                : "bg-red-500/10 border border-red-500/20 text-red-400"
                        }`}
                    >
                        {claimMsg.text}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
