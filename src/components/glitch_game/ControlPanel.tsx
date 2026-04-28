"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { CheckCircle, AlertCircle, Loader2, Ticket, Shield, ExternalLink, Timer, CheckSquare, Square, X, Share2, Trophy } from "lucide-react"
import { S2LeaderboardPanel } from "./S2LeaderboardPanel"
import { useUserProgress } from "@/hooks/useUserProgress"
import { timeAgo } from "@/lib/utils"
import { fadeUp } from "@/lib/animations"
import { supabase } from "@/lib/supabase"
import { useSendTransaction } from "thirdweb/react"
import { prepareTransaction, toWei } from "thirdweb"
import { client, apeChain } from "@/lib/thirdweb"
import { GlitchWinShareModal } from "./GlitchWinShareModal"
import { useGlitchSession } from "@/hooks/useGlitchSession"

// --- TYPES ---
export interface ControlPanelProps {
    wallet: string | undefined
    balance: number
    isHolder: boolean
    xHandle: string | null
    onBalanceUpdate: (newBalance: number) => void
    onRefetch: () => void
    isFetchingState?: boolean
}

export interface ActiveTask {
    id: number
    tweet_url: string
    title?: string
    active_to: string
}

export interface HistoryLog {
    id: number
    wallet: string
    prizeName: string
    prizeType: string
    imageUrl: string
    nftTokenId: string | null
    nftContractAddress: string | null
    txHash: string
    createdAt: string
    xpAwarded: number
}

export interface TopWinnerPrize {
    name: string
    image_url: string
    drop_chance: number
    won_at: string
    contract_address: string
    token_id: string
}

export interface TopWinner {
    wallet: string
    rank: number
    score: number
    total_ape: number
    prizes: TopWinnerPrize[]
    total_prizes: number
    standard_battery_count: number
    standard_battery_sample: { contract_address: string; token_id: string } | null
}

// --- PACK OPTIONS ---
const PACKS = [
    { size: 1, label: "1 Game" },
    { size: 5, label: "5 Games" },
    { size: 10, label: "10 Games" },
    { size: 20, label: "20 Games" },
    { size: 50, label: "50 Games" },
    { size: 100, label: "100 Games" },
]

const TICKET_PRICE_APE = 2 // 2 APE per ticket
const RECIPIENT_WALLET = "0x1DcF1d22A1dbDd20AE875beDEEe3A259b1D608db"

// --- ICONS ---
function CoolTicketIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <path d="M21 9V6C21 4.89543 20.1046 4 19 4H5C3.89543 4 3 4.89543 3 6V9C4.10457 9 5 9.89543 5 11C5 12.1046 4.10457 13 3 13V16C3 17.1046 3.89543 18 5 18H19C20.1046 18 21 17.1046 21 16V13C19.8954 13 19 12.1046 19 11C19 9.89543 19.8954 9 21 9Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 12H10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 4V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 2" />
        </svg>
    )
}

export function ControlPanel({
    wallet,
    balance,
    isHolder,
    xHandle,
    onBalanceUpdate,
    onRefetch,
    isFetchingState
}: ControlPanelProps) {
    // Session — required before mutating endpoints (daily/buy/update-x)
    const { ensureLogin } = useGlitchSession()

    // Sound helper
    const playSound = (type: "hover" | "pick") => {
        const file = type === "hover" ? "/sounds/fx/ui_hover_buttons.mp3" : "/sounds/fx/crd_pick_sound.mp3"
        const vol = type === "hover" ? 0.2 : 0.7

        const audio = new Audio(file)
        audio.volume = vol
        audio.play().catch(() => { })
    }
    // --- DAILY STATE ---
    const [activeTask, setActiveTask] = useState<ActiveTask | null>(null)
    const [alreadyClaimed, setAlreadyClaimed] = useState(false)

    // --- LEADERBOARD MODAL STATE ---
    const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false)
    // --- HISTORY STATE ---
    type HistoryTab = "winners" | "global" | "personal"
    const [historyTab, setHistoryTab] = useState<HistoryTab>("winners")
    const [historyData, setHistoryData] = useState<HistoryLog[]>([])
    const [isLoadingHistory, setIsLoadingHistory] = useState(false)
    const [historyPage, setHistoryPage] = useState(1)
    const [historyHasMore, setHistoryHasMore] = useState(false)
    const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false)

    // --- TOP WINNERS STATE ---
    const [topWinners, setTopWinners] = useState<TopWinner[]>([])
    const [isLoadingWinners, setIsLoadingWinners] = useState(false)
    const [winnersPage, setWinnersPage] = useState(1)
    const [winnersHasMore, setWinnersHasMore] = useState(false)
    const [isLoadingMoreWinners, setIsLoadingMoreWinners] = useState(false)
    // NFT gallery expand state per winner
    const [expandedWinners, setExpandedWinners] = useState<Set<string>>(new Set())
    // Personal history prizes panel expand state
    const [prizesExpanded, setPrizesExpanded] = useState(false)
    // Tooltip state
    const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

    // --- SHARE FROM HISTORY STATE ---
    const [shareHistoryEntry, setShareHistoryEntry] = useState<HistoryLog | null>(null)
    const [showHistoryShareModal, setShowHistoryShareModal] = useState(false)

    // ---  INFINITE SCROLL SENTINEL REFS ---
    const winnersSentinelRef = useRef<HTMLDivElement>(null)
    const historySentinelRef = useRef<HTMLDivElement>(null)

    // --- DAILY STATE ---
    const [isLoading, setIsLoading] = useState(true)
    const [taskCountdown, setTaskCountdown] = useState("")

    // Task Inputs
    const [proofLink, setProofLink] = useState("")
    const [hasLiked, setHasLiked] = useState(false)
    const [hasRetweeted, setHasRetweeted] = useState(false)

    const [dailyMsg, setDailyMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
    const [isVerifying, setIsVerifying] = useState(false)

    // --- BUY STATE ---
    const [selectedPack, setSelectedPack] = useState<number | null>(null)
    const [buyingPack, setBuyingPack] = useState<number | null>(null)
    const [buyMsg, setBuyMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
    const { mutateAsync: sendTx } = useSendTransaction()

    // --- X HANDLE LINKING ---
    const [isLinkingX, setIsLinkingX] = useState(false)
    const [tempXHandle, setTempXHandle] = useState("")
    const [isSavingX, setIsSavingX] = useState(false)

    // --- FETCH TOP WINNERS ---
    const fetchTopWinners = useCallback(async (page = 1, append = false) => {
        if (page === 1) setIsLoadingWinners(true)
        else setIsLoadingMoreWinners(true)
        try {
            const res = await fetch(`/api/glitch_game/top-winners?page=${page}`, { cache: 'no-store' })
            if (res.ok) {
                const data = await res.json()
                if (append) {
                    setTopWinners(prev => [...prev, ...(data.winners || [])])
                } else {
                    setTopWinners(data.winners || [])
                }
                setWinnersHasMore(data.hasMore || false)
                setWinnersPage(page)
            }
        } catch (err) {
            console.error("Failed to fetch top winners:", err)
        } finally {
            setIsLoadingWinners(false)
            setIsLoadingMoreWinners(false)
        }
    }, [])

    // --- FETCH HISTORY ---
    const fetchHistory = useCallback(async (page = 1, append = false, silent = false) => {
        if (historyTab === 'winners') return
        if (page === 1 && !silent) setIsLoadingHistory(true)
        else if (page > 1) setIsLoadingMoreHistory(true)
        try {
            const url = historyTab === "personal" && wallet
                ? `/api/glitch_game/history?scope=personal&wallet=${wallet}&page=${page}`
                : `/api/glitch_game/history?scope=global&page=${page}`
            const res = await fetch(url)
            if (res.ok) {
                const data = await res.json()
                if (append) {
                    setHistoryData(prev => [...prev, ...(data.history || [])])
                } else {
                    setHistoryData(data.history || [])
                }
                setHistoryHasMore(data.hasMore || false)
                setHistoryPage(page)
            }
        } catch (error) {
            console.error("Failed to fetch history:", error)
        } finally {
            setIsLoadingHistory(false)
            setIsLoadingMoreHistory(false)
        }
    }, [historyTab, wallet])

    // Load tab data: always reset and refetch when switching between global/personal
    useEffect(() => {
        if (historyTab === 'winners') {
            if (topWinners.length === 0) fetchTopWinners(1)
        } else {
            // Always clear & refetch when switching between global ↔ personal
            setHistoryData([])
            setHistoryPage(1)
            setHistoryHasMore(false)
            fetchHistory(1)
        }
    }, [historyTab])

    // Force re-fetch current tab on new game result (e.g., after playing)
    useEffect(() => {
        const handleHistoryUpdate = () => {
            // Reset and reload current tab
            if (historyTab === 'winners') {
                setTopWinners([])
                setWinnersPage(1)
                setWinnersHasMore(false)
                fetchTopWinners(1)
            } else {
                setHistoryData([])
                setHistoryPage(1)
                setHistoryHasMore(false)
                fetchHistory(1)
            }
        }
        window.addEventListener("game_history_updated", handleHistoryUpdate)
        return () => window.removeEventListener("game_history_updated", handleHistoryUpdate)
    }, [historyTab, fetchTopWinners, fetchHistory])

    // IntersectionObserver for Winners
    useEffect(() => {
        const el = winnersSentinelRef.current
        if (!el || !winnersHasMore || isLoadingMoreWinners) return
        const obs = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                fetchTopWinners(winnersPage + 1, true)
            }
        }, { threshold: 0.1 })
        obs.observe(el)
        return () => obs.disconnect()
    }, [winnersHasMore, isLoadingMoreWinners, winnersPage, fetchTopWinners])

    // IntersectionObserver for History
    useEffect(() => {
        const el = historySentinelRef.current
        if (!el || !historyHasMore || isLoadingMoreHistory) return
        const obs = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                fetchHistory(historyPage + 1, true)
            }
        }, { threshold: 0.1 })
        obs.observe(el)
        return () => obs.disconnect()
    }, [historyHasMore, isLoadingMoreHistory, historyPage, fetchHistory])

    // --- FETCH DAILY STATE (via server API to bypass RLS) ---
    const fetchDailyState = useCallback(async () => {
        if (!wallet) return

        setIsLoading(true)
        try {
            const res = await fetch(`/api/glitch_game/state?wallet=${wallet}`)
            const data = await res.json()

            setActiveTask(data.activeTask ?? null)
            setAlreadyClaimed(!!data.claimed)
        } catch (err) {
            console.error("❌ [Daily] State fetch error:", err)
        } finally {
            setIsLoading(false)
        }
    }, [wallet])

    useEffect(() => { fetchDailyState() }, [fetchDailyState])

    // --- TOP STATS (Shards & Rank) ---
    const [shards, setShards] = useState<number | null>(null)
    const [myRank, setMyRank] = useState<number>(0)
    const [isLoadingStats, setIsLoadingStats] = useState(false)

    const fetchTopStats = useCallback(async () => {
        if (!wallet) {
            setShards(null)
            setMyRank(0)
            return
        }
        setIsLoadingStats(true)
        try {
            // 1. Shards
            const res = await fetch(`/api/merge/shards-balance?wallet=${wallet}`, { cache: 'no-store' })
            if (res.ok) {
                const data = await res.json()
                setShards(data.balance || 0)
            }
            // 2. Season 1 Rank
            const s1Res = await fetch('/api/leaderboard/season1', { cache: 'no-store' })
            if (s1Res.ok) {
                const data = await s1Res.json()
                if (data.leaderboard) {
                    const rankIdx = data.leaderboard.findIndex((u: any) => u.wallet_address.toLowerCase() === wallet.toLowerCase())
                    setMyRank(rankIdx >= 0 ? rankIdx + 1 : 0)
                }
            }
        } catch (e) {
            console.error("Failed to fetch top stats", e)
        } finally {
            setIsLoadingStats(false)
        }
    }, [wallet])

    useEffect(() => {
        fetchTopStats()
        const handleShardsUpdate = () => fetchTopStats()
        window.addEventListener("user_shards_updated", handleShardsUpdate)
        return () => window.removeEventListener("user_shards_updated", handleShardsUpdate)
    }, [fetchTopStats])

    // --- TIMER LOGIC (counts down to active_to) ---
    useEffect(() => {
        if (!activeTask?.active_to) { setTaskCountdown(""); return }

        const tick = () => {
            const targetTime = new Date(activeTask.active_to).getTime()
            const diff = targetTime - Date.now()

            if (diff <= 0) {
                setTaskCountdown("00:00:00")
                return
            }

            const h = Math.floor(diff / 3600000)
            const m = Math.floor((diff % 3600000) / 60000)
            const s = Math.floor((diff % 60000) / 1000)
            setTaskCountdown(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`)
        }

        tick()
        const interval = setInterval(tick, 1000)
        return () => clearInterval(interval)
    }, [activeTask])

    // --- DAILY CLAIM ---
    const handleClaim = async () => {
        if (!wallet || isVerifying) return

        // 1. Check X Handle
        if (!xHandle || xHandle === "unknown") {
            // Show inline input instead of error
            setIsLinkingX(true)
            return
        }

        performClaim(xHandle)
    }

    const performClaim = async (handleToUse: string) => {
        setIsVerifying(true)
        setDailyMsg(null)

        // Brief verification feel
        await new Promise(r => setTimeout(r, 1000))

        // Validate Link matches Handle
        const linkMatch = proofLink.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i)
        if (linkMatch) {
            const linkUser = linkMatch[1].toLowerCase()
            const handleUser = handleToUse.replace('@', '').toLowerCase()

            if (linkUser !== handleUser) {
                setDailyMsg({ type: "error", text: `Link (@${linkUser}) doesn't match (@${handleUser})` })
                setIsVerifying(false)
                return
            }
        } else if (proofLink.length > 5) {
            // If link is long but regex failed, maybe warn? Or just allow? 
            // User wants verification. If we can't parse user, we can't verify.
            // But maybe they pasted a link to a profile? 
            // Let's enforce tweet/status regex structure if possible, but the user only gave example of status link.
            // Regex used: /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i checks for domain + username. Status part is optional in this regex.
            // So it matches profile links too.
            // If no match found, logic proceeds (assuming maybe different format?).
            // User didn't ask to Block non-x links, but implied it. 
            // "if link ... then comment of other person attached".
            // I'll fail if no match is found? No, that might be too aggressive if they use t.co or something.
            // I'll strict it to: IF we match a username, we MUST match handle.
            // If we don't match a username (e.g. t.co), we let it pass? Or better:
            // The user gave specific examples of x.com links.
            // I'll stick to: If regex matches, enforce equality.
        }

        try {
            const ok = await ensureLogin()
            if (!ok) {
                setDailyMsg({ type: "error", text: "Please sign in" })
                setIsVerifying(false)
                return
            }
            const res = await fetch("/api/glitch_game/daily", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    proofLink: proofLink.trim(),
                    xHandle: handleToUse
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Claim failed")

            setDailyMsg({ type: "success", text: "+1 Game Access!" })
            setProofLink("")
            setHasLiked(false)
            setHasRetweeted(false)
            setAlreadyClaimed(true)
            onBalanceUpdate(data.newBalance)
            fetchTopStats()
        } catch (err: any) {
            setDailyMsg({ type: "error", text: err.message })
        } finally {
            setIsVerifying(false)
        }
    }

    const handleSaveX = async () => {
        if (!wallet || !tempXHandle.trim()) return
        const ok = await ensureLogin()
        if (!ok) {
            setDailyMsg({ type: "error", text: "Please sign in" })
            return
        }
        setIsSavingX(true)

        let clean = tempXHandle.trim()
        if (!clean.startsWith('@')) clean = '@' + clean

        try {
            // Wallet identity is taken from the session cookie — body doesn't need it.
            const res = await fetch('/api/user/update-x', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ xHandle: clean })
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Failed to save")

            // Success
            onRefetch()
            setIsLinkingX(false)
            performClaim(clean)

        } catch (err: any) {
            console.error("Failed to save X handle:", err)
            setDailyMsg({ type: "error", text: err.message || "Failed to save X handle" })
        } finally {
            setIsSavingX(false)
        }
    }

    // --- BUY PACK (with real blockchain tx) ---
    const handleBuy = async () => {
        if (!wallet || !selectedPack || buyingPack !== null) return
        setBuyingPack(selectedPack)
        setBuyMsg(null)

        const totalApe = selectedPack * TICKET_PRICE_APE

        try {
            // 1. Prepare native APE transfer
            const tx = prepareTransaction({
                chain: apeChain,
                client,
                to: RECIPIENT_WALLET,
                value: toWei(String(totalApe)),
            })

            // 2. Prompt user wallet
            const result = await sendTx(tx)
            const txHash = result.transactionHash

            console.log(`💰 TX sent: ${txHash}`)
            setBuyMsg({ type: "success", text: "Verifying transaction..." })

            // 3. Wait a bit for chain confirmation
            await new Promise(r => setTimeout(r, 3000))

            // 4. Verify on server. Buy doesn't need a session cookie because
            //    on-chain `tx.from` already proves wallet ownership.
            const res = await fetch("/api/glitch_game/buy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet, txHash, packSize: selectedPack }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Verification failed")

            onBalanceUpdate(data.newBalance)
            setBuyMsg({ type: "success", text: `+${selectedPack} games added!` })
            setSelectedPack(null)

        } catch (err: any) {
            console.error("Buy error:", err)
            const msg = err.message?.includes("rejected")
                ? "Transaction rejected"
                : (err.message || "Purchase failed")
            setBuyMsg({ type: "error", text: msg })
        } finally {
            setBuyingPack(null)
        }
    }

    const canClaim = isHolder && !alreadyClaimed && activeTask && proofLink.trim().length > 5 && hasLiked && hasRetweeted;

    return (
        <div className="w-full lg:w-[30%] flex flex-col gap-6 p-4 sm:p-6 pt-16 lg:pt-[50px]"> {/* Lowered container */}

            {/* === TOP STATS === */}
            <motion.div
                className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center"
                variants={fadeUp}
                initial="hidden"
                animate="show"
            >
                {/* TICKETS */}
                <div className="flex flex-col pr-2">
                    {isFetchingState ? (
                        <Loader2 className="w-5 h-5 animate-spin text-white/30 mb-2" />
                    ) : (
                        <span className="font-mono text-[22px] font-extrabold text-white leading-none tracking-tight mb-2">{balance}</span>
                    )}
                    <span className="text-[10px] font-bold tracking-widest text-white/50 uppercase leading-none">Tickets</span>
                </div>

                <div className="w-[1px] h-10 bg-white/10" />

                {/* SHARDS */}
                <div className="flex flex-col px-4">
                    {isLoadingStats ? (
                        <Loader2 className="w-5 h-5 animate-spin text-white/30 mb-2" />
                    ) : (
                        <span className="font-mono text-[22px] font-extrabold text-white leading-none tracking-tight mb-2">{shards !== null ? shards : 0}</span>
                    )}
                    <div className="flex items-center gap-2 leading-none">
                        <span className="text-[10px] font-bold tracking-widest text-white/50 uppercase">Shards</span>
                        <a href="/merge_mechanism?tab=shards" onMouseEnter={() => playSound("hover")} className="text-[8px] text-white/30 hover:text-white uppercase font-bold tracking-widest transition-colors mb-[1px] underline decoration-white/30 hover:decoration-white underline-offset-2">Merge</a>
                    </div>
                </div>

                <div className="w-[1px] h-10 bg-white/10" />

                {/* RANK */}
                <div className="flex flex-col pl-4 text-left">
                    {isLoadingStats ? (
                        <Loader2 className="w-5 h-5 animate-spin text-white/30 mb-2" />
                    ) : (
                        <span className="font-mono text-[22px] font-extrabold text-white leading-none tracking-tight mb-2">{myRank > 0 ? `#${myRank}` : '--'}</span>
                    )}
                    <div className="flex items-center gap-2 leading-none">
                        <span className="text-[10px] font-bold tracking-widest text-white/50 uppercase">Rank</span>
                        <button onClick={() => { playSound("pick"); setIsLeaderboardOpen(true); fetchTopStats(); }} onMouseEnter={() => playSound("hover")} className="text-[8px] text-white/30 hover:text-white uppercase font-bold tracking-widest transition-colors cursor-pointer text-left mb-[1px] underline decoration-white/30 hover:decoration-white underline-offset-2">Leaderboard</button>
                    </div>
                </div>
            </motion.div>

            {/* === MAIN CONTENT CARD === */}
            <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden flex flex-col relative group">
                <div className="p-5 flex flex-col gap-4">
                    <h3 className="text-3xl font-black text-white uppercase tracking-tight text-left mt-2 mb-2">Buy Tickets</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {PACKS.map(pack => (
                            <button
                                key={pack.size}
                                onClick={() => { playSound("pick"); setSelectedPack(selectedPack === pack.size ? null : pack.size) }}
                                onMouseEnter={() => playSound("hover")}
                                disabled={!wallet || buyingPack !== null}
                                className={`h-[72px] rounded-xl border flex items-center justify-center gap-2 transition-all duration-200
                                    ${selectedPack === pack.size
                                        ? "bg-white/15 border-white/40 text-white shadow-lg shadow-white/5"
                                        : wallet && buyingPack === null
                                            ? "bg-[#111] border-white/10 text-white/80 hover:bg-[#222] hover:border-white/30 hover:text-white cursor-pointer"
                                            : "bg-black/20 border-white/5 text-white/20 cursor-not-allowed"
                                    }`}
                            >
                                {buyingPack === pack.size ? (
                                    <Loader2 className="w-6 h-6 animate-spin text-white" />
                                ) : (
                                    <div className="flex items-center gap-2 pointer-events-none">
                                        <span className="font-bold text-3xl leading-none pointer-events-none">{pack.size}</span>
                                        <Ticket className={`w-7 h-7 ${selectedPack === pack.size ? "text-orange-400" : wallet ? "text-orange-400" : "opacity-30"} pointer-events-none stroke-[2.5]`} />
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Total Price + BUY Button */}
                    <div className="pt-3 border-t border-white/5 flex items-center justify-between gap-3">
                        <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Total Price</span>
                            <span className={`text-lg font-black tracking-tight ${selectedPack ? "text-white" : "text-white/20"}`}>
                                {selectedPack ? `${selectedPack * TICKET_PRICE_APE} APE` : "0 APE"}
                            </span>
                        </div>
                        <button
                            onClick={() => { playSound("pick"); handleBuy() }}
                            onMouseEnter={() => selectedPack && wallet && buyingPack === null && playSound("hover")}
                            disabled={!selectedPack || !wallet || buyingPack !== null}
                            className={`px-6 h-11 rounded-xl text-[10px] font-black tracking-[0.15em] uppercase
                                border transition-all duration-300 flex items-center justify-center gap-2
                                ${selectedPack && wallet && buyingPack === null
                                    ? "bg-orange-500 border-orange-500 text-white hover:bg-orange-600 shadow-lg shadow-orange-900/30 cursor-pointer"
                                    : "bg-white/5 border-white/10 text-white/20 cursor-not-allowed"
                                }`}
                        >
                            {buyingPack !== null ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin pointer-events-none" />
                                    <span className="pointer-events-none">{buyMsg?.text === "Verifying transaction..." ? "VERIFYING..." : "SENDING..."}</span>
                                </>
                            ) : <span className="pointer-events-none">BUY TICKETS</span>}
                        </button>
                    </div>

                    {/* Buy Message */}
                    <AnimatePresence>
                        {buyMsg && (
                            <motion.div
                                className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-medium ${buyMsg.type === "success"
                                    ? "bg-green-500/10 border border-green-500/20 text-green-400"
                                    : "bg-red-500/10 border border-red-500/20 text-red-400"
                                    }`}
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                            >
                                {buyMsg.type === "success"
                                    ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
                                    : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                                {buyMsg.text}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* === HISTORY SECTION === */}
            <div className="flex flex-col gap-3 mt-2">
                {/* --- History Sub-Tabs --- */}
                <div className="flex items-center gap-4 px-1 border-b border-white/5 pb-2">
                    <button
                        onClick={() => { playSound("pick"); setHistoryTab("winners") }}
                        onMouseEnter={() => playSound("hover")}
                        className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest transition-colors pb-1 ${historyTab === "winners"
                            ? "text-white/50 border-b-2 border-white/40"
                            : "text-white/25 hover:text-white/45"
                            }`}
                    >
                        <Trophy className="w-3 h-3" />
                        Top Winners
                    </button>
                    <button
                        onClick={() => { playSound("pick"); setHistoryTab("global") }}
                        onMouseEnter={() => playSound("hover")}
                        className={`text-[10px] font-black uppercase tracking-widest transition-colors pb-1 ${historyTab === "global"
                            ? "text-white/50 border-b-2 border-white/40"
                            : "text-white/25 hover:text-white/45"
                            }`}
                    >
                        Recent
                    </button>
                    <button
                        onClick={() => { playSound("pick"); setHistoryTab("personal") }}
                        onMouseEnter={() => playSound("hover")}
                        className={`text-[10px] font-black uppercase tracking-widest transition-colors pb-1 ${historyTab === "personal"
                            ? "text-white/50 border-b-2 border-white/40"
                            : "text-white/25 hover:text-white/45"
                            }`}
                    >
                        Your History
                    </button>
                </div>

                {/* --- Top Winners Tab --- */}
                {historyTab === "winners" && (
                    <div className="flex flex-col gap-2 relative min-h-[150px]">
                        {/* NFT name tooltip */}
                        {tooltip && (
                            <div
                                className="fixed z-[999] pointer-events-none px-2.5 py-1.5 rounded-lg bg-black/90 backdrop-blur-sm border border-white/10 text-[10px] font-bold text-white/80 whitespace-nowrap shadow-xl"
                                style={{ left: tooltip.x + 12, top: tooltip.y - 36 }}
                            >
                                {tooltip.text}
                            </div>
                        )}
                        {isLoadingWinners ? (
                            <div className="flex flex-col gap-2 pt-1">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 animate-pulse">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-5 h-3 bg-white/10 rounded" />
                                            <div className="h-3 w-24 bg-white/10 rounded" />
                                            <div className="h-5 w-16 bg-white/5 rounded ml-auto" />
                                        </div>
                                        <div className="flex gap-1.5 pl-7">
                                            {Array.from({ length: 5 }).map((_, j) => (
                                                <div key={j} className="w-9 h-9 rounded-lg bg-white/5" />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : topWinners.length === 0 ? (
                            <div className="text-center py-6 text-[10px] font-bold tracking-widest text-white/20 uppercase">
                                No NFT winners yet
                            </div>
                        ) : (
                            <div
                                className="max-h-[320px] overflow-y-auto pr-1 custom-scrollbar flex flex-col gap-2 pb-4"
                                style={{ maskImage: "linear-gradient(to bottom, black 85%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 85%, transparent 100%)" }}
                            >
                                {topWinners.map((winner) => {
                                    const isExpanded = expandedWinners.has(winner.wallet)
                                    // Separate batteries from regular NFT prizes
                                    const isStdBattery = (p: TopWinnerPrize) => { const n = p.name.toLowerCase(); return n.includes('battery') && !n.includes('super') }
                                    const isSuperBattery = (p: TopWinnerPrize) => { const n = p.name.toLowerCase(); return n.includes('super') && n.includes('battery') }
                                    const batteryPrizes = winner.prizes.filter(p => isStdBattery(p))
                                    const superBatteryPrizes = winner.prizes.filter(p => isSuperBattery(p))
                                    const nftPrizes = winner.prizes.filter(p => p.image_url && p.contract_address && p.token_id && !isStdBattery(p) && !isSuperBattery(p))
                                    const PREVIEW_COUNT = 6
                                    const visibleNfts = isExpanded ? nftPrizes : nftPrizes.slice(0, PREVIEW_COUNT)
                                    const hasMore = nftPrizes.length > PREVIEW_COUNT

                                    return (
                                        <div
                                            key={winner.wallet}
                                            className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
                                        >
                                            {/* Rank + Wallet + APE total row */}
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] font-black w-5 flex-shrink-0 text-white/40">
                                                    #{winner.rank}
                                                </span>
                                                <a
                                                    href={`https://opensea.io/${winner.wallet}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="font-mono text-[10px] text-white/50 hover:text-white transition-colors flex items-center gap-1 group"
                                                >
                                                    {winner.wallet.slice(0, 6)}...{winner.wallet.slice(-4)}
                                                    <ExternalLink className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                </a>
                                                {winner.total_ape > 0 && (
                                                    <span className="font-black text-[11px] text-white/50 ml-auto">
                                                        {winner.total_ape} APE
                                                    </span>
                                                )}
                                                {winner.total_ape === 0 && (
                                                    <span className="ml-auto text-[9px] font-black text-white/20 uppercase tracking-wider">
                                                        {winner.total_prizes} NFT{winner.total_prizes !== 1 ? 's' : ''}
                                                    </span>
                                                )}
                                            </div>

                                            {/* NFT thumbnails gallery */}
                                            {(nftPrizes.length > 0 || batteryPrizes.length > 0 || superBatteryPrizes.length > 0) && (
                                                <div className="relative">
                                                    <div className="flex flex-wrap gap-1.5 pl-7">
                                                        {visibleNfts.map((prize, pi) => {
                                                            const openseaUrl = `https://opensea.io/item/ape_chain/${prize.contract_address}/${prize.token_id}`
                                                            return (
                                                                <a
                                                                    key={pi}
                                                                    href={openseaUrl}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onMouseEnter={(e) => setTooltip({ text: prize.name, x: e.clientX, y: e.clientY })}
                                                                    onMouseMove={(e) => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                                                                    onMouseLeave={() => setTooltip(null)}
                                                                    className="block w-9 h-9 rounded-lg overflow-hidden border border-white/10 hover:border-white/40 transition-all hover:scale-110 hover:z-10 relative flex-shrink-0 bg-white/5 group/nft"
                                                                >
                                                                    <img
                                                                        src={prize.image_url}
                                                                        alt={prize.name}
                                                                        className="w-full h-full object-cover brightness-[0.7] group-hover/nft:brightness-100 transition-[filter] duration-150"
                                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                                                    />
                                                                </a>
                                                            )
                                                        })}

                                                        {/* Super battery (rarer): 1 thumbnail + count — shown before standard */}
                                                        {superBatteryPrizes.length > 0 && superBatteryPrizes[0].image_url && (
                                                            <div
                                                                className="relative flex-shrink-0"
                                                                onMouseEnter={(e) => setTooltip({ text: `${superBatteryPrizes[0].name}${superBatteryPrizes.length > 1 ? ` ×${superBatteryPrizes.length}` : ''}`, x: e.clientX, y: e.clientY })}
                                                                onMouseMove={(e) => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                                                                onMouseLeave={() => setTooltip(null)}
                                                            >
                                                                <div className="w-9 h-9 rounded-lg overflow-hidden border border-yellow-400/20 bg-white/5">
                                                                    <img src={superBatteryPrizes[0].image_url} alt={superBatteryPrizes[0].name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                                                </div>
                                                                {superBatteryPrizes.length > 1 && (
                                                                    <span className="absolute -bottom-1 -right-1.5 bg-black/90 border border-yellow-400/20 text-[8px] font-black text-yellow-400/70 px-1 py-px rounded leading-none">
                                                                        ×{superBatteryPrizes.length}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Standard battery: 1 thumbnail + count */}
                                                        {batteryPrizes.length > 0 && batteryPrizes[0].image_url && (
                                                            <div
                                                                className="relative flex-shrink-0"
                                                                onMouseEnter={(e) => setTooltip({ text: `${batteryPrizes[0].name}${batteryPrizes.length > 1 ? ` ×${batteryPrizes.length}` : ''}`, x: e.clientX, y: e.clientY })}
                                                                onMouseMove={(e) => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                                                                onMouseLeave={() => setTooltip(null)}
                                                            >
                                                                <div className="w-9 h-9 rounded-lg overflow-hidden border border-white/10 bg-white/5">
                                                                    <img src={batteryPrizes[0].image_url} alt={batteryPrizes[0].name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                                                </div>
                                                                {batteryPrizes.length > 1 && (
                                                                    <span className="absolute -bottom-1 -right-1.5 bg-black/90 border border-white/15 text-[8px] font-black text-white/60 px-1 py-px rounded leading-none">
                                                                        ×{batteryPrizes.length}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Fade + show more */}
                                                        {!isExpanded && hasMore && (
                                                            <button
                                                                onClick={() => setExpandedWinners(new Set([winner.wallet]))}
                                                                className="w-9 h-9 rounded-lg border border-white/10 hover:border-white/30 bg-white/5 hover:bg-white/10 flex items-center justify-center text-[8px] font-black text-white/40 hover:text-white/70 transition-all flex-shrink-0 cursor-pointer"
                                                            >
                                                                +{nftPrizes.length - PREVIEW_COUNT}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {/* Subtle fade on right when collapsed */}
                                                    {!isExpanded && nftPrizes.length > 4 && (
                                                        <div className="absolute right-0 inset-y-0 w-10 pointer-events-none bg-gradient-to-l from-black/60 to-transparent rounded-r-lg" />
                                                    )}
                                                </div>
                                            )}

                                            {/* Collapse btn if expanded */}
                                            {isExpanded && hasMore && (
                                                <button
                                                    onClick={() => setExpandedWinners(prev => { const s = new Set(prev); s.delete(winner.wallet); return s })}
                                                    className="ml-7 text-[8px] font-black uppercase tracking-wider text-white/25 hover:text-white/50 transition-colors cursor-pointer text-left"
                                                >
                                                    Show less
                                                </button>
                                            )}
                                        </div>
                                    )
                                })}
                                {/* Infinite scroll sentinel */}
                                <div ref={winnersSentinelRef} className="h-1" />
                                {isLoadingMoreWinners && (
                                    <div className="flex justify-center py-2">
                                        <Loader2 className="w-4 h-4 animate-spin text-white/20" />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* --- Recent / Your History Tabs --- */}
                {(historyTab === "global" || historyTab === "personal") && (
                    <div className="flex flex-col gap-3 relative min-h-[150px]">
                        {/* Personal: prizes gallery at top */}
                        {historyTab === "personal" && !isLoadingHistory && historyData.length > 0 && (() => {
                            const personalNfts = historyData.filter(log => log.prizeType === 'nft' && log.imageUrl)
                            const PRIZE_PREVIEW = 8
                            const visiblePersonalNfts = prizesExpanded ? personalNfts : personalNfts.slice(0, PRIZE_PREVIEW)
                            const hasPrizeMore = personalNfts.length > PRIZE_PREVIEW
                            if (personalNfts.length === 0) return null
                            return (
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-white/20">Prizes Won</span>
                                        <span className="text-[9px] font-black text-white/20">{personalNfts.length}</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {visiblePersonalNfts.map((log, i) => (
                                            log.nftContractAddress && log.nftTokenId ? (
                                                <a
                                                    key={i}
                                                    href={`https://opensea.io/item/ape_chain/${log.nftContractAddress}/${log.nftTokenId}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onMouseEnter={(e) => setTooltip({ text: log.prizeName, x: e.clientX, y: e.clientY })}
                                                    onMouseMove={(e) => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                                                    onMouseLeave={() => setTooltip(null)}
                                                    className="block w-9 h-9 rounded-lg overflow-hidden border border-white/10 hover:border-white/40 transition-all hover:scale-110 flex-shrink-0 bg-black/40"
                                                >
                                                    <img src={log.imageUrl} alt={log.prizeName} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                                </a>
                                            ) : (
                                                <div
                                                    key={i}
                                                    className="w-9 h-9 rounded-lg overflow-hidden border border-white/10 flex-shrink-0 bg-black/40"
                                                    onMouseEnter={(e) => setTooltip({ text: log.prizeName, x: e.clientX, y: e.clientY })}
                                                    onMouseMove={(e) => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                                                    onMouseLeave={() => setTooltip(null)}
                                                >
                                                    <img src={log.imageUrl} alt={log.prizeName} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                                </div>
                                            )
                                        ))}
                                        {!prizesExpanded && hasPrizeMore && (
                                            <button
                                                onClick={() => setPrizesExpanded(true)}
                                                className="w-9 h-9 rounded-lg border border-white/10 hover:border-white/30 bg-white/5 hover:bg-white/10 flex items-center justify-center text-[8px] font-black text-white/40 hover:text-white/70 transition-all flex-shrink-0 cursor-pointer"
                                            >
                                                +{personalNfts.length - PRIZE_PREVIEW}
                                            </button>
                                        )}
                                    </div>
                                    {prizesExpanded && hasPrizeMore && (
                                        <button
                                            onClick={() => setPrizesExpanded(false)}
                                            className="text-[8px] font-black uppercase tracking-wider text-white/25 hover:text-white/50 transition-colors cursor-pointer text-left px-1"
                                        >
                                            Show less
                                        </button>
                                    )}
                                    <div className="h-px bg-white/5 mt-1" />
                                </div>
                            )
                        })()}

                        {isLoadingHistory ? (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="w-5 h-5 animate-spin text-white/30" />
                            </div>
                        ) : historyData.length === 0 ? (
                            <div className="text-center py-6 text-[10px] font-bold tracking-widest text-white/20 uppercase">
                                {historyTab === "personal" ? "No games played yet" : "No history found"}
                            </div>
                        ) : (
                            <>
                                {historyTab === "personal" && (
                                    <span className="text-[9px] font-black uppercase tracking-widest text-white/20 px-1">Game History</span>
                                )}
                                <div
                                    className="max-h-[220px] overflow-y-auto pr-1 custom-scrollbar flex flex-col gap-1.5 pb-4"
                                    style={{ maskImage: "linear-gradient(to bottom, black 80%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 80%, transparent 100%)" }}
                                >
                                    <AnimatePresence>
                                        {historyData.map((log) => (
                                            <motion.div
                                                key={log.id}
                                                initial={{ opacity: 0, y: 5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="flex items-center text-[11px] bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2 gap-2"
                                            >
                                                {/* NFT thumbnail (if it's an NFT prize) */}
                                                {log.prizeType === 'nft' && log.imageUrl && (
                                                    <div className="flex-shrink-0 w-8 h-8 rounded-md overflow-hidden border border-white/10 bg-black/40">
                                                        <img src={log.imageUrl} alt={log.prizeName} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                                    </div>
                                                )}

                                                {/* Prize name */}
                                                <div className="flex flex-col min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5 min-w-0">
                                                        {log.prizeType === 'nft' && log.nftContractAddress && log.nftTokenId ? (
                                                            <a
                                                                href={`https://opensea.io/item/ape_chain/${log.nftContractAddress}/${log.nftTokenId}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="font-bold text-white/80 hover:text-white truncate transition-colors flex items-center gap-1 group/nft"
                                                            >
                                                                <span className="truncate">{log.prizeName}</span>
                                                                <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-0 group-hover/nft:opacity-100 transition-opacity" />
                                                            </a>
                                                        ) : (
                                                            <span className="font-bold text-white/60 truncate">{log.prizeName}</span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Wallet (global only) */}
                                                {historyTab === "global" && (
                                                    <a
                                                        href={`https://opensea.io/${log.wallet}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="font-mono text-[10px] text-white/30 hover:text-white/60 transition-colors flex-shrink-0 flex items-center gap-0.5 group"
                                                    >
                                                        {log.wallet.slice(0, 6)}...{log.wallet.slice(-4)}
                                                    </a>
                                                )}

                                                {/* Time */}
                                                {historyTab === "global" ? (
                                                    <a
                                                        href={`https://apechain.calderaexplorer.xyz/tx/${log.txHash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-white/25 hover:text-orange-400 font-bold transition-colors whitespace-nowrap flex items-center gap-1 group flex-shrink-0 text-[10px]"
                                                    >
                                                        {timeAgo(log.createdAt)}
                                                        <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    </a>
                                                ) : (
                                                    <span className="text-white/30 font-bold whitespace-nowrap flex-shrink-0 text-[10px]">
                                                        {timeAgo(log.createdAt)}
                                                    </span>
                                                )}

                                                {/* Share button (personal only) */}
                                                {historyTab === "personal" && (
                                                    <button
                                                        onClick={() => {
                                                            playSound("pick")
                                                            setShareHistoryEntry(log)
                                                            setShowHistoryShareModal(true)
                                                        }}
                                                        onMouseEnter={() => playSound("hover")}
                                                        className="flex-shrink-0 p-1.5 rounded-lg bg-white/5 hover:bg-[#0069FF]/20 border border-white/10 hover:border-[#0069FF]/40 text-white/30 hover:text-[#0069FF] transition-all cursor-pointer"
                                                        title="Share this win"
                                                    >
                                                        <Share2 className="w-3 h-3" />
                                                    </button>
                                                )}
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                    {/* Infinite scroll sentinel */}
                                    <div ref={historySentinelRef} className="h-1" />
                                    {isLoadingMoreHistory && (
                                        <div className="flex justify-center py-2">
                                            <Loader2 className="w-4 h-4 animate-spin text-white/20" />
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* === HISTORY SHARE MODAL === */}
            {shareHistoryEntry && (
                <GlitchWinShareModal
                    isOpen={showHistoryShareModal}
                    onClose={() => { setShowHistoryShareModal(false); setShareHistoryEntry(null) }}
                    wonPrize={{
                        id: String(shareHistoryEntry.id),
                        type: shareHistoryEntry.prizeType,
                        name: shareHistoryEntry.prizeName,
                        imageUrl: shareHistoryEntry.imageUrl,
                        amount: 1,
                        nftTokenId: shareHistoryEntry.nftTokenId,
                    }}
                    xpGained={shareHistoryEntry.xpAwarded || 0}
                    shardsGained={0}
                    currentXp={0}
                    xpBefore={{ level: 1, progress: 0, nextMilestone: 1000 }}
                    xpAfter={{ level: 1, progress: 0, nextMilestone: 1000 }}
                />
            )}

            {/* === SEASON 2 LEADERBOARD MODAL === */}
            <AnimatePresence>
                {isLeaderboardOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                            onClick={() => setIsLeaderboardOpen(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-lg bg-black/80 backdrop-blur-3xl border border-white/10 rounded-[40px] shadow-2xl overflow-hidden flex flex-col h-[80vh] max-h-[700px]"
                        >
                            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/5 bg-white/[0.02] shrink-0">
                                <span className="text-xs font-black uppercase tracking-[0.2em] text-white/40">Season 2 Leaderboard</span>
                                <button
                                    onClick={() => setIsLeaderboardOpen(false)}
                                    className="p-2.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-full transition-all"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="flex-1 min-h-0 p-4">
                                <S2LeaderboardPanel wallet={wallet} />
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
            `}</style>
        </div>
    )
}
