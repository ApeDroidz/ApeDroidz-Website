"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Timer, Sparkles, X, Gem, Zap } from "lucide-react"
import { fadeUp } from "@/lib/animations"

// --- TYPES ---
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

// --- CARD DATA (visual only — result comes from server) ---
const CARD_BACKS = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    label: "???",
}))

// Shuffle helper
function fisherYates<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
            ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

type GamePhase = "idle" | "dealing" | "shuffling" | "picking" | "revealing" | "result"

export function GameBoard({ balance, wallet, onPlayComplete, onRefetch }: GameBoardProps) {
    const [phase, setPhase] = useState<GamePhase>("idle")
    const [cards, setCards] = useState(CARD_BACKS)
    const [selectedCard, setSelectedCard] = useState<number | null>(null)
    const [prize, setPrize] = useState<PrizeResult | null>(null)
    const [xpGained, setXpGained] = useState(0)
    const [shardsGained, setShardsGained] = useState(0)
    const [txHash, setTxHash] = useState<string | null>(null)
    const [timer, setTimer] = useState(60)
    const [error, setError] = useState<string | null>(null)
    const [showModal, setShowModal] = useState(false)
    const timerRef = useRef<NodeJS.Timeout | null>(null)

    // --- GAME SEQUENCE ---
    const startGame = useCallback(() => {
        if (balance < 1 || !wallet) return
        setError(null)
        setPrize(null)
        setXpGained(0)
        setShardsGained(0)
        setTxHash(null)
        setSelectedCard(null)
        setShowModal(false)

        // Deal cards
        setPhase("dealing")
        const shuffled = fisherYates(CARD_BACKS)
        setCards(shuffled)

        // After deal animation → shuffle → pick
        setTimeout(() => {
            setPhase("shuffling")
            setCards(fisherYates(shuffled))
            setTimeout(() => {
                setPhase("picking")
                setTimer(60)
            }, 1200)
        }, 800)
    }, [balance, wallet])

    // --- COUNTDOWN ---
    useEffect(() => {
        if (phase !== "picking") {
            if (timerRef.current) clearInterval(timerRef.current)
            return
        }
        timerRef.current = setInterval(() => {
            setTimer(t => {
                if (t <= 1) {
                    // Auto-pick random card
                    const randomIdx = Math.floor(Math.random() * 12)
                    pickCard(randomIdx)
                    return 0
                }
                return t - 1
            })
        }, 1000)
        return () => { if (timerRef.current) clearInterval(timerRef.current) }
    }, [phase])

    // --- PICK CARD ---
    const pickCard = async (index: number) => {
        if (phase !== "picking" || !wallet) return
        if (timerRef.current) clearInterval(timerRef.current)

        setSelectedCard(index)
        setPhase("revealing")

        try {
            const res = await fetch("/api/glitch_game/play", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Play failed")

            setPrize(data.prize)
            setXpGained(data.xp_gained || 0)
            setShardsGained(data.shards_gained || 0)
            setTxHash(data.tx_hash || null)
            onPlayComplete(data.newBalance)

            // Brief delay then show result
            setTimeout(() => {
                setPhase("result")
                setShowModal(true)
            }, 1500)
        } catch (err: any) {
            console.error("Play error:", err)
            setError(err.message)
            setPhase("idle")
        }
    }

    const resetGame = () => {
        setPhase("idle")
        setPrize(null)
        setXpGained(0)
        setShardsGained(0)
        setTxHash(null)
        setSelectedCard(null)
        setShowModal(false)
        setError(null)
        onRefetch()
    }

    // --- RENDER ---
    return (
        <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 min-h-[500px] relative">
            {/* Title */}
            <motion.h1
                className="text-3xl sm:text-5xl font-black tracking-tighter text-white mb-2 text-center uppercase italic"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
            >
                Glitch Game
            </motion.h1>
            <p className="font-bold text-[10px] sm:text-xs text-white/40 tracking-[0.3em] mb-10 text-center uppercase">
                Pick a Card & Win Rewards
            </p>

            {/* Error */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        className="mb-4 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-xs uppercase tracking-wider"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* IDLE STATE */}
            {phase === "idle" && (
                <motion.div className="flex flex-col items-center gap-6" variants={fadeUp} initial="hidden" animate="show">
                    {balance > 0 && wallet ? (
                        <motion.button
                            onClick={startGame}
                            className="group relative px-10 py-4 rounded-xl border border-[#0069FF] bg-[#0069FF]
                         font-black text-xs tracking-[0.2em] text-white uppercase shadow-lg shadow-blue-600/20
                         hover:bg-[#0055CC] hover:scale-105 transition-all duration-300 cursor-pointer"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <Sparkles className="inline w-4 h-4 mr-2" />
                            Initiate Sequence
                        </motion.button>
                    ) : !wallet ? (
                        <p className="font-bold text-xs text-white/30 tracking-wider uppercase">Connect Wallet to Play</p>
                    ) : (
                        <p className="font-bold text-xs text-white/30 tracking-wider uppercase">No Tickets Available — Buy or Earn Tickets</p>
                    )}
                </motion.div>
            )}

            {/* CARD GRID (dealing, shuffling, picking, revealing, result) */}
            {phase !== "idle" && (
                <div className="w-full max-w-xl">
                    {/* Timer */}
                    {phase === "picking" && (
                        <motion.div
                            className="flex items-center justify-center gap-2 mb-6"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                        >
                            <Timer className="w-4 h-4 text-white/40" />
                            <span className={`font-mono text-sm font-bold tracking-widest ${timer <= 10 ? "text-red-400" : "text-white/60"}`}>
                                00:{String(timer).padStart(2, "0")}
                            </span>
                        </motion.div>
                    )}

                    {/* Grid */}
                    <motion.div
                        className="grid grid-cols-4 gap-3 sm:gap-4"
                        initial="hidden"
                        animate="show"
                    >
                        {cards.map((card, i) => {
                            const isSelected = selectedCard === i
                            const isRevealed = phase === "result"
                            const showPrize = isSelected && prize && (phase === "revealing" || phase === "result")

                            return (
                                <motion.div
                                    key={card.id}
                                    layoutId={`card-${card.id}`}
                                    onClick={() => phase === "picking" && pickCard(i)}
                                    className={`
                    relative aspect-[3/4] rounded-xl border overflow-hidden
                    transition-all duration-300 select-none
                    ${phase === "picking"
                                            ? "cursor-pointer hover:border-white/40 hover:bg-white/10 hover:scale-[1.03] shadow-lg shadow-black/50"
                                            : "cursor-default"
                                        }
                    ${isSelected && (phase === "revealing" || phase === "result")
                                            ? "border-white/40 bg-white/10 scale-[1.02]"
                                            : "border-white/10 bg-white/5"
                                        }
                    ${phase === "result" && !isSelected ? "opacity-30 blur-[1px]" : ""}
                  `}
                                    initial={{ opacity: 0, rotateY: 180, scale: 0.8 }}
                                    animate={{
                                        opacity: 1,
                                        rotateY: 0,
                                        scale: 1,
                                        transition: {
                                            delay: phase === "dealing" ? i * 0.06 : 0,
                                            duration: 0.5,
                                            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
                                        },
                                    }}
                                >
                                    {/* Card face */}
                                    <div className="absolute inset-0 flex flex-col items-center justify-center p-2">
                                        {showPrize ? (
                                            <motion.div
                                                className="text-center w-full"
                                                initial={{ opacity: 0, scale: 0.5 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                transition={{ delay: 0.3, duration: 0.4 }}
                                            >
                                                {prize.imageUrl && (
                                                    <img src={prize.imageUrl} alt="" className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-2 rounded-lg object-cover" />
                                                )}
                                                <p className="font-bold text-[8px] sm:text-[10px] text-white/90 leading-tight uppercase tracking-wider line-clamp-2">
                                                    {prize.label}
                                                </p>
                                            </motion.div>
                                        ) : (
                                            <>
                                                {/* Pattern */}
                                                <div className="absolute inset-0 opacity-[0.03]"
                                                    style={{
                                                        backgroundImage: "radial-gradient(circle at center, white 1px, transparent 1px)",
                                                        backgroundSize: "8px 8px",
                                                    }}
                                                />
                                                <span className="font-black text-sm text-white/10">?</span>
                                            </>
                                        )}
                                    </div>

                                    {/* Hover effect (picking only) */}
                                    {phase === "picking" && (
                                        <div className="absolute inset-0 bg-white/0 hover:bg-white/[0.03] transition-colors duration-200" />
                                    )}
                                </motion.div>
                            )
                        })}
                    </motion.div>
                </div>
            )}

            {/* RESULT MODAL — "COMBO WIN" */}
            <AnimatePresence>
                {showModal && prize && (
                    <motion.div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="relative w-full max-w-sm p-8 rounded-3xl border border-white/10 bg-[#0a0a0a] shadow-2xl overflow-hidden"
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
                        >
                            {/* Background glow */}
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1/2 bg-gradient-to-b from-[#0069FF]/10 to-transparent pointer-events-none" />

                            <button
                                onClick={resetGame}
                                className="absolute top-4 right-4 text-white/30 hover:text-white/60 transition-colors cursor-pointer z-10"
                            >
                                <X className="w-5 h-5" />
                            </button>

                            <div className="relative z-10 text-center">
                                <p className="font-bold text-[10px] text-white/30 tracking-[0.3em] uppercase mb-6">
                                    Decrypted
                                </p>

                                {/* ── MAIN PRIZE CARD ── */}
                                <motion.div
                                    className="relative mb-6 mx-auto w-fit"
                                    initial={{ y: 15, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.1, duration: 0.4 }}
                                >
                                    {prize.imageUrl ? (
                                        <div className="w-28 h-28 mx-auto rounded-2xl border border-white/10 bg-white/5 overflow-hidden shadow-2xl">
                                            <img src={prize.imageUrl} alt="" className="w-full h-full object-cover" />
                                        </div>
                                    ) : prize.category === 'shard' ? (
                                        <div className="w-28 h-28 mx-auto rounded-2xl border border-white/10 bg-gradient-to-br from-purple-500/10 to-cyan-500/10 flex items-center justify-center shadow-2xl">
                                            <Gem className="w-12 h-12 text-purple-400/70" />
                                        </div>
                                    ) : null}
                                </motion.div>

                                <h2 className="text-xl font-black text-white mb-1 uppercase tracking-tight">{prize.label}</h2>
                                {prize.category === 'nft' && prize.nftTokenId && (
                                    <p className="font-mono text-[10px] text-white/30 mb-1">TOKEN #{prize.nftTokenId}</p>
                                )}

                                {/* ── COMBO REWARDS ── */}
                                <motion.div
                                    className="mt-5 mb-6 flex items-center justify-center gap-3"
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.35, duration: 0.4 }}
                                >
                                    {/* XP Bonus */}
                                    {xpGained > 0 && (
                                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                                            <Zap className="w-3.5 h-3.5 text-yellow-400" />
                                            <span className="font-bold text-xs text-yellow-400">+{xpGained} XP</span>
                                        </div>
                                    )}
                                    {/* Shard Bonus */}
                                    {shardsGained > 0 && (
                                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                                            <Gem className="w-3.5 h-3.5 text-purple-400" />
                                            <span className="font-bold text-xs text-purple-400">+{shardsGained} Shards</span>
                                        </div>
                                    )}
                                </motion.div>

                                {/* Glowing combo line */}
                                <motion.p
                                    className="font-bold text-[10px] tracking-[0.2em] text-[#0069FF]/60 mb-8 uppercase"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: [0, 1, 0.5, 1] }}
                                    transition={{ delay: 0.5, duration: 2, repeat: Infinity }}
                                >
                                    Double Rewards Unlocked
                                </motion.p>

                                {/* TX hash (for NFTs) */}
                                {txHash && (
                                    <p className="font-mono text-[9px] text-white/20 mb-4 break-all px-4">
                                        TX: {txHash.slice(0, 10)}...{txHash.slice(-10)}
                                    </p>
                                )}

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => {
                                            const parts = [`Just won ${prize.label}`]
                                            if (xpGained > 0) parts.push(`+${xpGained} XP`)
                                            if (shardsGained > 0) parts.push(`+${shardsGained} Shards`)
                                            parts.push('in @ApeDroidz Glitch Game! 🎮⚡')
                                            const text = encodeURIComponent(parts.join(' '))
                                            window.open(`https://x.com/intent/tweet?text=${text}`, '_blank')
                                        }}
                                        className="flex-1 h-[48px] rounded-xl border border-[#0069FF] bg-[#0069FF] text-xs
                                   font-black tracking-widest text-white uppercase shadow-lg shadow-blue-900/20
                                   hover:bg-[#0055CC] hover:scale-[1.02] transition-all cursor-pointer"
                                    >
                                        Share Win
                                    </button>
                                    <button
                                        onClick={resetGame}
                                        className="flex-1 h-[48px] rounded-xl border border-white/10 bg-white/5 text-xs
                                   font-bold tracking-widest text-white/50 uppercase
                                   hover:bg-white/10 hover:text-white hover:border-white/20 transition-all cursor-pointer"
                                    >
                                        Continue
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
