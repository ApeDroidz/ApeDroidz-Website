"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import Link from "next/link"
import {
    CheckCircle, AlertCircle, Loader2, Shield,
    ExternalLink, CheckSquare, Square, Gamepad2, ArrowUpRight, Ticket, Zap, Lock,
} from "lucide-react"
import { useActiveAccount } from "thirdweb/react"
import { getContract } from "thirdweb/contract"
import { balanceOf } from "thirdweb/extensions/erc721"
import { client, apeChain } from "@/lib/thirdweb"
import { supabase } from "@/lib/supabase"
import { useGlitchSession } from "@/hooks/useGlitchSession"

// ── Quest types ──────────────────────────────────────────────────────────────
type ActivityQuestType = 'cards_2' | 'cards_5' | 'flight_2' | 'flight_5'
                       | 'cards_20' | 'cards_50' | 'flight_20' | 'flight_50'

interface QuestState { count: number; claimed: boolean }
type ActivityState = Record<ActivityQuestType, QuestState>

const QUEST_META: Array<{
    key: ActivityQuestType
    label: string
    required: number
    xp: number
    period: 'daily' | 'weekly'
    bonus?: string
}> = [
    { key: 'cards_2',   label: 'Play 2 Cards Games',   required: 2,  xp: 100,  period: 'daily'  },
    { key: 'cards_5',   label: 'Play 5 Cards Games',   required: 5,  xp: 200,  period: 'daily'  },
    { key: 'flight_2',  label: 'Play 2 Flight Games',  required: 2,  xp: 100,  period: 'daily'  },
    { key: 'flight_5',  label: 'Play 5 Flight Games',  required: 5,  xp: 200,  period: 'daily'  },
    { key: 'cards_20',  label: 'Play 20 Cards Games',  required: 20, xp: 500,  period: 'weekly', bonus: '+1 Ticket' },
    { key: 'cards_50',  label: 'Play 50 Cards Games',  required: 50, xp: 1000, period: 'weekly', bonus: '+2 Tickets' },
    { key: 'flight_20', label: 'Play 20 Flight Games', required: 20, xp: 500,  period: 'weekly', bonus: '+5 APE' },
    { key: 'flight_50', label: 'Play 50 Flight Games', required: 50, xp: 1000, period: 'weekly', bonus: '+10 APE' },
]

const EMPTY_ACTIVITY = Object.fromEntries(
    QUEST_META.map(q => [q.key, { count: 0, claimed: false }])
) as ActivityState

// ── Weekly streak config (displayed in circles) ──────────────────────────────
const STREAK_DAYS = [
    { day: 1, xp: 50 },
    { day: 2, xp: 75 },
    { day: 3, xp: 100 },
    { day: 4, xp: 150, ticket: 1 },
    { day: 5, xp: 150 },
    { day: 6, xp: 200 },
    { day: 7, xp: 300, apes: 5 },
] as const


const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""

interface ActiveTask {
    id: number
    tweet_url: string
    title?: string
    active_to: string
}

function useCountdown(activeTo: string | undefined) {
    const [text, setText] = useState("")
    useEffect(() => {
        if (!activeTo) { setText(""); return }
        const tick = () => {
            const diff = new Date(activeTo).getTime() - Date.now()
            if (diff <= 0) { setText("00:00:00"); return }
            const h = Math.floor(diff / 3600000)
            const m = Math.floor((diff % 3600000) / 60000)
            const s = Math.floor((diff % 60000) / 1000)
            setText(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`)
        }
        tick()
        const id = setInterval(tick, 1000)
        return () => clearInterval(id)
    }, [activeTo])
    return text
}

function playWin() { new Audio('/sounds/fx/win(1).MP3').play().catch(() => {}) }
function playClick() {
    const a = new Audio('/sounds/fx/crd_pick_sound.mp3'); a.volume = 0.45; a.play().catch(() => {})
}
function playHover() {
    const a = new Audio('/sounds/fx/ui_hover_buttons.mp3'); a.volume = 0.25; a.play().catch(() => {})
}

export function QuestsPanel({ onQuestClaimed }: { onQuestClaimed?: () => void }) {
    const account = useActiveAccount()
    const wallet = account?.address
    const { ensureLogin } = useGlitchSession()

    const [droidCount, setDroidCount] = useState(0)
    const [xHandle, setXHandle] = useState<string | null>(null)
    const [loadingHolder, setLoadingHolder] = useState(false)

    const [activeTask, setActiveTask] = useState<ActiveTask | null>(null)
    const [alreadyClaimed, setAlreadyClaimed] = useState(false)
    const [loadingState, setLoadingState] = useState(false)
    const [ticketExpanded, setTicketExpanded] = useState(false)

    const [hasLiked, setHasLiked] = useState(false)
    const [hasRetweeted, setHasRetweeted] = useState(false)
    const [proofLink, setProofLink] = useState("")
    const [isVerifying, setIsVerifying] = useState(false)
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)

    const [isLinkingX, setIsLinkingX] = useState(false)
    const [tempXHandle, setTempXHandle] = useState("")
    const [isSavingX, setIsSavingX] = useState(false)

    // Activity quests
    const [activity, setActivity] = useState<ActivityState>(EMPTY_ACTIVITY)
    const [activityLoading, setActivityLoading] = useState(false)
    const [activityClaiming, setActivityClaiming] = useState<string | null>(null)
    const [activityMsg, setActivityMsg] = useState<{ type: 'error'; text: string; quest: string } | null>(null)
    const [freshClaimed, setFreshClaimed] = useState<Set<string>>(new Set())

    // Streak
    const [streakDays, setStreakDays] = useState(0)
    const [claimedStreakDays, setClaimedStreakDays] = useState<Set<number>>(new Set())
    const [streakClaiming, setStreakClaiming] = useState<number | null>(null)
    const [freshStreakDays, setFreshStreakDays] = useState<Set<number>>(new Set())


    const countdown = useCountdown(activeTask?.active_to)

    // ── Fetch holder status ──────────────────────────────────────────────────
    const isHolder = droidCount > 0
    const ticketsPerDay = droidCount > 0 ? 1 + Math.floor((droidCount - 1) / 30) : 0

    const fetchHolder = useCallback(async () => {
        if (!wallet) { setDroidCount(0); setXHandle(null); return }
        setLoadingHolder(true)
        try {
            const droidContract = getContract({ client, chain: apeChain, address: DROID_CONTRACT_ADDRESS })
            const [bal, profile] = await Promise.allSettled([
                balanceOf({ contract: droidContract, owner: wallet }),
                supabase.from("user_profiles").select("x_handle").ilike("wallet_address", wallet).maybeSingle(),
            ])
            setDroidCount(bal.status === "fulfilled" ? Number(bal.value) : 0)
            if (profile.status === "fulfilled") setXHandle(profile.value.data?.x_handle ?? null)
        } catch { /* silent */ } finally {
            setLoadingHolder(false)
        }
    }, [wallet])

    useEffect(() => { fetchHolder() }, [fetchHolder])

    // ── Fetch free-ticket task state ─────────────────────────────────────────
    const fetchDailyState = useCallback(async () => {
        if (!wallet) return
        setLoadingState(true)
        try {
            const res = await fetch(`/api/glitch_game/state?wallet=${wallet}`)
            const data = await res.json()
            setActiveTask(data.activeTask ?? null)
            setAlreadyClaimed(!!data.claimed)
        } catch { /* silent */ } finally {
            setLoadingState(false)
        }
    }, [wallet])

    useEffect(() => { fetchDailyState() }, [fetchDailyState])

    // ── Fetch activity quests + streak ───────────────────────────────────────
    const fetchActivity = useCallback(async () => {
        if (!wallet) return
        setActivityLoading(true)
        try {
            const res = await fetch(`/api/glitch_game/activity-quest?wallet=${wallet}`)
            if (res.ok) {
                const d = await res.json()
                setActivity(d.quests as ActivityState)
                setStreakDays(d.streakDays ?? 0)
                setClaimedStreakDays(new Set(d.streakClaimed ?? []))
            }
        } catch { /* silent */ } finally {
            setActivityLoading(false)
        }
    }, [wallet])

    useEffect(() => { fetchActivity() }, [fetchActivity])

    // ── Claim activity quest ─────────────────────────────────────────────────
    const claimActivity = async (questType: ActivityQuestType) => {
        if (!wallet) return
        const ok = await ensureLogin()
        if (!ok) {
            setActivityMsg({ type: 'error', text: 'Please sign in', quest: questType } as any)
            return
        }
        setActivityClaiming(questType)
        setActivityMsg(null)
        try {
            const res = await fetch('/api/glitch_game/activity-quest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ questType }),
            })
            const d = await res.json()
            if (!res.ok) throw new Error(d.error || 'Claim failed')
            playWin()
            setActivity(prev => ({ ...prev, [questType]: { ...prev[questType], claimed: true } }))
            setFreshClaimed(prev => new Set(prev).add(questType))
            setTimeout(() => setFreshClaimed(prev => { const s = new Set(prev); s.delete(questType); return s }), 5000)
            onQuestClaimed?.()
        } catch (err: any) {
            setActivityMsg({ type: 'error', text: err.message, quest: questType } as any)
        } finally {
            setActivityClaiming(null)
        }
    }

    // ── Claim streak milestone ───────────────────────────────────────────────
    const claimStreak = async (day: number) => {
        if (!wallet) return
        const ok = await ensureLogin()
        if (!ok) return
        setStreakClaiming(day)
        try {
            const res = await fetch('/api/glitch_game/activity-quest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ questType: `streak_${day}` }),
            })
            const d = await res.json()
            if (!res.ok) throw new Error(d.error || 'Claim failed')
            playWin()
            setClaimedStreakDays(prev => new Set(prev).add(day))
            setFreshStreakDays(prev => new Set(prev).add(day))
            setTimeout(() => setFreshStreakDays(prev => { const s = new Set(prev); s.delete(day); return s }), 5000)
            onQuestClaimed?.()
        } catch { /* silent */ } finally {
            setStreakClaiming(null)
        }
    }

    // ── Free-ticket claim ────────────────────────────────────────────────────
    const performClaim = async (handle: string) => {
        const ok = await ensureLogin()
        if (!ok) {
            setMsg({ type: "error", text: "Please sign in" })
            return
        }
        setIsVerifying(true)
        setMsg(null)
        await new Promise(r => setTimeout(r, 800))

        const linkMatch = proofLink.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i)
        if (linkMatch) {
            const linkUser = linkMatch[1].toLowerCase()
            const handleUser = handle.replace("@", "").toLowerCase()
            if (linkUser !== handleUser) {
                setMsg({ type: "error", text: `Link (@${linkUser}) doesn't match (@${handleUser})` })
                setIsVerifying(false)
                return
            }
        }

        try {
            const res = await fetch("/api/glitch_game/daily", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ proofLink: proofLink.trim(), xHandle: handle }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Claim failed")
            setMsg({ type: "success", text: `+${data.ticketsGranted ?? ticketsPerDay} Ticket${(data.ticketsGranted ?? ticketsPerDay) !== 1 ? 's' : ''}!` })
            setProofLink("")
            setHasLiked(false)
            setHasRetweeted(false)
            setAlreadyClaimed(true)
            setTicketExpanded(false)
            onQuestClaimed?.()
        } catch (err: any) {
            setMsg({ type: "error", text: err.message })
        } finally {
            setIsVerifying(false)
        }
    }

    const handleClaim = () => {
        if (!xHandle || xHandle === "unknown") { setIsLinkingX(true); return }
        performClaim(xHandle)
    }

    const handleSaveX = async () => {
        if (!wallet || !tempXHandle.trim()) return
        const ok = await ensureLogin()
        if (!ok) {
            setMsg({ type: "error", text: "Please sign in" })
            return
        }
        setIsSavingX(true)
        let clean = tempXHandle.trim()
        if (!clean.startsWith("@")) clean = "@" + clean
        try {
            const res = await fetch("/api/user/update-x", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ xHandle: clean }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Failed to save")
            setXHandle(clean)
            setIsLinkingX(false)
            performClaim(clean)
        } catch (err: any) {
            setMsg({ type: "error", text: err.message || "Failed to save X handle" })
        } finally {
            setIsSavingX(false)
        }
    }

    const canClaim = hasLiked && hasRetweeted && proofLink.trim().length > 5

    // ── Guards ────────────────────────────────────────────────────────────────
    if (!wallet) return (
        <div className="flex-1 flex items-center justify-center">
            <p className="text-xs font-mono text-white/20 text-center">Connect wallet to view quests</p>
        </div>
    )

    // (streak milestones are now rendered inline in the day cards)

    return (
        <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto
            [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent
            [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full"
        >

            {/* ══ Free Ticket ══════════════════════════════════════════════════ */}
            {activeTask && (
                <div className="flex flex-col gap-2">
                    <span className="text-sm font-black text-white uppercase tracking-wide">Free Ticket</span>

                    {!isHolder ? (
                        <div className="flex flex-col items-center gap-3 py-5 px-4 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center">
                            <Shield className="w-5 h-5 text-white/20" />
                            <div>
                                <p className="text-xs font-black text-white/50 uppercase tracking-wide mb-1">Holders Only</p>
                                <p className="text-[10px] text-white/25">You need at least 1 ApeDroid</p>
                            </div>
                            <a
                                href="https://opensea.io/collection/apedroidz"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                            >
                                <img src="/Opensea.svg" alt="OpenSea" className="w-4 h-4 opacity-60" />
                                <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">Get on OpenSea</span>
                            </a>
                        </div>

                    ) : alreadyClaimed ? (
                        /* Claimed — single collapsed row */
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.015] border border-white/[0.04]">
                            <Ticket className="w-3 h-3 flex-shrink-0 text-white/15" />
                            <span className="text-[10px] font-bold flex-1 leading-none text-white/20">
                                {activeTask.title || "Daily Mission"}
                            </span>
                            <span className="text-[10px] font-black text-white/20 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3 text-green-500/50" />
                                +{100 * Math.max(1, ticketsPerDay)} XP
                            </span>
                        </div>

                    ) : (
                        /* Active — compact header row + expandable body */
                        <div className={`flex flex-col rounded-xl border transition-colors overflow-hidden ${ticketExpanded ? 'bg-[#0069FF]/5 border-[#0069FF]/20' : 'bg-white/[0.02] border-white/[0.04]'}`}>
                            {/* Header row — only the TITLE is a clickable link.
                                The reward line below is plain text so accidental
                                clicks on it don't punt the user to X. */}
                            <div className="flex items-center gap-3 px-3 py-2.5">
                                <div className={`flex-1 min-w-0 transition-colors ${ticketExpanded ? 'text-white' : 'text-white/70'}`}>
                                    <div className="flex items-center gap-1 min-w-0">
                                        <a
                                            href={activeTask.tweet_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`font-black leading-snug flex-1 min-w-0 truncate transition-all hover:text-white hover:underline decoration-[#0069FF]/40 underline-offset-2 ${ticketExpanded ? 'text-sm' : 'text-[10px]'}`}
                                            title="Open the X post"
                                        >
                                            {activeTask.title || "Daily Mission"}
                                        </a>
                                    </div>
                                    <span className="text-[9px] font-black">
                                        <span className="text-[#0069FF]">+{100 * ticketsPerDay} XP</span>
                                        <span className="text-white/30 font-bold"> · </span>
                                        <span className="text-orange-400">+{ticketsPerDay} Ticket{ticketsPerDay !== 1 ? 's' : ''}</span>
                                        {ticketsPerDay > 1 && (
                                            <span className="text-white/30 font-bold"> · {droidCount} droids</span>
                                        )}
                                    </span>
                                    {/* Always visible hint so single-droid holders know
                                        bigger wallets get more rewards. Compact tooltip-style
                                        line so it doesn't clutter the row. */}
                                    <span className="block text-[8px] text-white/25 font-medium leading-tight mt-0.5">
                                        +1 extra ticket &amp; +100 XP per 30 droids held
                                    </span>
                                </div>

                                {/* Button(s) with timer overlay */}
                                <div className="relative flex-shrink-0 flex items-center gap-1.5">
                                    <div className="absolute -top-2.5 left-0 right-0 flex justify-center z-10 pointer-events-none">
                                        <span className="text-[7px] font-mono font-bold text-white/40 bg-black/80 border border-white/10 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                            {countdown}
                                        </span>
                                    </div>
                                    {ticketExpanded && (
                                        <button
                                            onClick={() => setTicketExpanded(false)}
                                            onMouseEnter={playHover}
                                            className="px-2.5 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer bg-white/8 text-white/35 hover:bg-white/12 hover:text-white/55 border border-white/10"
                                        >
                                            Less
                                        </button>
                                    )}
                                    {ticketExpanded ? (
                                        <a
                                            href={activeTask.tweet_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onMouseEnter={playHover}
                                            className="px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer bg-[#0069FF] text-white hover:bg-[#0055CC] flex items-center gap-1"
                                        >
                                            Open Post
                                            <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                    ) : (
                                        <button
                                            onClick={() => setTicketExpanded(true)}
                                            onMouseEnter={playHover}
                                            className="px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer bg-[#0069FF] text-white hover:bg-[#0055CC]"
                                        >
                                            Claim
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Expanded claim form — no duplicate title */}
                            <AnimatePresence>
                                {ticketExpanded && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="flex flex-col gap-2 px-3 pb-3">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => setHasLiked(v => !v)}
                                                    className="flex items-center gap-1.5 px-3 h-8 rounded-xl bg-black/20 hover:bg-black/40 border border-white/10 transition-all cursor-pointer"
                                                >
                                                    {hasLiked
                                                        ? <CheckSquare className="w-3 h-3 text-white/80" />
                                                        : <Square className="w-3 h-3 text-white/30" />}
                                                    <span className={`text-[10px] font-bold uppercase ${hasLiked ? "text-white/80" : "text-white/40"}`}>Like</span>
                                                </button>
                                                <button
                                                    onClick={() => setHasRetweeted(v => !v)}
                                                    className="flex items-center gap-1.5 px-3 h-8 rounded-xl bg-black/20 hover:bg-black/40 border border-white/10 transition-all cursor-pointer"
                                                >
                                                    {hasRetweeted
                                                        ? <CheckSquare className="w-3 h-3 text-white/80" />
                                                        : <Square className="w-3 h-3 text-white/30" />}
                                                    <span className={`text-[10px] font-bold uppercase ${hasRetweeted ? "text-white/80" : "text-white/40"}`}>RT</span>
                                                </button>
                                                <input
                                                    type="url"
                                                    placeholder="Link to comment..."
                                                    value={proofLink}
                                                    onChange={e => { setProofLink(e.target.value); setMsg(null) }}
                                                    disabled={isVerifying}
                                                    className="flex-1 h-8 px-3 rounded-xl bg-black/20 border border-white/10 text-white/80
                                                        text-[10px] placeholder:text-white/20 focus:outline-none focus:border-white/30
                                                        transition-all disabled:opacity-50 min-w-0"
                                                />
                                            </div>

                                            <AnimatePresence mode="wait">
                                                {isLinkingX ? (
                                                    <motion.div key="linkx" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-2">
                                                        <input
                                                            autoFocus
                                                            type="text"
                                                            placeholder="@username"
                                                            value={tempXHandle}
                                                            onChange={e => setTempXHandle(e.target.value)}
                                                            onKeyDown={e => e.key === "Enter" && handleSaveX()}
                                                            className="flex-1 h-8 px-3 rounded-xl bg-white/5 border border-white/10 text-white font-bold text-xs focus:outline-none focus:border-[#0069FF] transition-all placeholder:text-white/20"
                                                        />
                                                        <button
                                                            onClick={handleSaveX}
                                                            disabled={!tempXHandle.trim() || isSavingX}
                                                            className="px-3 h-8 bg-[#0069FF] hover:bg-[#0055CC] text-white rounded-xl flex items-center justify-center transition-all disabled:opacity-50"
                                                        >
                                                            {isSavingX ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="text-[10px] font-black uppercase">Save</span>}
                                                        </button>
                                                    </motion.div>
                                                ) : (
                                                    <motion.button
                                                        key="verify"
                                                        initial={{ opacity: 0 }}
                                                        animate={{ opacity: 1 }}
                                                        exit={{ opacity: 0 }}
                                                        onClick={handleClaim}
                                                        disabled={!canClaim || isVerifying}
                                                        className={`w-full h-9 rounded-xl text-[10px] font-black tracking-[0.15em] uppercase border transition-all flex items-center justify-center gap-2 ${
                                                            canClaim && !isVerifying
                                                                ? "bg-[#0069FF] border-[#0069FF] text-white hover:bg-[#0055CC] cursor-pointer"
                                                                : "bg-white/5 border-white/10 text-white/20 cursor-not-allowed"
                                                        }`}
                                                    >
                                                        {isVerifying
                                                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Verifying...</>
                                                            : "Verify & Claim"}
                                                    </motion.button>
                                                )}
                                            </AnimatePresence>

                                            <AnimatePresence>
                                                {msg && (
                                                    <motion.div
                                                        initial={{ opacity: 0, y: -4 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0 }}
                                                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-medium ${
                                                            msg.type === "success"
                                                                ? "bg-green-500/10 border border-green-500/20 text-green-400"
                                                                : "bg-red-500/10 border border-red-500/20 text-red-400"
                                                        }`}
                                                    >
                                                        {msg.type === "success"
                                                            ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                                            : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                                                        {msg.text}
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            )}

            {/* ══ Weekly Streak ════════════════════════════════════════════════ */}
            <div className="flex flex-col gap-2">
                <span className="text-sm font-black text-white uppercase tracking-wide">Weekly Streak</span>

                <div className="grid grid-cols-7 gap-1">
                    {STREAK_DAYS.map(({ day, xp, ...extras }) => {
                        const unlocked  = streakDays >= day
                        const claimed   = claimedStreakDays.has(day)
                        const isFresh   = freshStreakDays.has(day)
                        const upcoming  = !unlocked && !claimed && day === streakDays + 1
                        const canClaimDay = unlocked && !claimed
                        const claiming  = streakClaiming === day
                        const hasTicket = 'ticket' in extras
                        const hasApes   = 'apes' in extras

                        const borderCls = isFresh
                            ? 'bg-green-950/60 border-green-700/40'
                            : claimed
                            ? 'bg-neutral-950 border-[#0069FF]/25'
                            : unlocked
                            ? 'bg-neutral-900 border-neutral-700'
                            : upcoming
                            ? 'bg-neutral-900/50 border-white/15'
                            : 'bg-neutral-950 border-neutral-800/40'

                        const xpCls = isFresh    ? 'text-green-400/70'
                            : claimed   ? 'text-neutral-600'
                            : unlocked  ? 'text-white/55'
                            : upcoming  ? 'text-white/30'
                            : 'text-neutral-700'

                        const rewardCls = isFresh || claimed
                            ? 'text-neutral-600'
                            : unlocked
                            ? (hasTicket ? 'text-orange-400' : 'text-purple-400')
                            : upcoming
                            ? (hasTicket ? 'text-orange-900' : 'text-purple-900/80')
                            : 'text-neutral-700'

                        return (
                            <div key={day} className="flex flex-col gap-0.5">
                                {/* Card */}
                                <div className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl border transition-all ${borderCls}`}>
                                    {/* Day number + state icon */}
                                    <div className="flex items-center gap-0.5">
                                        <span className={`text-[9px] font-black leading-none ${
                                            claimed   ? (isFresh ? 'text-green-400/70' : 'text-neutral-500')
                                            : unlocked ? 'text-[#0069FF]'
                                            : upcoming ? 'text-white/30'
                                            : 'text-neutral-700'
                                        }`}>
                                            {day}
                                        </span>
                                        {claimed ? (
                                            <CheckCircle className={`w-2.5 h-2.5 flex-shrink-0 ${isFresh ? 'text-green-400' : 'text-neutral-500'}`} />
                                        ) : !unlocked && !upcoming ? (
                                            <Lock className="w-2.5 h-2.5 flex-shrink-0 text-neutral-700" />
                                        ) : null}
                                    </div>

                                    {/* XP */}
                                    <span className={`text-[8px] font-black leading-none ${xpCls}`}>
                                        +{xp} XP
                                    </span>

                                    {/* Special reward — one row, icon inline */}
                                    {(hasTicket || hasApes) ? (
                                        <div className={`flex items-center gap-0.5 ${rewardCls}`}>
                                            <span className="text-[7px] font-black leading-none">
                                                {hasTicket ? '+1 Free' : '+5 APE'}
                                            </span>
                                            {hasTicket
                                                ? <Ticket className="w-2 h-2 flex-shrink-0" />
                                                : <Zap className="w-2 h-2 flex-shrink-0" />
                                            }
                                        </div>
                                    ) : (
                                        <div className="h-[10px]" />
                                    )}
                                </div>

                                {/* Claim button below the card, full width */}
                                {canClaimDay && (
                                    <button
                                        onClick={() => claimStreak(day)}
                                        onMouseEnter={playHover}
                                        disabled={!!claiming}
                                        className="w-full py-1 rounded-lg text-[7px] font-black uppercase bg-[#0069FF] text-white hover:bg-[#0055CC] transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center"
                                    >
                                        {claiming ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : 'Claim'}
                                    </button>
                                )}
                            </div>
                        )
                    })}
                </div>

                <p className="text-[8px] text-white/20 font-mono leading-none px-0.5">
                    Active days this week (Wed–Wed UTC)
                </p>
            </div>

            {/* ══ Daily & Weekly Activity Quests ══════════════════════════════ */}
            {(['daily', 'weekly'] as const).map(period => {
                const quests = QUEST_META.filter(q => q.period === period)
                const label  = period === 'daily' ? 'Daily Activity' : 'Weekly Activity'
                return (
                    <div key={period} className="flex flex-col gap-2">
                        <span className="text-sm font-black text-white uppercase tracking-wide">{label}</span>

                        {activityLoading ? (
                            <div className="flex flex-col gap-1.5 animate-pulse">
                                {quests.map(q => <div key={q.key} className="h-[68px] rounded-xl bg-white/[0.03]" />)}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-1.5">
                                {[...quests].sort((a, b) => {
                                    const aClaimed = activity[a.key].claimed ? 1 : 0
                                    const bClaimed = activity[b.key].claimed ? 1 : 0
                                    return aClaimed - bClaimed
                                }).map(({ key, label: qLabel, required, xp, bonus }) => {
                                    const state    = activity[key]
                                    const progress = Math.min(state.count, required)
                                    const ready    = progress >= required && !state.claimed
                                    const claiming = activityClaiming === key
                                    const qErr     = activityMsg?.quest === key ? activityMsg : null
                                    const isFresh  = freshClaimed.has(key)

                                    if (state.claimed) return (
                                        <div key={key} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.015] border border-white/[0.04]">
                                            <Gamepad2 className="w-3 h-3 flex-shrink-0 text-white/15" />
                                            <span className="text-[10px] font-bold flex-1 leading-none text-white/20">{qLabel}</span>
                                            <span className={`text-[10px] font-black flex items-center gap-1 transition-colors duration-700 ${isFresh ? 'text-green-400' : 'text-white/20'}`}>
                                                {isFresh && <CheckCircle className="w-3 h-3" />}
                                                +{xp} XP
                                                {bonus && (
                                                    <span className="font-bold">
                                                        <span className="text-white/15">· </span>
                                                        <span className={bonus.includes('Ticket') ? 'text-orange-400/40' : 'text-white/15'}>{bonus}</span>
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    )

                                    return (
                                        <div
                                            key={key}
                                            className={`flex flex-col gap-2 px-3 py-2.5 rounded-xl border transition-colors ${
                                                ready ? 'bg-[#0069FF]/5 border-[#0069FF]/20' : 'bg-white/[0.02] border-white/[0.04]'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <Gamepad2 className={`w-3.5 h-3.5 flex-shrink-0 ${ready ? 'text-[#0069FF]/70' : 'text-white/20'}`} />
                                                <span className="text-[10px] font-bold flex-1 leading-none text-white/60">{qLabel}</span>
                                                <span className={`text-[9px] font-mono font-bold ${ready ? 'text-[#0069FF]' : 'text-white/30'}`}>
                                                    {progress}/{required}
                                                </span>
                                            </div>

                                            <div className="h-[3px] rounded-full bg-white/5 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-[#0069FF] transition-all duration-500"
                                                    style={{ width: `${(progress / required) * 100}%` }}
                                                />
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className={`text-[11px] font-black tracking-tight ${ready ? 'text-[#0069FF]' : 'text-white/35'}`}>
                                                        +{xp} XP
                                                    </span>
                                                    {bonus && (
                                                        <span className={`text-[9px] font-black ${
                                                            ready
                                                                ? (bonus.includes('Ticket') ? 'text-orange-400' : 'text-[#3b82f6]')
                                                                : 'text-white/20'
                                                        }`}>
                                                            {bonus}
                                                        </span>
                                                    )}
                                                </div>
                                                {ready ? (
                                                    <button
                                                        onClick={() => claimActivity(key)}
                                                        onMouseEnter={playHover}
                                                        disabled={!!claiming}
                                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-[#0069FF] text-white cursor-pointer hover:bg-[#0055CC] transition-all"
                                                    >
                                                        {claiming ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Claim'}
                                                    </button>
                                                ) : key.startsWith('cards') ? (
                                                    <Link
                                                        href="/glitch_games/cards"
                                                        onMouseEnter={playHover}
                                                        onClick={playClick}
                                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70 border border-white/[0.08] transition-all"
                                                    >
                                                        Play Cards
                                                        <ArrowUpRight className="w-2.5 h-2.5" />
                                                    </Link>
                                                ) : (
                                                    /* Flight временно закрыт для публики — квест остаётся для учёта XP */
                                                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-white/5 text-white/25 border border-white/[0.08] select-none">
                                                        Paused
                                                    </span>
                                                )}
                                            </div>

                                            {qErr && (
                                                <div className="flex items-center gap-1.5 text-[9px] font-medium text-red-400">
                                                    <AlertCircle className="w-3 h-3" />
                                                    {qErr.text}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
