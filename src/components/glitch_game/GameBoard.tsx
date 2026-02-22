
"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, X, Gem, Zap, Gamepad2, Share2, Repeat } from "lucide-react"
import { useUserProgress } from "@/hooks/useUserProgress"

/* ─── Supabase storage base for card images ─── */
const STORAGE_BASE = "https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public"

function cardImageUrl(raw: string | null | undefined): string {
    if (!raw) return ""
    if (raw.startsWith("http")) return raw
    return `${STORAGE_BASE}${raw} `
}

const CARD_COVER = "/glitch_card_cover.png"
const CARD_COVER_2 = "/glitch_card_cover_2.png"

/* ─── XP Level milestones (must match user-progress-provider) ─── */
const LEVEL_MILESTONES = [0, 1000, 3000, 5000, 10000, 30000, 50000, 100000, 200000, 300000]

function getLevelProgress(xp: number) {
    let level = 1
    for (let i = 0; i < LEVEL_MILESTONES.length; i++) {
        if (xp >= LEVEL_MILESTONES[i]) level = i + 1
        else break
    }
    const currentMilestone = LEVEL_MILESTONES[level - 1] || 0
    const nextMilestone = LEVEL_MILESTONES[level] || (xp * 1.5)
    const range = nextMilestone - currentMilestone
    const earned = xp - currentMilestone
    const progress = range > 0 ? Math.min((earned / range) * 100, 99.9) : 0
    return { level, currentMilestone, nextMilestone, progress }
}

/* ─── Types ─── */
interface PrizeType {
    id: string
    name: string
    type: string
    image_url: string
    xp_reward: number
    drop_chance: number
}

// Extend PrizeType for unique deck cards
interface DeckCard extends PrizeType {
    uniqueId: string
}

interface PrizeResult {
    id: string
    type: string
    name: string
    imageUrl: string
    amount: number
    nftTokenId: string | null
}

interface GameBoardProps {
    balance: number
    wallet: string | undefined
    onPlayComplete: (newBalance: number) => void
    onRefetch: () => void
}

type Phase = "loading" | "idle" | "flipping" | "gathering" | "shuffling" | "picking" | "revealing" | "result"

/* ─── Fisher-Yates shuffle ─── */
function shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
            ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

function randomGlitchDelay() {
    return Math.random() * 2
}

/* ─── Glitch CSS (from upgrade machine — clip-path based) ─── */
const GLITCH_STYLES = `
  @keyframes glitch-anim-1 {
    0% { clip-path: inset(50% 0 30% 0); -webkit-clip-path: inset(50% 0 30% 0); transform: translate(-5px, 0); }
    5% { clip-path: inset(10% 0 80% 0); -webkit-clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); }
    10% { clip-path: inset(80% 0 5% 0); -webkit-clip-path: inset(80% 0 5% 0); transform: translate(-5px, 0); }
    15% { clip-path: inset(30% 0 60% 0); -webkit-clip-path: inset(30% 0 60% 0); transform: translate(5px, 0); }
    20% { clip-path: inset(60% 0 20% 0); -webkit-clip-path: inset(60% 0 20% 0); transform: translate(-5px, 0); }
    25% { clip-path: inset(10% 0 85% 0); -webkit-clip-path: inset(10% 0 85% 0); transform: translate(5px, 0); }
    30% { clip-path: inset(40% 0 40% 0); -webkit-clip-path: inset(40% 0 40% 0); transform: translate(-5px, 0); }
    35% { clip-path: inset(80% 0 10% 0); -webkit-clip-path: inset(80% 0 10% 0); transform: translate(5px, 0); }
    40% { clip-path: inset(20% 0 50% 0); -webkit-clip-path: inset(20% 0 50% 0); transform: translate(-5px, 0); }
    45% { clip-path: inset(50% 0 30% 0); -webkit-clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); }
    50% { clip-path: inset(10% 0 80% 0); -webkit-clip-path: inset(10% 0 80% 0); transform: translate(-5px, 0); }
    55% { clip-path: inset(70% 0 20% 0); -webkit-clip-path: inset(70% 0 20% 0); transform: translate(5px, 0); }
    60% { clip-path: inset(30% 0 60% 0); -webkit-clip-path: inset(30% 0 60% 0); transform: translate(-5px, 0); }
    65% { clip-path: inset(90% 0 5% 0); -webkit-clip-path: inset(90% 0 5% 0); transform: translate(5px, 0); }
    70% { clip-path: inset(15% 0 80% 0); -webkit-clip-path: inset(15% 0 80% 0); transform: translate(-5px, 0); }
    75% { clip-path: inset(55% 0 10% 0); -webkit-clip-path: inset(55% 0 10% 0); transform: translate(5px, 0); }
    80% { clip-path: inset(25% 0 50% 0); -webkit-clip-path: inset(25% 0 50% 0); transform: translate(-5px, 0); }
    85% { clip-path: inset(75% 0 15% 0); -webkit-clip-path: inset(75% 0 15% 0); transform: translate(5px, 0); }
    90% { clip-path: inset(10% 0 85% 0); -webkit-clip-path: inset(10% 0 85% 0); transform: translate(-5px, 0); }
    95% { clip-path: inset(45% 0 45% 0); -webkit-clip-path: inset(45% 0 45% 0); transform: translate(5px, 0); }
    100% { clip-path: inset(50% 0 30% 0); -webkit-clip-path: inset(50% 0 30% 0); transform: translate(-5px, 0); }
  }
  @keyframes glitch-anim-2 {
    0% { clip-path: inset(10% 0 80% 0); -webkit-clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); }
    5% { clip-path: inset(80% 0 10% 0); -webkit-clip-path: inset(80% 0 10% 0); transform: translate(-5px, 0); }
    10% { clip-path: inset(30% 0 60% 0); -webkit-clip-path: inset(30% 0 60% 0); transform: translate(5px, 0); }
    15% { clip-path: inset(70% 0 20% 0); -webkit-clip-path: inset(70% 0 20% 0); transform: translate(-5px, 0); }
    20% { clip-path: inset(10% 0 40% 0); -webkit-clip-path: inset(10% 0 40% 0); transform: translate(5px, 0); }
    25% { clip-path: inset(50% 0 30% 0); -webkit-clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); }
    30% { clip-path: inset(20% 0 70% 0); -webkit-clip-path: inset(20% 0 70% 0); transform: translate(5px, 0); }
    35% { clip-path: inset(90% 0 5% 0); -webkit-clip-path: inset(90% 0 5% 0); transform: translate(-5px, 0); }
    40% { clip-path: inset(30% 0 50% 0); -webkit-clip-path: inset(30% 0 50% 0); transform: translate(5px, 0); }
    45% { clip-path: inset(60% 0 20% 0); -webkit-clip-path: inset(60% 0 20% 0); transform: translate(-5px, 0); }
    50% { clip-path: inset(10% 0 85% 0); -webkit-clip-path: inset(10% 0 85% 0); transform: translate(5px, 0); }
    55% { clip-path: inset(80% 0 10% 0); -webkit-clip-path: inset(80% 0 10% 0); transform: translate(-5px, 0); }
    60% { clip-path: inset(40% 0 40% 0); -webkit-clip-path: inset(40% 0 40% 0); transform: translate(5px, 0); }
    65% { clip-path: inset(20% 0 70% 0); -webkit-clip-path: inset(20% 0 70% 0); transform: translate(-5px, 0); }
    70% { clip-path: inset(70% 0 15% 0); -webkit-clip-path: inset(70% 0 15% 0); transform: translate(5px, 0); }
    75% { clip-path: inset(10% 0 80% 0); -webkit-clip-path: inset(10% 0 80% 0); transform: translate(-5px, 0); }
    80% { clip-path: inset(50% 0 30% 0); -webkit-clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); }
    85% { clip-path: inset(25% 0 60% 0); -webkit-clip-path: inset(25% 0 60% 0); transform: translate(-5px, 0); }
    90% { clip-path: inset(85% 0 5% 0); -webkit-clip-path: inset(85% 0 5% 0); transform: translate(5px, 0); }
    95% { clip-path: inset(35% 0 50% 0); -webkit-clip-path: inset(35% 0 50% 0); transform: translate(-5px, 0); }
    100% { clip-path: inset(10% 0 80% 0); -webkit-clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); }
  }
  
  .glitch-wrapper { position: relative; width: 100%; height: 100%; }
  .glitch-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: transparent; }
  
  .glitch-soft .glitch-layer.layer-1 { animation: glitch-anim-1 3s infinite step-end alternate-reverse; opacity: 0.25; }
  .glitch-soft .glitch-layer.layer-2 { animation: glitch-anim-2 3s infinite step-end alternate-reverse; opacity: 0.25; }
  
  .glitch-hard .glitch-layer.layer-1 { animation: glitch-anim-1 0.15s infinite step-end alternate-reverse; opacity: 0.8; }
  .glitch-hard .glitch-layer.layer-2 { animation: glitch-anim-2 0.15s infinite step-end alternate-reverse; opacity: 0.8; }
`

/* ─── Card flip CSS ─── */
const CARD_FLIP_STYLES = `
  .card-scene { perspective: 1000px; }
  .card-inner {
    position: relative; width: 100%; height: 100%;
    transform-style: preserve-3d;
    transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .card-inner.flipped { transform: rotateY(180deg); }
  .card-face {
    position: absolute; inset: 0;
    backface-visibility: hidden; -webkit-backface-visibility: hidden;
    border-radius: 0.75rem; overflow: hidden;
  }
  .card-back { transform: rotateY(180deg); }
`

/* ════════════════════════════════════════════
   GAME BOARD
   ════════════════════════════════════════════ */
export function GameBoard({ balance, wallet, onPlayComplete, onRefetch }: GameBoardProps) {
    const [phase, setPhase] = useState<Phase>("loading")
    const [prizes, setPrizes] = useState<PrizeType[]>([])
    const [displayCards, setDisplayCards] = useState<DeckCard[]>([])
    const [dealt, setDealt] = useState(false)

    // Card states
    const [flippedToBack, setFlippedToBack] = useState(false)
    const [revealedSet, setRevealedSet] = useState<Set<number>>(new Set())
    const [pickedIdx, setPickedIdx] = useState<number | null>(null)
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

    // Result state
    const [wonPrize, setWonPrize] = useState<PrizeResult | null>(null)
    const [xpGained, setXpGained] = useState(0)
    const [shardsGained, setShardsGained] = useState(0)
    const [txHash, setTxHash] = useState<string | null>(null)
    const [winnerIdx, setWinnerIdx] = useState<number | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [showModal, setShowModal] = useState(false)

    // XP animation state
    const { xp: currentXp, level: currentLevel, progress: currentProgress, refetch: refetchProgress } = useUserProgress()
    const [animatedXpProgress, setAnimatedXpProgress] = useState<number | null>(null)
    // "Play Again" button trigger (one-off)
    const [isPlayAgainTrigger, setIsPlayAgainTrigger] = useState(false)
    // Full Auto-Play Mode (toggle)
    const [isAutoMode, setIsAutoMode] = useState(false)

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

    // Helper to generate fresh prize pool (15 items)
    const getFreshPrizes = (src: PrizeType[]): PrizeType[] => {
        if (!src || src.length === 0) return []

        // 1. If we have enough unique items in source to fill the board (>= 15),
        // use them all (or random distinct 15) to avoid any duplicates.
        if (src.length >= 15) {
            return shuffle([...src]).slice(0, 15)
        }

        // 2. If < 15, we MUST duplicate something to fill the board to 15.
        // Priority: All items at least once, then fill with replenishables.

        let deckPool = [...src] // Start with one of each available prize

        const replenishables = src.filter(p => p.type !== 'nft' && p.type !== 'token')

        // Fill remaining slots
        while (deckPool.length < 15) {
            if (replenishables.length > 0) {
                // Pick random replenishable (allowed to duplicate)
                const random = replenishables[Math.floor(Math.random() * replenishables.length)]
                deckPool.push(random)
            } else {
                // Fallback: Duplicate anything if no replenishables found
                const random = src[Math.floor(Math.random() * src.length)]
                deckPool.push(random)
            }
        }

        return deckPool.slice(0, 15)
    }

    const buildDeck = (src: PrizeType[]) => {
        if (src.length === 0) return

        const freshPrizes = getFreshPrizes(src)

        // Shuffle pool first
        let pool = shuffle([...freshPrizes])

        // Take top 15 and assign unique IDs immediately so keys are stable across reorders
        const deck: DeckCard[] = pool.map((p, i) => ({
            ...p,
            uniqueId: `${p.id}-${i}-${Math.random().toString(36).substr(2, 5)}`
        }))

        // Final shuffle of the deck itself
        const initialDeck = shuffle(deck)

        setDisplayCards(initialDeck)
        setPhase("idle")
        setTimeout(() => setDealt(true), 15 * 100 + 500)
    }

    /* ═══════════════════════════════════════
       PLAY → GATHER → FLIP → DEAL
       ═══════════════════════════════════════ */
    const handlePlay = async () => {
        if (phase !== "idle" || balance < 1 || !wallet) return
        setError(null)

        // 1. GATHER
        // All cards fly to center stack (Face UP if persistent reveal is active)
        setPhase("gathering")
        // Sound for "folding into 1"
        const gatherSfx = new Audio("/sounds/fx/whoosh2.MP3")
        gatherSfx.volume = 0.3
        gatherSfx.play().catch(() => { })

        await delay(600) // Travel time

        // 2. FLIP
        // While gathered in center, flip the whole stack
        setFlippedToBack(true)
        const sfx = new Audio("/sounds/fx/whoosh.MP3")
        sfx.volume = 0.45
        sfx.play().catch(() => { })
        setRevealedSet(new Set())
        setWinnerIdx(null)
        setPickedIdx(null)
        setHoveredIdx(null)
        await delay(800) // Flip time (increased to ensure completion before deal)

        // 3. SHUFFLE & REFRESH (Internal Data)
        // Now that they are hidden (flipped), we refresh deck content but keep keys stable

        const freshPrizes = getFreshPrizes(prizes)
        // We shuffle the NEW prizes first to ensure randomness distribution
        const shuffledPrizes = shuffle([...freshPrizes])

        // Update existing cards with new prize data but PRESERVE uniqueId (key)
        // This keeps Framer Motion happy and the cards smooth
        const newDeck = displayCards.map((card, i) => {
            // If we have fewer prizes than cards (shouldn't happen), use random fallback
            const p = shuffledPrizes[i] || shuffledPrizes[0]
            return {
                ...p,
                uniqueId: card.uniqueId // KEEP THE KEY
            }
        })

        // Now shuffle the POSITIONS of these cards
        const finalShuffled = shuffle(newDeck)
        setDisplayCards(finalShuffled)

        // 4. DEAL
        // Cards fly out to new positions (Face Down)
        const audio = new Audio("/sounds/fx/playing-cards-shuffle.mp3")
        audio.volume = 0.6
        audio.play().catch(() => { })
        setTimeout(() => audio.pause(), 800) // Cut sound short (user request)
        setPhase("picking")
    }

    /* ═══════════════════════════════════════
       PICK → API call, reveal, result
       ═══════════════════════════════════════ */
    const handlePick = useCallback(async (idx: number) => {
        if (phase !== "picking" || !wallet) return
        setPickedIdx(idx)
        setHoveredIdx(null)
        setPhase("revealing")

        // 1. Start audio loop for glitch effect
        const startVolume = 0.18
        const glitchAudio = new Audio("/sounds/fx/glitch_fx.mp3")
        glitchAudio.volume = startVolume
        glitchAudio.loop = true

        // Seamless loop: Restart before end to avoid silence/fade-out
        glitchAudio.addEventListener('timeupdate', function () {
            const buffer = 0.4
            if (this.currentTime > this.duration - buffer) {
                this.currentTime = 0
                this.play()
            }
        })

        glitchAudio.play().catch(() => { })

        let data: any
        try {
            const res = await fetch("/api/glitch_game/play", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet }),
            })
            data = await res.json()
            if (!res.ok || data.error) throw new Error(data.error || "Play failed")

            // SWAP LOGIC: Ensure no duplicates by swapping winner with picked card
            const wonPrizeName = data.prize.name

            // Find if this prize already exists somewhere ELSE on the board
            const existingIdx = displayCards.findIndex((c, i) => c.name === wonPrizeName && i !== idx)

            let newCards = [...displayCards]

            if (existingIdx !== -1) {
                // If found, swap their data (but keep uniqueId to preserve layout animation)
                const pickedCard = newCards[idx]
                const existingCard = newCards[existingIdx]

                // Swap DATA, keep KEYS
                newCards[idx] = { ...existingCard, uniqueId: pickedCard.uniqueId }
                newCards[existingIdx] = { ...pickedCard, uniqueId: existingCard.uniqueId }
            } else {
                // Should technically not happen if board has all 15 prizes, but safe fallback:
                // Just update the picked card with the winning data
                newCards[idx] = {
                    ...newCards[idx],
                    name: data.prize.name,
                    image_url: data.prize.imageUrl,
                    type: data.prize.type,
                    id: data.prize.id
                }
            }

            setDisplayCards(newCards)

            const xpWon = data.xp_gained || 0
            setWonPrize(data.prize)
        } catch (err: any) {
            console.error(err)
            setError(err.message || "Play failed")
            setFlippedToBack(false)
            setRevealedSet(new Set())
            setPickedIdx(null)
            setPhase("idle")
            glitchAudio.pause()
            return
        }

        // Reveal Animation
        setWinnerIdx(idx)

        // SEQUENTIAL REVEAL (0, 1, 2, ... skipping winner)
        const revealOrder: number[] = []
        for (let i = 0; i < displayCards.length; i++) {
            if (i !== idx) revealOrder.push(i)
        }
        revealOrder.push(idx) // winner last

        const newRevealed = new Set<number>()
        const totalCards = revealOrder.length

        for (let i = 0; i < totalCards; i++) {
            const cardIdx = revealOrder[i]
            // We accumulate revealed set for animation
            await delay(cardIdx === idx ? 400 : 80)
            newRevealed.add(cardIdx)
            setRevealedSet(new Set(newRevealed))

            // Fade out glitch sound
            const progress = i / (totalCards - 1 || 1)
            const newVol = Math.max(0, startVolume * (1 - progress))
            glitchAudio.volume = newVol

            // Play flip sounds
            if (cardIdx !== idx) {
                // Losing card flip
                const sfx = new Audio("/sounds/fx/whoosh.MP3")
                sfx.volume = 0.3
                sfx.play().catch(() => { })
            } else {
                // Winner reveal
                const sfx = new Audio("/sounds/fx/win(1).MP3")
                sfx.volume = 0.375
                sfx.play().catch(() => { })
            }
        }

        await delay(200)
        glitchAudio.pause()

        // Finalize Result
        const xpWon = data.xp_gained || 0
        setXpGained(xpWon)
        setShardsGained(data.shards_gained || 0)
        setTxHash(data.tx_hash || null)
        onPlayComplete(data.newBalance)

        setPhase("result")
        setTimeout(() => {
            setShowModal(true)
            // Sound for prize card animation
            // Delayed slightly to match visual animation (delay: 0.22s)
            setTimeout(() => {
                const winSfx = new Audio("/sounds/fx/whoosh.MP3")
                winSfx.volume = 0.6
                winSfx.play().catch(() => { })
            }, 200)

            if (xpWon > 0) {
                const before = getLevelProgress(currentXp)
                const after = getLevelProgress(currentXp + xpWon)
                setAnimatedXpProgress(before.progress)
                setTimeout(() => setAnimatedXpProgress(after.progress), 400)
            }
        }, 350)
    }, [phase, wallet, displayCards, onPlayComplete, currentXp])

    const resetGame = (triggerPlayAgain = false) => {
        setPhase("idle")
        setWonPrize(null)
        setXpGained(0)
        setShardsGained(0)
        setTxHash(null)
        setShowModal(false)
        setError(null)
        setAnimatedXpProgress(null)
        onRefetch()
        refetchProgress()

        // DO NOT REBUILD DECK - keep current state until user clicks Play

        if (triggerPlayAgain) {
            setIsPlayAgainTrigger(true)
        }
    }

    // Effect 1: Handle "Play Again" button click (One-off)
    useEffect(() => {
        if (isPlayAgainTrigger && phase === "idle" && balance > 0) {
            setIsPlayAgainTrigger(false)
            handlePlay()
        } else if (isPlayAgainTrigger && phase === "idle" && balance < 1) {
            setIsPlayAgainTrigger(false) // Cancel if no balance
        }
    }, [phase, isPlayAgainTrigger, balance])

    // Effect 2: FULL AUTO MODE LOOP
    useEffect(() => {
        if (!isAutoMode) return

        let timeout: NodeJS.Timeout

        // A) START GAME (Idle)
        if (phase === "idle") {
            if (balance > 0) {
                // Short delay before starting next game
                timeout = setTimeout(() => {
                    handlePlay()
                }, 1000)
            } else {
                // Auto-stop if out of games
                setIsAutoMode(false)
            }
        }
        // B) AUTO-PICK (Picking Phase)
        else if (phase === "picking") {
            // Wait for shuffle animation to settle + human-like delay
            timeout = setTimeout(() => {
                // Pick random index
                const randomIdx = Math.floor(Math.random() * displayCards.length)
                handlePick(randomIdx)
            }, 1500)
        }
        // C) AUTO-RESET (Result / Win Modal)
        else if (phase === "result") {
            // Wait for win animation/sound then reset force-start next game
            timeout = setTimeout(() => {
                resetGame(true) // Pass true to trigger immediate "Play Again"
            }, 1500)
        }

        return () => clearTimeout(timeout)
    }, [isAutoMode, phase, balance, displayCards.length])


    /* ── XP bar helpers ── */
    const xpBefore = getLevelProgress(currentXp)
    const xpAfter = getLevelProgress(currentXp + xpGained)

    // Sound helper
    const playSound = (type: "hover" | "btn_hover" | "pick") => {
        let file = "/sounds/fx/crd_pick_sound.mp3"
        let vol = 1.0

        if (type === "hover") {
            file = "/sounds/fx/crd_hover_sound.mp3"
            vol = 0.6
        } else if (type === "btn_hover") {
            file = "/sounds/fx/ui_hover_buttons.mp3"
            vol = 0.3
        }

        const audio = new Audio(file)
        audio.volume = vol
        audio.play().catch(() => { })
    }

    /* ══════════  RENDER  ══════════ */
    return (
        <div className="flex-1 flex flex-col items-center w-full relative px-4 sm:px-6 pt-2">
            <style jsx global>{`${GLITCH_STYLES}
            ${CARD_FLIP_STYLES}
            .transform-style-3d { transform-style: preserve-3d; }
            .backface-hidden { backface-visibility: hidden; }
            .rotate-y-180 { transform: rotateY(180deg); }
`}</style>

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

            {/* ── Error ── */}
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

            {/* ── Loading Skeleton ── */}
            {phase === "loading" && (
                <div className="w-full max-w-4xl mx-auto flex flex-col items-center gap-6 animate-pulse">
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3 w-full">
                        {Array.from({ length: 15 }).map((_, i) => (
                            <div key={i} className="aspect-[3/4] w-full rounded-xl bg-white/5 border border-white/5" />
                        ))}
                    </div>
                    <div className="w-full max-w-md h-14 rounded-2xl bg-white/5 border border-white/5" />
                </div>
            )}

            {/* ── CARD GRID ── */}
            {phase !== "loading" && (
                <div className="w-full max-w-4xl mx-auto">
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
                        {displayCards.map((card, i) => {
                            const isPickingPhase = phase === "picking"
                            const isRevealingPhase = phase === "revealing"
                            const isGatheringPhase = phase === "gathering"
                            const isResultPhase = phase === "result"
                            const isWinner = winnerIdx === i && isResultPhase
                            const isHovered = hoveredIdx === i && isPickingPhase
                            const isRevealed = revealedSet.has(i)
                            const isCardPicked = pickedIdx === i
                            const dimmed = isResultPhase && !isWinner

                            const showCover = flippedToBack && !isRevealed
                            const softGlitch = isPickingPhase && !isHovered
                            const hardGlitch = isRevealingPhase && !isRevealed && !isCardPicked

                            const flyDelay = dealt ? 0 : i * 0.1

                            // While gathering, force all cards to center cell
                            // Mobile (3 cols): Center is Row 3, Col 2
                            // Desktop (5 cols): Center is Row 2, Col 3
                            const gatherClass = isGatheringPhase
                                ? "row-start-3 col-start-2 sm:row-start-2 sm:col-start-3 z-50 scale-105"
                                : ""

                            // Cover logic: Default to Cover 2. Hover/Picked = Cover 1.
                            const activeCover = ((isPickingPhase && isHovered) || isCardPicked)
                                ? CARD_COVER
                                : CARD_COVER_2

                            const cardInnerContent = (
                                <div className={`card-inner w-full h-full transition-transform duration-500 transform-style-3d ${showCover ? "rotate-y-180" : ""}`}>
                                    <div className="card-face absolute inset-0 backface-hidden">
                                        {card.image_url && <img src={cardImageUrl(card.image_url)} alt={card.name} className="w-full h-full object-cover rounded-xl" draggable={false} />}
                                    </div>
                                    <div className="card-face card-back absolute inset-0 backface-hidden rotate-y-180 bg-[#090909] border border-white/10 rounded-xl overflow-hidden">
                                        <img src={activeCover} alt="" className="w-full h-full object-cover opacity-80 transition-all duration-300" draggable={false} />
                                    </div>
                                </div>
                            )

                            return (
                                <motion.div
                                    key={card.uniqueId}
                                    layout
                                    initial={dealt ? false : { opacity: 0, y: 350, scale: 0.55, rotateZ: -12 }}
                                    animate={{
                                        opacity: dimmed ? 0.25 : 1,
                                        y: (isPickingPhase && isHovered) ? -10 : 0,
                                        scale: isWinner ? 1.08 : 1,
                                        rotateZ: isGatheringPhase ? (i % 5 - 2) * 3 : 0, // Random tilt in stack
                                    }}
                                    transition={{
                                        layout: {
                                            duration: 0.5,
                                            type: "spring",
                                            stiffness: 180,
                                            damping: 20,
                                            delay: isPickingPhase ? i * 0.04 : 0
                                        },
                                        opacity: { delay: flyDelay, duration: 0.35 },
                                        y: isPickingPhase
                                            ? { duration: 0.2, type: "spring", stiffness: 300, damping: 20 }
                                            : { delay: flyDelay, duration: 0.5, type: "spring", stiffness: 130, damping: 14 },
                                        scale: { duration: 0.45, type: "spring" },
                                        rotateZ: { delay: flyDelay, duration: 0.4 },
                                    }}
                                    onHoverStart={() => {
                                        if (isPickingPhase) {
                                            const audio = new Audio("/sounds/fx/crd_hover_sound.mp3")
                                            audio.volume = 0.4
                                            audio.play().catch(() => { })
                                            setHoveredIdx(i)
                                        }
                                    }}
                                    // Don't resets on end to prevent flicker
                                    onHoverEnd={() => isPickingPhase && setHoveredIdx(null)}
                                    onClick={() => {
                                        if (isPickingPhase) {
                                            const audio = new Audio("/sounds/fx/crd_pick_sound.mp3")
                                            audio.volume = 0.6
                                            audio.play().catch(() => { })
                                            handlePick(i)
                                        }
                                    }}
                                    className={`
                                        relative aspect-square rounded-xl border overflow-hidden select-none card-scene
                                        transition-shadow duration-300
                                        ${isWinner ? "border-[#0069FF] shadow-[0_0_28px_rgba(0,105,255,0.5)] z-10" : "border-white/10"}
                                        ${dimmed ? "grayscale" : ""}
                                        ${isPickingPhase ? "cursor-pointer" : ""}
                                        ${isPickingPhase && isHovered ? "border-white/40 shadow-[0_8px_25px_rgba(0,105,255,0.25)] z-10" : ""}
                                        ${gatherClass}
                                    `}
                                >
                                    {/* ── Stable Wrapper ── */}
                                    <div className={`glitch-wrapper ${softGlitch ? "glitch-soft" : ""} ${hardGlitch ? "glitch-hard" : ""}`}>
                                        {cardInnerContent}
                                        {(softGlitch || hardGlitch) && (
                                            <>
                                                <div className="glitch-layer layer-1 z-20 pointer-events-none" aria-hidden="true">
                                                    {cardInnerContent}
                                                </div>
                                                <div className="glitch-layer layer-2 z-20 pointer-events-none" aria-hidden="true">
                                                    {cardInnerContent}
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* Winner highlight */}
                                    {isWinner && (
                                        <div className="absolute inset-0 rounded-xl pointer-events-none z-10">
                                            <div className="absolute inset-0 bg-[#0069FF]/10 animate-pulse" />
                                            <div className="absolute inset-0 border-2 border-[#0069FF] rounded-xl" />
                                        </div>
                                    )}

                                    {/* Picking hover glow (always render for layout stability?) */}
                                    {isPickingPhase && isHovered && (
                                        <div className="absolute inset-0 rounded-xl pointer-events-none z-10">
                                            <div className="absolute inset-0 bg-white/5 rounded-xl" />
                                            <div className="absolute inset-0 border border-white/20 rounded-xl" />
                                        </div>
                                    )}

                                    {/* Use 'i' for hover tooltip (idle phase) logic works because cards don't move during idle */}
                                    {phase === "idle" && (
                                        <div className="absolute inset-0 bg-black/85 backdrop-blur-sm opacity-0 hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center p-4 text-center z-20 rounded-xl">
                                            <span className="inline-block px-3 py-1 rounded-full bg-white/10 border border-white/10 text-[10px] sm:text-xs font-bold text-white/50 uppercase tracking-widest mb-2">
                                                {card.type}
                                            </span>
                                            <p className="font-black text-white text-sm sm:text-base uppercase italic tracking-wider mb-2 leading-tight line-clamp-2 drop-shadow-md">
                                                {card.name}
                                            </p>
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

                    {/* ── ACTION BUTTONS CONTAINER ── */}
                    <div className="mt-8 sm:mt-10 flex items-center justify-center gap-4 pb-6 px-4">

                        {/* AUTO PLAY TOGGLE */}
                        {balance > 0 && wallet && (
                            <motion.button
                                onClick={() => {
                                    playSound("pick")
                                    setIsAutoMode(!isAutoMode)
                                }}
                                onMouseEnter={() => playSound("btn_hover")}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                className={`
                                    h-[56px] sm:h-[64px] px-6 rounded-2xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all duration-300 border
                                    ${isAutoMode
                                        ? "bg-[#00FF94]/10 border-[#00FF94] text-[#00FF94] shadow-[0_0_20px_rgba(0,255,148,0.2)]"
                                        : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white/60"
                                    }
                                `}
                            >
                                <Repeat className={`w-5 h-5 ${isAutoMode ? "animate-spin-slow" : ""}`} />
                                <span className="hidden sm:inline">{isAutoMode ? "AUTOPLAY: ON" : "AUTOPLAY"}</span>
                            </motion.button>
                        )}

                        {balance > 0 && wallet ? (
                            <motion.button
                                onClick={phase === "idle" ? () => { playSound("pick"); handlePlay() } : undefined}
                                onMouseEnter={() => phase === "idle" && playSound("btn_hover")}
                                disabled={phase !== "idle" && phase !== "picking"}
                                className={`
                                    flex-1 max-w-sm py-4 sm:py-5 rounded-2xl font-black text-sm sm:text-base tracking-widest uppercase flex items-center justify-center
                                    transition-all duration-300
                                    ${phase === "idle"
                                        ? "bg-white text-black hover:bg-[#0069FF] hover:text-white shadow-lg shadow-white/10 hover:shadow-blue-600/50 hover:scale-[1.02] cursor-pointer"
                                        : phase === "picking"
                                            ? "bg-[#0069FF]/20 border border-[#0069FF]/40 text-[#0069FF] cursor-default animate-pulse"
                                            : phase === "flipping" || phase === "shuffling"
                                                ? "bg-white/20 text-white/40 cursor-wait"
                                                : "bg-white/10 text-white/20 cursor-default"
                                    }
                                `}
                                whileHover={phase === "idle" ? { scale: 1.02 } : {}}
                                whileTap={phase === "idle" ? { scale: 0.97 } : {}}
                            >
                                {phase === "idle" ? (
                                    <div className="flex items-center gap-3 pointer-events-none">
                                        <span>PLAY FOR 1</span>
                                        <Gamepad2 className="w-5 h-5 stroke-[2.5]" />
                                    </div>
                                ) : phase === "flipping" || phase === "shuffling" ? (
                                    <span className="flex items-center justify-center gap-2 pointer-events-none">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Shuffling...
                                    </span>
                                ) : phase === "picking" ? (
                                    <div className="flex items-center gap-3 pointer-events-none">
                                        <span>PICK YOUR CARD</span>
                                        <Gamepad2 className="w-5 h-5 stroke-[2.5]" />
                                    </div>
                                ) : phase === "revealing" ? (
                                    <span className="flex items-center justify-center gap-2 pointer-events-none">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Revealing...
                                    </span>
                                ) : (
                                    <span className="pointer-events-none">Revealed!</span>
                                )}
                            </motion.button>
                        ) : !wallet ? (
                            <p className="text-xs font-bold text-white/30 tracking-wider uppercase py-4">
                                Connect Wallet to Play
                            </p>
                        ) : (
                            <p className="text-xs font-bold text-white/30 tracking-wider uppercase py-4">
                                No Games — Earn or Buy More Games
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* ━━━━━━━━━━━━━━━━━  RESULT MODAL  ━━━━━━━━━━━━━━━━━ */}
            <AnimatePresence>
                {showModal && wonPrize && (
                    <motion.div
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="relative w-full max-w-2xl p-px rounded-[32px] bg-gradient-to-b from-[#0069FF]/30 to-transparent shadow-2xl"
                            initial={{ scale: 0.85, y: 40 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.85, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 200, damping: 22 }}
                        >
                            <div className="bg-[#090909] rounded-[31px] border border-white/20 p-8 sm:p-12 flex flex-col items-center relative overflow-hidden shadow-2xl">

                                {/* Close */}
                                <button
                                    onClick={() => { playSound("pick"); resetGame() }}
                                    onMouseEnter={() => playSound("btn_hover")}
                                    className="absolute top-5 right-5 text-white/20 hover:text-white transition-colors cursor-pointer z-20"
                                >
                                    <X size={22} className="pointer-events-none" />
                                </button>

                                {/* BG glow */}
                                <div className="absolute top-0 inset-x-0 h-48 bg-[#0069FF]/20 blur-[80px] pointer-events-none" />

                                {/* Header */}
                                <motion.div
                                    className="flex flex-col items-center mb-8 z-10 w-full"
                                    initial={{ y: 20, opacity: 0, scale: 0.8 }}
                                    animate={{ y: 0, opacity: 1, scale: 1 }}
                                    transition={{ delay: 0.08, type: "spring", stiffness: 200, damping: 18 }}
                                >
                                    <h2 className="text-xl sm:text-2xl font-bold text-white/40 uppercase tracking-widest leading-none text-center mb-2">
                                        CONGRATS
                                    </h2>
                                    <p className="text-3xl sm:text-4xl md:text-5xl font-black italic text-white uppercase tracking-tight leading-none text-center drop-shadow-[0_0_10px_rgba(0,105,255,0.25)] flex flex-wrap justify-center gap-x-3">
                                        <span>YOU WON</span>
                                        <span className="text-[#0069FF]">{wonPrize.name}</span>
                                    </p>
                                    {wonPrize.type === 'shard' && (
                                        <a
                                            href="/merge_mechanism?tab=shards"
                                            className="mt-2 text-[10px] text-white/30 hover:text-white/70 transition-colors uppercase tracking-widest underline underline-offset-2 pointer-events-auto"
                                        >
                                            merge 30 shards → get 1 standard battery
                                        </a>
                                    )}
                                </motion.div>

                                {/* Prize image */}
                                <motion.div
                                    className="relative w-72 h-72 sm:w-96 sm:h-96 mb-8"
                                    initial={{ scale: 0.5, opacity: 0, rotateY: 180 }}
                                    animate={{ scale: 1, opacity: 1, rotateY: 0 }}
                                    transition={{ delay: 0.22, type: "spring", stiffness: 180, damping: 18 }}
                                >
                                    <div className="absolute inset-0 bg-[#0069FF] blur-[50px] opacity-25 rounded-full" />
                                    <div className="relative w-full h-full rounded-2xl border border-white/10 bg-[#111] overflow-hidden shadow-2xl">
                                        {wonPrize.imageUrl ? (
                                            <img src={cardImageUrl(wonPrize.imageUrl)} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-white/5">
                                                <Gem className="w-14 h-14 text-white/20" />
                                            </div>
                                        )}
                                    </div>
                                </motion.div>

                                {/* Token ID */}
                                {wonPrize.type === "nft" && wonPrize.nftTokenId && (
                                    <motion.p
                                        className="font-mono text-xs text-white/30 uppercase tracking-widest mb-4"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.3 }}
                                    >
                                        Token #{wonPrize.nftTokenId}
                                    </motion.p>
                                )}

                                {/* ── XP PROGRESS BAR ── */}
                                {xpGained > 0 && (
                                    <motion.div
                                        className="w-full mb-6 z-10"
                                        initial={{ y: 10, opacity: 0 }}
                                        animate={{ y: 0, opacity: 1 }}
                                        transition={{ delay: 0.35 }}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <Zap size={16} className="text-[#0069FF]" fill="currentColor" />
                                                <span className="text-sm font-black text-white uppercase tracking-wider">+{xpGained} XP</span>
                                            </div>
                                            <span className="text-xs font-bold text-white/30 tracking-wider">
                                                Lv.{xpBefore.level} → {xpAfter.level > xpBefore.level ? `Lv.${xpAfter.level} ` : ""}
                                            </span>
                                        </div>

                                        {/* Progress bar track */}
                                        <div className="w-full h-3 rounded-full bg-white/5 border border-white/10 overflow-hidden relative">
                                            <motion.div
                                                className="h-full rounded-full bg-gradient-to-r from-[#0069FF] to-[#00C2FF] relative"
                                                initial={{ width: `${xpBefore.progress}% ` }}
                                                animate={{ width: `${animatedXpProgress ?? xpBefore.progress}% ` }}
                                                transition={{ duration: 1.2, ease: "easeOut" }}
                                            >
                                                <div className="absolute inset-0 bg-white/20 rounded-full animate-pulse" />
                                            </motion.div>
                                        </div>

                                        <div className="flex items-center justify-between mt-1.5">
                                            <span className="text-[10px] font-bold text-white/20">{currentXp.toLocaleString()} XP</span>
                                            <span className="text-[10px] font-bold text-white/20">{xpAfter.nextMilestone.toLocaleString()} XP</span>
                                        </div>
                                    </motion.div>
                                )}



                                {/* Buttons */}
                                <motion.div
                                    className="flex w-full gap-3 z-10"
                                    initial={{ y: 12, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.5 }}
                                >
                                    <button
                                        onClick={() => {
                                            playSound("pick")
                                            const parts = [`Just won ${wonPrize.name} `]
                                            if (xpGained > 0) parts.push(`+ ${xpGained} XP`)
                                            if (shardsGained > 0) parts.push(`+ ${shardsGained} Shards`)
                                            parts.push("in @ApeDroidz Glitch Game! 🎮⚡")
                                            const text = encodeURIComponent(parts.join(" "))
                                            window.open(`https://x.com/intent/tweet?text=${text}`, "_blank")
                                        }}
                                        onMouseEnter={() => playSound("btn_hover")}
                                        className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-white/40 hover:text-white font-bold text-xs uppercase tracking-[0.2em] rounded-xl transition-all border border-white/5 cursor-pointer flex items-center justify-center gap-2"
                                    >
                                        <span className="pointer-events-none">Share</span>
                                        <Share2 className="w-3 h-3" />
                                    </button >
                                    <button
                                        onClick={() => { playSound("pick"); resetGame(true) }}
                                        onMouseEnter={() => playSound("btn_hover")}
                                        className="flex-[2] py-4 bg-white text-black hover:bg-[#0069FF] hover:text-white font-black text-sm uppercase tracking-[0.2em] rounded-xl transition-all hover:scale-[1.02] shadow-lg shadow-white/10 hover:shadow-blue-600/50 cursor-pointer flex items-center justify-center gap-2"
                                    >
                                        <span className="pointer-events-none">PLAY AGAIN FOR 1</span>
                                        <Gamepad2 className="w-4 h-4" />
                                    </button>
                                </motion.div >

                                {txHash && (
                                    <a
                                        href={`https://apescan.io/tx/${txHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={() => playSound("btn_hover")}
                                        className="mt-4 font-mono text-[8px] text-white/20 hover:text-[#0069FF] break-all text-center transition-colors cursor-pointer underline underline-offset-2 decoration-white/10 hover:decoration-[#0069FF]/40"
                                    >
                                        TX: {txHash.slice(0, 12)}…{txHash.slice(-8)} ↗
                                    </a>
                                )}
                            </div >
                        </motion.div >
                    </motion.div >
                )}
            </AnimatePresence >
        </div >
    )
}

/* ─── Utility ─── */
function delay(ms: number) {
    return new Promise(r => setTimeout(r, ms))
}
