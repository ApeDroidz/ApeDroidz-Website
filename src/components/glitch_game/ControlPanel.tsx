"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, CheckCircle, AlertCircle, Clock, Shield, ShoppingCart, Zap, Square, CheckSquare, ExternalLink, Timer, Ticket, CalendarCheck } from "lucide-react"
import { fadeUp } from "@/lib/animations"
import { supabase } from "@/lib/supabase"
import { useSendTransaction } from "thirdweb/react"
import { prepareTransaction, toWei } from "thirdweb"
import { client, apeChain } from "@/lib/thirdweb"

// --- TYPES ---
interface ControlPanelProps {
    wallet: string | undefined
    balance: number
    isHolder: boolean
    xHandle: string | null
    onBalanceUpdate: (newBalance: number) => void
    onRefetch: () => void
}

interface ActiveTask {
    id: number
    tweet_url: string
    title?: string
    active_to: string
}

// --- PACK OPTIONS ---
const PACKS = [
    { size: 1, label: "1 Ticket" },
    { size: 5, label: "5 Tickets" },
    { size: 10, label: "10 Tickets" },
    { size: 20, label: "20 Tickets" },
    { size: 50, label: "50 Tickets" },
    { size: 100, label: "100 Tickets" },
]

const TICKET_PRICE_APE = 2 // 2 APE per ticket
const RECIPIENT_WALLET = "0x1DcF1d22A1dbDd20AE875beDEEe3A259b1D608db"

export function ControlPanel({
    wallet,
    balance,
    isHolder,
    xHandle,
    onBalanceUpdate,
    onRefetch,
}: ControlPanelProps) {
    // --- DAILY STATE ---
    const [activeTask, setActiveTask] = useState<ActiveTask | null>(null)
    const [alreadyClaimed, setAlreadyClaimed] = useState(false)
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
            const res = await fetch("/api/glitch_game/daily", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    wallet,
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
        } catch (err: any) {
            setDailyMsg({ type: "error", text: err.message })
        } finally {
            setIsVerifying(false)
        }
    }

    const handleSaveX = async () => {
        if (!wallet || !tempXHandle.trim()) return
        setIsSavingX(true)

        let clean = tempXHandle.trim()
        if (!clean.startsWith('@')) clean = '@' + clean

        try {
            // Use API to bypass RLS
            const res = await fetch('/api/user/update-x', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet, xHandle: clean })
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

            // 4. Verify on server
            const res = await fetch("/api/glitch_game/buy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet, txHash, packSize: selectedPack }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Verification failed")

            onBalanceUpdate(data.newBalance)
            setBuyMsg({ type: "success", text: `+${selectedPack} tickets added!` })
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

    const canClaim = isHolder && !alreadyClaimed && activeTask && proofLink.trim().length > 5 && hasLiked && hasRetweeted

    return (
        <div className="w-full lg:w-[30%] flex flex-col gap-6 p-4 sm:p-6 border-l-0 lg:border-l border-white/[0.06]">

            {/* === BALANCE === */}
            <motion.div
                className="flex items-center gap-3 px-5 py-4 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md"
                variants={fadeUp}
                initial="hidden"
                animate="show"
            >
                <div className="flex items-center gap-2">
                    <Ticket className="w-4 h-4 text-[#0069FF]" />
                    <span className="text-sm font-bold tracking-wider text-white uppercase">TOTAL TICKETS:</span>
                </div>
                <span className="font-mono text-xl font-bold text-white/90 leading-none">{balance}</span>
            </motion.div>

            {/* === DAILY FREE TICKET (Holders Only) === */}
            <motion.div
                className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden flex flex-col relative group"
                variants={fadeUp}
                initial="hidden"
                animate="show"
            >
                {/* Tooltip for Non-Holders */}
                {!isHolder && wallet && (
                    <div className="absolute inset-x-0 -top-10 hidden group-hover:flex justify-center z-50 pointer-events-none">
                        <div className="bg-black/90 backdrop-blur-md text-white/90 text-[10px] font-bold uppercase tracking-wider px-3 py-2 rounded-lg border border-white/20 shadow-xl">
                            Exclusive to ApeDroidz Holders
                        </div>
                    </div>
                )}

                <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
                    <CalendarCheck className={`w-4 h-4 ${!isHolder ? "text-white/20" : "text-[#0069FF]"}`} />
                    <span className={`text-sm font-bold tracking-wider uppercase ${!isHolder ? "text-white/30" : "text-white/90"}`}>
                        Free Daily Ticket <span className="text-white/30">(Holders Only)</span>
                    </span>
                </div>

                <div className={`p-5 space-y-4 transition-all duration-300 ${!isHolder && wallet ? "opacity-30 grayscale pointer-events-none select-none" : ""}`}>
                    {!wallet ? (
                        <p className="text-xs font-medium text-white/40 text-center py-2">Connect wallet to access daily rewards.</p>

                    ) : isLoading ? (
                        /* ── SKELETON LOADING ── */
                        <div className="space-y-3 animate-pulse">
                            <div className="h-6 w-3/4 bg-white/[0.05] rounded-md" />
                            <div className="h-4 w-full bg-white/[0.05] rounded-md" />
                            <div className="h-4 w-2/3 bg-white/[0.05] rounded-md" />
                            <div className="flex gap-2 pt-2">
                                <div className="h-9 w-20 bg-white/[0.05] rounded-md" />
                                <div className="h-9 w-20 bg-white/[0.05] rounded-md" />
                                <div className="h-9 flex-1 bg-white/[0.05] rounded-md" />
                            </div>
                        </div>

                    ) : alreadyClaimed && activeTask ? (
                        /* ── CLAIMED STATE ── */
                        <div className="flex flex-col items-center justify-center gap-2 py-6 bg-white/[0.03] rounded-xl border border-white/5 relative overflow-hidden">
                            <div className="flex items-center gap-2 mb-4">
                                <CheckCircle className="w-5 h-5 text-white/40" />
                                <span className="text-sm font-black text-white/40 uppercase tracking-widest">Mission Completed</span>
                            </div>
                            <div className="flex flex-col items-center gap-1">
                                <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Next Mission In</span>
                                <span className="font-mono text-2xl text-white/80 font-bold tracking-widest">{taskCountdown || "--:--:--"}</span>
                            </div>
                            <div className="absolute inset-0 bg-gradient-to-t from-blue-500/10 to-transparent pointer-events-none" />
                        </div>

                    ) : !activeTask ? (
                        <p className="text-xs text-white/30 text-center py-2">No active missions available.</p>

                    ) : (
                        /* ── ACTIVE TASK UI ── */
                        <>
                            <div className="relative">
                                {/* Title & Link */}
                                <div className="flex items-center gap-2 mb-2 pr-20">
                                    <a
                                        href={activeTask.tweet_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm font-bold text-white/90 uppercase tracking-wide leading-tight hover:text-[#0069FF] transition-colors flex items-center gap-2 group/link"
                                    >
                                        {activeTask.title || "Daily Mission"}
                                        <ExternalLink className="w-3.5 h-3.5 text-white/30 group-hover/link:text-[#0069FF]" />
                                    </a>
                                </div>

                                {/* Timer (Top Right) */}
                                <div className="absolute -top-1 right-0 flex items-center gap-1.5 px-2 py-1 rounded bg-white/[0.05] border border-white/5 text-[10px] font-mono text-white/40">
                                    <Timer className="w-3 h-3" />
                                    <span>{taskCountdown}</span>
                                </div>

                                <p className="text-xs text-white/60 font-medium leading-relaxed mb-4">
                                    Engage with our latest post to earn a free game.
                                </p>

                                {/* ACTION ROW: Like | RT | Input */}
                                <div className="flex items-center gap-3">
                                    {/* Like */}
                                    <button
                                        onClick={() => setHasLiked(!hasLiked)}
                                        className="flex items-center gap-2 px-3 h-10 rounded-xl bg-black/20 hover:bg-black/40 border border-white/10 transition-all cursor-pointer group/btn"
                                    >
                                        {hasLiked ? <CheckSquare className="w-4 h-4 text-green-400" /> : <Square className="w-4 h-4 text-white/30 group-hover/btn:text-white/60" />}
                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${hasLiked ? "text-green-400" : "text-white/50"}`}>Like</span>
                                    </button>

                                    {/* RT */}
                                    <button
                                        onClick={() => setHasRetweeted(!hasRetweeted)}
                                        className="flex items-center gap-2 px-3 h-10 rounded-xl bg-black/20 hover:bg-black/40 border border-white/10 transition-all cursor-pointer group/btn"
                                    >
                                        {hasRetweeted ? <CheckSquare className="w-4 h-4 text-green-400" /> : <Square className="w-4 h-4 text-white/30 group-hover/btn:text-white/60" />}
                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${hasRetweeted ? "text-green-400" : "text-white/50"}`}>RT</span>
                                    </button>

                                    {/* Link Input */}
                                    <input
                                        type="url"
                                        placeholder="Link to comment..."
                                        value={proofLink}
                                        onChange={e => { setProofLink(e.target.value); setDailyMsg(null) }}
                                        disabled={isVerifying}
                                        className="flex-1 h-10 px-3 rounded-xl bg-black/20 border border-white/10 text-white/90
                                     text-[11px] font-medium placeholder:text-white/20 focus:outline-none focus:border-white/30
                                     transition-all disabled:opacity-50 min-w-0"
                                    />
                                </div>
                            </div>

                            {/* Verify button OR Inline X Input */}
                            {isLinkingX ? (
                                <div className="w-full flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#0069FF]/10 border border-[#0069FF]/30">
                                        <AlertCircle className="w-3 h-3 text-[#0069FF]" />
                                        <span className="text-[10px] font-bold text-[#0069FF] uppercase tracking-wide">Link X to Verify</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="@username"
                                            value={tempXHandle}
                                            onChange={e => setTempXHandle(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleSaveX()}
                                            className="flex-1 h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-white font-bold text-xs focus:outline-none focus:border-[#0069FF] transition-all placeholder:text-white/20"
                                        />
                                        <button
                                            onClick={handleSaveX}
                                            disabled={!tempXHandle.trim() || isSavingX}
                                            className="px-4 h-10 bg-[#0069FF] hover:bg-[#0055CC] text-white rounded-xl flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isSavingX ? <Loader2 className="w-4 h-4 animate-spin" /> : <div className="text-[10px] font-black uppercase tracking-wider">Save</div>}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={handleClaim}
                                    disabled={!canClaim || isVerifying}
                                    className={`w-full h-11 rounded-xl text-[10px] font-black tracking-[0.15em] uppercase
                  border transition-all duration-300 flex items-center justify-center gap-2
                  ${canClaim && !isVerifying
                                            ? "bg-[#0069FF] border-[#0069FF] text-white hover:bg-[#0055CC] shadow-lg shadow-blue-900/20 cursor-pointer"
                                            : "bg-white/5 border-white/10 text-white/20 cursor-not-allowed"
                                        }`}
                                >
                                    {isVerifying ? (
                                        <>
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            VERIFYING...
                                        </>
                                    ) : "VERIFY & CLAIM"}
                                </button>
                            )}

                            {/* Message */}
                            <AnimatePresence>
                                {dailyMsg && (
                                    <motion.div
                                        className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-medium ${dailyMsg.type === "success"
                                            ? "bg-green-500/10 border border-green-500/20 text-green-400"
                                            : "bg-red-500/10 border border-red-500/20 text-red-400"
                                            }`}
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                    >
                                        {dailyMsg.type === "success"
                                            ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
                                            : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                                        {dailyMsg.text}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </>
                    )}
                </div>
            </motion.div>

            {/* === BUY GAME TICKETS === */}
            <motion.div
                className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden flex flex-col"
                variants={fadeUp}
                initial="hidden"
                animate="show"
            >
                <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-orange-400/80" />
                    <span className="text-sm font-bold tracking-wider text-white/90 uppercase">Buy Glitch Tickets</span>
                </div>

                <div className="p-5 flex flex-col gap-4">
                    <div className="grid grid-cols-3 gap-3">
                        {PACKS.map(pack => (
                            <button
                                key={pack.size}
                                onClick={() => setSelectedPack(selectedPack === pack.size ? null : pack.size)}
                                disabled={!wallet || buyingPack !== null}
                                className={`h-[60px] rounded-xl border flex flex-col items-center justify-center gap-1 transition-all duration-200
                  ${selectedPack === pack.size
                                        ? "bg-white/15 border-white/40 text-white scale-[1.02] shadow-lg shadow-white/5"
                                        : wallet && buyingPack === null
                                            ? "bg-white/[0.03] border-white/10 text-white/60 hover:bg-white/10 hover:border-white/30 hover:text-white cursor-pointer hover:scale-[1.02]"
                                            : "bg-white/[0.01] border-white/5 text-white/10 cursor-not-allowed"
                                    }`}
                            >
                                {buyingPack === pack.size ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                                ) : (
                                    <>
                                        <Zap className={`w-3.5 h-3.5 ${selectedPack === pack.size ? "text-orange-400" : wallet ? "text-orange-400/70" : "opacity-20"}`} />
                                        <span className="text-[10px] font-bold tracking-wider uppercase">{pack.label}</span>
                                    </>
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
                            onClick={handleBuy}
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
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    {buyMsg?.text === "Verifying transaction..." ? "VERIFYING..." : "SENDING..."}
                                </>
                            ) : "BUY TICKETS"}
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
            </motion.div>
        </div>
    )
}
