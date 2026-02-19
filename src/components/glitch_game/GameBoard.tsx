"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Sparkles, X, Gem, Zap } from "lucide-react"

/* ─── Supabase storage base for card images ─── */
const STORAGE_BASE = "https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public"

function cardImageUrl(raw: string | null | undefined): string {
    if (!raw) return ""
    if (raw.startsWith("http")) return raw          // already absolute
    return `${STORAGE_BASE}${raw}`                   // e.g. /assets/cards/aba.png → full URL
}

/* ─── Types ─── */
interface PrizeType {
    id: string
    name: string
    type: string        // "nft" | "token" | "shard"
    image_url: string
    xp_reward: number
    drop_chance: number
}

interface PrizeResult {
    typeSlug: string
    category: string
    label: string
    imageUrl: string
    nftTokenId: string | null
}

interface GameBoardProps {
    balance: number
    wallet: string | undefined
    onPlayComplete: (newBalance: number) => void
    onRefetch: () => void
}

type Phase = "loading" | "idle" | "glitching" | "result"

/* ─── Fisher-Yates shuffle ─── */
function shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
            ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

/* ════════════════════════════════════════════
   GAME BOARD  —  self-contained component
   ════════════════════════════════════════════ */
export function GameBoard({ balance, wallet, onPlayComplete, onRefetch }: GameBoardProps) {
    const [phase, setPhase] = useState<Phase>("loading")
    const [prizes, setPrizes] = useState<PrizeType[]>([])
    const [displayCards, setDisplayCards] = useState<PrizeType[]>([])
    const [dealt, setDealt] = useState(false)

    // Result state
    const [wonPrize, setWonPrize] = useState<PrizeResult | null>(null)
    const [xpGained, setXpGained] = useState(0)
    const [shardsGained, setShardsGained] = useState(0)
    const [txHash, setTxHash] = useState<string | null>(null)
    const [winnerIdx, setWinnerIdx] = useState<number | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [showModal, setShowModal] = useState(false)

    /* ── 1. Fetch prizes on mount ── */
    useEffect(() => {
        ; (async () => {
            try {
                const res = await fetch("/api/glitch_game/prizes")
                const { prizes: p } = await res.json()
                if (p?.length) {
                    setPrizes(p)
                    buildDeck(p)
                }
            } catch (e) { console.error("Prize fetch failed", e) }
        })()
    }, [])

    /* ── Build 12-card deck from available prizes ── */
    const buildDeck = (src: PrizeType[]) => {
        if (src.length === 0) return

        let deck = [...src]

        // 1. Shuffle the full pool of active prizes first so we get a random selection
        deck = shuffle(deck)

        // 2. If fewer than 15, repeat the shuffled pool until we have enough
        while (deck.length < 15) {
            deck = [...deck, ...shuffle([...src])]
        }

        // 3. Take exactly 15 cards for the board
        deck = deck.slice(0, 15)

        setDisplayCards(deck)

        // Show board immediately to trigger enter animation
        setPhase("idle")

        // Mark as dealt AFTER animation completes so subsequent re-renders don't re-fly
        setTimeout(() => {
            setDealt(true)
        }, 15 * 100 + 500) // 15 cards * 100ms stagger + 500ms duration
    }

    /* ── PLAY handler ── */
    const handlePlay = async () => {
        if (phase !== "idle" || balance < 1 || !wallet) return
        setError(null)
        setPhase("glitching")
        setWinnerIdx(null)

        try {
            const res = await fetch("/api/glitch_game/play", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Play failed")

            // Let glitch animation play for 2s
            await new Promise(r => setTimeout(r, 2000))

            // Find matching card to highlight
            const idx = displayCards.findIndex(c => c.id === data.prize.typeSlug)
            setWinnerIdx(idx >= 0 ? idx : 0)

            setWonPrize(data.prize)
            setXpGained(data.xp_gained || 0)
            setShardsGained(data.shards_gained || 0)
            setTxHash(data.tx_hash || null)
            onPlayComplete(data.newBalance)

            setPhase("result")
            setTimeout(() => setShowModal(true), 600)
        } catch (err: any) {
            console.error(err)
            setError(err.message)
            setPhase("idle")
        }
    }

    /* ── Reset ── */
    const resetGame = () => {
        setPhase("idle")
        setWonPrize(null)
        setXpGained(0)
        setShardsGained(0)
        setTxHash(null)
        setWinnerIdx(null)
        setShowModal(false)
        setError(null)
        onRefetch()
        setDisplayCards(prev => shuffle(prev))
    }

    /* ══════════  RENDER  ══════════ */
    return (
        <div className="flex-1 flex flex-col items-center w-full relative px-4 sm:px-6 pt-2">

            {/* ── HEADER ── */}
            <div className="w-full flex flex-col items-center mb-8 sm:mb-10">
                <motion.h1
                    className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter text-white text-center uppercase italic drop-shadow-[0_0_12px_rgba(255,255,255,0.35)] leading-none"
                    initial={{ opacity: 0, y: -15 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    Glitch Game
                </motion.h1>
                <motion.p
                    className="font-bold text-[8px] sm:text-[10px] text-white/40 tracking-[0.3em] sm:tracking-[0.5em] text-center uppercase mt-1.5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.15 }}
                >
                    Decrypt the mainframe &amp; Win Rewards
                </motion.p>
            </div>

            {/* ── Error message ── */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        className="mb-3 px-5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-[10px] uppercase tracking-wider backdrop-blur-md"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                    >
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Loading spinner ── */}
            {phase === "loading" && (
                <div className="flex-1 flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 text-[#0069FF] animate-spin" />
                </div>
            )}

            {/* ────────────────────────────
                CARD GRID  (5 cols × 3 rows)
               ──────────────────────────── */}
            {phase !== "loading" && (
                <div className="w-full max-w-4xl mx-auto">
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
                        {displayCards.map((card, i) => {
                            const isWinner = winnerIdx === i && phase === "result"
                            const isGlitch = phase === "glitching"
                            const dimmed = phase === "result" && winnerIdx !== i
                            const flyDelay = dealt ? 0 : i * 0.1

                            return (
                                <motion.div
                                    key={`${card.id}-${i}`}
                                    /* ── Fly-in from bottom, like dealing cards ── */
                                    initial={{ opacity: 0, y: 350, scale: 0.55, rotateZ: -12 }}
                                    animate={{
                                        opacity: dimmed ? 0.25 : 1,
                                        y: 0,
                                        scale: isWinner ? 1.06 : 1,
                                        rotateZ: 0,
                                        /* Glitch shake */
                                        filter: isGlitch
                                            ? ["blur(0px)", "blur(3px)", "blur(0px)"]
                                            : "blur(0px)",
                                        x: isGlitch ? [0, -3, 4, -4, 3, 0] : 0,
                                    }}
                                    transition={{
                                        opacity: { delay: flyDelay, duration: 0.35 },
                                        y: { delay: flyDelay, duration: 0.5, type: "spring", stiffness: 130, damping: 14 },
                                        scale: { delay: flyDelay, duration: 0.45, type: "spring" },
                                        rotateZ: { delay: flyDelay, duration: 0.4 },
                                        filter: { duration: 0.25, repeat: isGlitch ? Infinity : 0 },
                                        x: { duration: 0.12, repeat: isGlitch ? Infinity : 0 },
                                    }}
                                    className={`
                                        relative aspect-square rounded-xl border overflow-hidden group select-none
                                        transition-shadow duration-300
                                        ${isWinner
                                            ? "border-[#0069FF] shadow-[0_0_28px_rgba(0,105,255,0.5)] z-10"
                                            : "border-white/10"
                                        }
                                        ${dimmed ? "grayscale" : ""}
                                    `}
                                >
                                    {/* ── Card image ── */}
                                    <div className="absolute inset-0">
                                        {card.image_url && (
                                            <img
                                                src={cardImageUrl(card.image_url)}
                                                alt={card.name}
                                                className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                                                draggable={false}
                                            />
                                        )}
                                    </div>

                                    {/* ── Glitch scanline overlay ── */}
                                    {isGlitch && (
                                        <div className="absolute inset-0 pointer-events-none z-10">
                                            <div className="absolute inset-0 bg-[#0069FF]/15 mix-blend-overlay animate-pulse" />
                                            <div
                                                className="absolute inset-0 opacity-20"
                                                style={{
                                                    backgroundImage:
                                                        "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,105,255,0.1) 2px, rgba(0,105,255,0.1) 4px)",
                                                }}
                                            />
                                        </div>
                                    )}

                                    {/* ── Winner highlight ── */}
                                    {isWinner && (
                                        <div className="absolute inset-0 rounded-xl pointer-events-none z-10">
                                            <div className="absolute inset-0 bg-[#0069FF]/10 animate-pulse" />
                                            <div className="absolute inset-0 border-2 border-[#0069FF] rounded-xl" />
                                        </div>
                                    )}

                                    {/* ── Hover info overlay (idle only) ── */}
                                    {phase === "idle" && (
                                        <div className="absolute inset-0 bg-black/85 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center p-4 text-center z-20">

                                            {/* 1. TYPE (Gray, uniform) */}
                                            <span className="inline-block px-3 py-1 rounded-full bg-white/10 border border-white/10 text-[10px] sm:text-xs font-bold text-white/50 uppercase tracking-widest mb-2">
                                                {card.type}
                                            </span>

                                            {/* 2. NAME */}
                                            <p className="font-black text-white text-sm sm:text-base uppercase italic tracking-wider mb-2 leading-tight line-clamp-2 drop-shadow-md">
                                                {card.name}
                                            </p>

                                            {/* 3. XP */}
                                            {card.xp_reward > 0 && (
                                                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-black text-[#0069FF]">
                                                    <Zap size={14} fill="currentColor" />
                                                    <span>+{card.xp_reward} XP</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </motion.div>
                            )
                        })}
                    </div>

                    {/* ── PLAY BUTTON ── */}
                    <div className="mt-8 sm:mt-10 flex justify-center pb-6">
                        {balance > 0 && wallet ? (
                            <motion.button
                                onClick={handlePlay}
                                disabled={phase !== "idle"}
                                className={`
                                    w-full max-w-md py-4 sm:py-5 rounded-2xl font-black text-sm sm:text-base tracking-[0.3em] uppercase
                                    transition-all duration-300
                                    ${phase === "idle"
                                        ? "bg-white text-black hover:bg-[#0069FF] hover:text-white shadow-lg shadow-white/10 hover:shadow-blue-600/50 hover:scale-[1.02] cursor-pointer"
                                        : phase === "glitching"
                                            ? "bg-white/50 text-[#0069FF]/60 cursor-wait"
                                            : "bg-white/10 text-white/20 cursor-default"
                                    }
                                `}
                                whileHover={phase === "idle" ? { scale: 1.02 } : {}}
                                whileTap={phase === "idle" ? { scale: 0.97 } : {}}
                            >
                                {phase === "glitching" ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Decrypting...
                                    </span>
                                ) : phase === "result" ? (
                                    "Decrypted!"
                                ) : (
                                    <>
                                        <Sparkles className="inline w-4 h-4 mr-2" />
                                        Play!
                                    </>
                                )}
                            </motion.button>
                        ) : !wallet ? (
                            <p className="text-xs font-bold text-white/30 tracking-wider uppercase py-4">
                                Connect Wallet to Play
                            </p>
                        ) : (
                            <p className="text-xs font-bold text-white/30 tracking-wider uppercase py-4">
                                No Tickets — Earn or Buy More Tickets
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* ━━━━━━━━━━━━━━━━━━━━━  RESULT MODAL  ━━━━━━━━━━━━━━━━━━━━━ */}
            <AnimatePresence>
                {showModal && wonPrize && (
                    <motion.div
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="relative w-full max-w-sm p-px rounded-[32px] bg-gradient-to-b from-white/15 to-transparent shadow-2xl"
                            initial={{ scale: 0.85, y: 40 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.85, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 200, damping: 22 }}
                        >
                            <div className="bg-[#090909] rounded-[31px] p-8 flex flex-col items-center relative overflow-hidden">

                                {/* Close btn */}
                                <button onClick={resetGame} className="absolute top-5 right-5 text-white/20 hover:text-white transition-colors cursor-pointer z-20">
                                    <X size={22} />
                                </button>

                                {/* BG glow */}
                                <div className="absolute top-0 inset-x-0 h-40 bg-[#0069FF]/20 blur-[80px] pointer-events-none" />

                                {/* Badge */}
                                <motion.div
                                    className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#0069FF]/10 border border-[#0069FF]/20 mb-7"
                                    initial={{ y: 16, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.1 }}
                                >
                                    <Sparkles size={11} className="text-[#0069FF]" />
                                    <span className="text-[9px] font-black uppercase tracking-widest text-[#0069FF]">Decryption Complete</span>
                                </motion.div>

                                {/* Prize image */}
                                <motion.div
                                    className="relative w-36 h-36 sm:w-40 sm:h-40 mb-6"
                                    initial={{ scale: 0.5, opacity: 0, rotateY: 180 }}
                                    animate={{ scale: 1, opacity: 1, rotateY: 0 }}
                                    transition={{ delay: 0.18, type: "spring", stiffness: 180, damping: 18 }}
                                >
                                    <div className="absolute inset-0 bg-[#0069FF] blur-[50px] opacity-20 rounded-full" />
                                    <div className="relative w-full h-full rounded-2xl border border-white/10 bg-[#111] overflow-hidden shadow-2xl">
                                        {wonPrize.imageUrl ? (
                                            <img
                                                src={cardImageUrl(wonPrize.imageUrl)}
                                                alt=""
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-white/5">
                                                <Gem className="w-12 h-12 text-white/20" />
                                            </div>
                                        )}
                                    </div>
                                </motion.div>

                                {/* Prize info */}
                                <motion.div
                                    className="text-center z-10 mb-6"
                                    initial={{ y: 15, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.3 }}
                                >
                                    <h2 className="text-xl sm:text-2xl font-black text-white uppercase italic tracking-wider mb-1">
                                        {wonPrize.label}
                                    </h2>

                                    {wonPrize.category === "nft" && wonPrize.nftTokenId && (
                                        <p className="font-mono text-[10px] text-white/30 uppercase tracking-widest mb-3">
                                            Token #{wonPrize.nftTokenId}
                                        </p>
                                    )}

                                    {/* Rewards row */}
                                    <div className="flex items-center justify-center gap-3 mt-3">
                                        {xpGained > 0 && (
                                            <div className="flex flex-col items-center px-4 py-2 rounded-xl bg-white/5 border border-white/10">
                                                <span className="text-[8px] text-white/30 font-bold uppercase tracking-wider mb-0.5">XP</span>
                                                <div className="flex items-center gap-1 text-[#0069FF] font-black text-lg leading-none">
                                                    <Zap size={14} fill="currentColor" />
                                                    {xpGained}
                                                </div>
                                            </div>
                                        )}
                                        {shardsGained > 0 && (
                                            <div className="flex flex-col items-center px-4 py-2 rounded-xl bg-white/5 border border-white/10">
                                                <span className="text-[8px] text-white/30 font-bold uppercase tracking-wider mb-0.5">Shards</span>
                                                <div className="flex items-center gap-1 text-purple-400 font-black text-lg leading-none">
                                                    <Gem size={14} fill="currentColor" />
                                                    {shardsGained}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>

                                {/* Action buttons */}
                                <motion.div
                                    className="flex w-full gap-3 z-10"
                                    initial={{ y: 12, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.45 }}
                                >
                                    <button
                                        onClick={() => {
                                            const parts = [`Just won ${wonPrize.label}`]
                                            if (xpGained > 0) parts.push(`+${xpGained} XP`)
                                            if (shardsGained > 0) parts.push(`+${shardsGained} Shards`)
                                            parts.push("in @ApeDroidz Glitch Game! 🎮⚡")
                                            const text = encodeURIComponent(parts.join(" "))
                                            window.open(`https://x.com/intent/tweet?text=${text}`, "_blank")
                                        }}
                                        className="flex-1 py-3.5 bg-[#0069FF] hover:bg-[#0055CC] text-white font-black text-xs uppercase tracking-[0.2em] rounded-xl transition-all hover:scale-[1.02] shadow-lg shadow-blue-600/20 cursor-pointer"
                                    >
                                        Share
                                    </button>
                                    <button
                                        onClick={resetGame}
                                        className="flex-1 py-3.5 bg-white/10 hover:bg-white/20 text-white font-black text-xs uppercase tracking-[0.2em] rounded-xl transition-all border border-white/5 cursor-pointer"
                                    >
                                        Again
                                    </button>
                                </motion.div>

                                {/* TX hash */}
                                {txHash && (
                                    <p className="mt-4 font-mono text-[8px] text-white/15 break-all text-center">
                                        TX: {txHash.slice(0, 12)}…{txHash.slice(-8)}
                                    </p>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
