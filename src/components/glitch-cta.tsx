"use client"

import { useState, useEffect, useCallback, useRef, memo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

// ─── Types ────────────────────────────────────────────────────────────────────
interface Prize {
    id: string | number
    name: string
    image_url: string
    type: string
}

// ─── Config ───────────────────────────────────────────────────────────────────
const STORAGE_BASE = "https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public"
const CARD_COVER   = "/glitch_card_cover.png"   // BLUE — hovered/scanned
const CARD_COVER_2 = "/glitch_card_cover_2.png" // DARK — default face-down
const CARD_BG      = "#090909"
const TOTAL        = 15

// 3-prize sequence (types to pick winner from in order)
const PRIZE_SEQUENCE = [
    { types: ["apechain_nft_top"],   keywords: ["apechain nft", "apechain"] },
    { types: ["token"],              keywords: ["30 ape", "30$ape"]         },
    { types: ["super_droid"],        keywords: ["super droid", "super_droid"] },
]

// Timings (ms)
const T_IDLE      = 1800
const T_GATHER    = 550   // layout animation to center
const T_FLIP      = 550   // flip center stack
const T_DEAL      = 600   // layout animation back to grid
const T_PICK      = 300
const T_SCAN_STEP = 165
const T_SCAN_LOCK = 550
const T_REVEAL    = 82
const T_POPUP     = 2200
const T_CLOSE     = 350

// ─── CSS ─────────────────────────────────────────────────────────────────────
const CSS = `
  .gc-scene { perspective: 600px; }
  .gc-inner {
    position: relative; width: 100%; height: 100%;
    transform-style: preserve-3d;
    transition: transform .38s cubic-bezier(.4,0,.2,1);
  }
  .gc-inner.flipped { transform: rotateY(180deg); }
  .gc-face {
    position: absolute; inset: 0;
    backface-visibility: hidden; -webkit-backface-visibility: hidden;
    border-radius: .375rem; overflow: hidden;
  }
  .gc-back { transform: rotateY(180deg); }
`

// ─── Helpers ─────────────────────────────────────────────────────────────────
const resolveUrl = (raw?: string | null) =>
    !raw ? "" : raw.startsWith("http") ? raw : `${STORAGE_BASE}${raw}`

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function pickWinnerForSlot(src: Prize[], slot: number): Prize | null {
    const { types, keywords } = PRIZE_SEQUENCE[slot % PRIZE_SEQUENCE.length]
    const eligible = src.filter(p => {
        if (types.includes(p.type)) return true
        const n = (p.name || "").toLowerCase()
        return keywords.some(k => n.includes(k))
    })
    if (!eligible.length) return null
    return eligible[Math.floor(Math.random() * eligible.length)]
}

function buildDeck(src: Prize[], winner: Prize): { cards: Prize[]; winnerIdx: number } {
    const others     = src.filter(p => p.id !== winner.id || p.name !== winner.name)
    const fill       = others.length ? others : src
    const pool: Prize[] = []
    while (pool.length < TOTAL - 1) pool.push(fill[pool.length % fill.length])
    const shuffled = shuffle(pool)
    const winPos   = Math.floor(Math.random() * TOTAL)
    const cards: Prize[] = []
    let fi = 0
    for (let i = 0; i < TOTAL; i++) cards.push(i === winPos ? winner : shuffled[fi++])
    return { cards, winnerIdx: winPos }
}

// ─── Phase ───────────────────────────────────────────────────────────────────
type Phase = "idle" | "gathering" | "flipping" | "dealing" | "scanning" | "locked" | "revealing" | "popup" | "closing" | "gap"

// ─── Mini Card ────────────────────────────────────────────────────────────────
interface MiniCardProps {
    prize: Prize
    flippedToBack: boolean
    useBlue: boolean
    winGlow: boolean
}
const MiniCard = memo(({ prize, flippedToBack, useBlue, winGlow }: MiniCardProps) => (
    <div className="relative aspect-square w-full gc-scene" style={{ minHeight: 0 }}>
        <div className={`gc-inner ${flippedToBack ? "flipped" : ""}`}>
            <div className="gc-face" style={{ background: CARD_BG }}>
                {prize.image_url
                    ? <img src={resolveUrl(prize.image_url)} alt={prize.name} className="w-full h-full object-cover" draggable={false} />
                    : <div className="w-full h-full flex items-center justify-center p-0.5">
                        <span className="text-white font-black text-[5px] text-center leading-tight">{prize.name}</span>
                      </div>
                }
            </div>
            <div className="gc-face gc-back" style={{ background: CARD_BG }}>
                <img src={useBlue ? CARD_COVER : CARD_COVER_2} alt=""
                    className="w-full h-full object-cover"
                    style={{ opacity: useBlue ? 1 : 0.82 }}
                    draggable={false}
                />
            </div>
        </div>
        {winGlow && (
            <motion.div
                className="absolute inset-0 rounded-md pointer-events-none z-10"
                style={{ boxShadow: "0 0 12px rgba(0,105,255,.75), inset 0 0 0 1.5px #0069FF" }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22 }}
            />
        )}
    </div>
))
MiniCard.displayName = "MiniCard"

// ─── Main Component ───────────────────────────────────────────────────────────
function GlitchCTAComponent() {
    const [prizes, setPrizes]         = useState<Prize[]>([])
    const [cards, setCards]           = useState<Prize[]>(Array(TOTAL).fill({ id: "", name: "", image_url: "", type: "" }))
    const [phase, setPhase]           = useState<Phase>("gap")
    const [flippedToBack, setFlipped] = useState(false)
    const [revealedSet, setRevealed]  = useState<Set<number>>(new Set())
    const [winnerIdx, setWinnerIdx]   = useState(-1)
    const [scanIdx, setScanIdx]       = useState(-1)
    const [winnerPrize, setWinPrize]  = useState<Prize | null>(null)
    const [isGathering, setGathering] = useState(false)  // triggers layout animation
    const roundRef  = useRef(0)
    const aliveRef  = useRef(true)
    const prizeSlot = useRef(0)  // 0,1,2 → cycles through PRIZE_SEQUENCE

    // ── Fetch prizes ──────────────────────────────────────────────────────────
    useEffect(() => {
        const load = () => fetch("/api/glitch_game/prizes", { cache: "no-store" })
            .then(r => r.json())
            .then(d => { if (d.prizes?.length) setPrizes(d.prizes as Prize[]) })
            .catch(() => {})
        load()
        const iv = setInterval(load, 30_000)
        return () => clearInterval(iv)
    }, [])

    // ── Single game round (without idle reset for rounds 1 & 2) ──────────────
    const runGame = useCallback(async (src: Prize[], showIdle: boolean) => {
        const round = roundRef.current
        const ok = () => aliveRef.current && roundRef.current === round

        const slot   = prizeSlot.current
        const winner = pickWinnerForSlot(src, slot) ?? src[0]
        if (!winner) return

        // 1. IDLE — show all prizes face-up (only for first round or after full cycle)
        if (showIdle) {
            const { cards: idleDeck } = buildDeck(src, winner)
            setCards(idleDeck)
            setRevealed(new Set())
            setWinnerIdx(-1)
            setScanIdx(-1)
            setGathering(false)
            setFlipped(false)
            setWinPrize(null)
            setPhase("idle")
            await pause(T_IDLE); if (!ok()) return
        }

        // 2. GATHER — all layout-animated to center (grid-column: 3, grid-row: 2)
        setGathering(true)
        setPhase("gathering")
        await pause(T_GATHER); if (!ok()) return

        // 3. FLIP — whole deck flips to cover while gathered
        setFlipped(true)
        setPhase("flipping")
        await pause(T_FLIP); if (!ok()) return

        // 4. DEAL — swap prize data (hidden), fly back to positions face-down
        const { cards: newDeck, winnerIdx: newWinIdx } = buildDeck(src, winner)
        setCards(newDeck)
        setWinnerIdx(newWinIdx)
        setWinPrize(newDeck[newWinIdx])
        setRevealed(new Set())
        setGathering(false)  // triggers layout animation back to grid
        setPhase("dealing")
        await pause(T_DEAL); if (!ok()) return

        // 5. PICK pause
        setPhase("scanning")
        await pause(T_PICK); if (!ok()) return

        // 6. SCAN — blue cover hops 7 cards → winner
        const path = shuffle([...Array(TOTAL).keys()].filter(i => i !== newWinIdx)).slice(0, 7)
        path.push(newWinIdx)
        for (const idx of path) {
            if (!ok()) return
            setScanIdx(idx)
            await pause(T_SCAN_STEP)
        }

        // 7. LOCKED — stays on winner
        setPhase("locked")
        await pause(T_SCAN_LOCK); if (!ok()) return
        setScanIdx(-1)

        // 8. REVEALING — all flip face-up one by one, winner last
        setPhase("revealing")
        const others = shuffle([...Array(TOTAL).keys()].filter(i => i !== newWinIdx))
        const acc = new Set<number>()
        for (const idx of others) {
            if (!ok()) return
            await pause(T_REVEAL)
            acc.add(idx)
            setRevealed(new Set(acc))
        }
        // Winner reveal — dramatic pause
        await pause(T_REVEAL * 4); if (!ok()) return
        setFlipped(false)  // winner flips face-up
        acc.add(newWinIdx)
        setRevealed(new Set(acc))
        await pause(260); if (!ok()) return

        // 9. POPUP
        setPhase("popup")
        await pause(T_POPUP); if (!ok()) return

        // 10. CLOSING
        setPhase("closing")
        await pause(T_CLOSE); if (!ok()) return

        setPhase("gap")
    }, [])

    // ── 3-round cycle loop ────────────────────────────────────────────────────
    useEffect(() => {
        if (!prizes.length) return
        aliveRef.current = true
        let stopped = false
        prizeSlot.current = 0

        const loop = async () => {
            await pause(1400)
            while (!stopped) {
                // Run 3 rounds (apechain_nft_top → 30 ape → super_droid)
                for (let r = 0; r < PRIZE_SEQUENCE.length; r++) {
                    if (stopped) return
                    prizeSlot.current = r
                    const showIdle = r === 0  // only show idle at start of full cycle
                    await runGame(prizes, showIdle)
                    if (stopped) return
                    await pause(200)  // tiny gap between rounds 1→2 and 2→3
                }
                // After all 3 done — short gap before full restart
                await pause(400)
            }
        }
        loop()
        return () => {
            stopped = true
            aliveRef.current = false
            roundRef.current++
        }
    }, [prizes, runGame])

    // ── Derived ───────────────────────────────────────────────────────────────
    const allFaceDown = ["scanning", "locked"].includes(phase) ||
                        (phase === "dealing") ||
                        (phase === "revealing" && !revealedSet.size)
    const showPopup   = phase === "popup" || phase === "closing"

    return (
        <motion.div
            initial={{ opacity: 0, x: -50, y: 50 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 1 }}
            className="fixed bottom-4 left-4 sm:bottom-6 sm:left-6 md:bottom-8 md:left-8 z-40 w-[145px] sm:w-[180px] md:w-[280px]"
            style={{ isolation: "isolate", willChange: "transform" }}
        >
            <style>{CSS}</style>

            <Link
                href="/glitch_game"
                className="group block relative overflow-hidden rounded-2xl border border-white/10 bg-black/90 backdrop-blur-xl shadow-[0_0_40px_rgba(0,0,0,0.6)] hover:border-white/20 transition-colors duration-300"
            >
                {/* ── GLITCH GAME SEASON 1 — above cards, left-aligned, -30% ── */}
                <div className="px-2.5 pt-2.5 pb-1 sm:px-3 sm:pt-3 sm:pb-1.5">
                    <p className="text-[8px] sm:text-[12px] md:text-[14px] font-black tracking-[0.08em] uppercase leading-none whitespace-nowrap">
                        <span className="text-white drop-shadow-[0_0_5px_rgba(255,255,255,.2)]">Glitch Game</span>{" "}
                        <span className="text-[#3b82f6]">Season 1</span>
                    </p>
                </div>

                {/* ── Card grid ── */}
                <div className="relative px-1.5 sm:px-1">
                    <div
                        className="relative w-full rounded-xl overflow-hidden border border-white/5"
                        style={{ background: CARD_BG }}
                    >
                        {/*
                            KEY FIX: use `layout` on each card motion.div.
                            During gathering, set explicit gridColumn/gridRow so all cards fly to center.
                            Framer Motion layout animation handles the smooth position transition
                            (same technique as GameBoard.tsx's gatherClass).
                        */}
                        <div
                            className="grid gap-[2px] p-[2px]"
                            style={{ gridTemplateColumns: "repeat(5, 1fr)" }}
                        >
                            {cards.map((card, i) => {
                                const isWin      = i === winnerIdx
                                const isRevealed = revealedSet.has(i)
                                const isScanned  = (phase === "scanning" && i === scanIdx) || (phase === "locked" && isWin)
                                const faceDown   = flippedToBack && !isRevealed
                                const winGlow    = phase === "revealing" && isWin && isRevealed

                                return (
                                    <motion.div
                                        key={i}
                                        layout
                                        style={isGathering ? {
                                            gridColumn: "3",
                                            gridRow: "2",
                                            zIndex: 20,
                                            position: "relative",
                                        } : { position: "relative" }}
                                        transition={{
                                            layout: {
                                                duration: 0.48,
                                                type: "spring",
                                                stiffness: 175,
                                                damping: 22,
                                                delay: isGathering ? i * 0.018 : i * 0.025, // stagger
                                            }
                                        }}
                                        className={`rounded-md border overflow-hidden transition-colors duration-150 ${
                                            winGlow ? "border-[#0069FF]" : "border-white/10"
                                        }`}
                                    >
                                        <MiniCard
                                            prize={card}
                                            flippedToBack={faceDown}
                                            useBlue={isScanned}
                                            winGlow={winGlow}
                                        />
                                    </motion.div>
                                )
                            })}
                        </div>

                        {/* ── Win popup ── */}
                        <AnimatePresence>
                            {showPopup && winnerPrize && (
                                <motion.div
                                    className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none"
                                    style={{ background: "rgba(0,0,0,.91)", backdropFilter: "blur(4px)" }}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: phase === "closing" ? 0 : 1 }}
                                    transition={{ duration: 0.26 }}
                                >
                                    {/* "Congrats" ABOVE the image */}
                                    <motion.p
                                        className="text-[7px] sm:text-[8px] font-black text-white/50 uppercase tracking-widest mb-0.5"
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.1 }}
                                    >
                                        Congrats, you won
                                    </motion.p>

                                    {/* Prize image */}
                                    <motion.div
                                        className="rounded-xl overflow-hidden border-2 border-[#0069FF] shadow-[0_0_22px_rgba(0,105,255,.7)]"
                                        style={{ width: "40%", aspectRatio: "1" }}
                                        initial={{ scale: 0.45, y: 8 }}
                                        animate={{ scale: 1, y: 0 }}
                                        transition={{ type: "spring", stiffness: 280, damping: 20, delay: 0.08 }}
                                    >
                                        {winnerPrize.image_url
                                            ? <img src={resolveUrl(winnerPrize.image_url)} alt={winnerPrize.name} className="w-full h-full object-cover" />
                                            : <div className="w-full h-full flex items-center justify-center p-1" style={{ background: CARD_BG }}>
                                                <span className="text-white font-black text-[7px] text-center">{winnerPrize.name}</span>
                                              </div>
                                        }
                                    </motion.div>

                                    {/* Prize name below */}
                                    <motion.p
                                        className="text-[7px] sm:text-[8px] font-bold text-[#3b82f6] uppercase tracking-wide text-center px-2 leading-tight mt-0.5"
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.26 }}
                                    >
                                        {winnerPrize.name}
                                    </motion.p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* ── Text & CTA ── */}
                <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1.5 sm:gap-2 sm:px-3 sm:pb-3 sm:pt-2">
                    <h3 className="text-[15px] sm:text-[19px] md:text-[22px] font-black text-white leading-[0.92] tracking-tight uppercase">
                        Try Your Luck<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-200 to-white">
                            &amp; Win Rewards
                        </span>
                    </h3>

                    <div className="w-full h-8 sm:h-9 flex items-center justify-center gap-2 rounded-lg font-black uppercase tracking-wider text-[10px] sm:text-[11px] transition-all duration-300 bg-white text-black group-hover:bg-[#0069FF] group-hover:text-white shadow-[0_0_20px_rgba(255,255,255,.1)] group-hover:shadow-[0_0_25px_rgba(0,105,255,.5)]">
                        Play Now
                        <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform hidden sm:block" />
                    </div>
                </div>

                <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/20 blur-[60px] pointer-events-none" />
                <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-blue-600/20 blur-[60px] pointer-events-none" />
            </Link>
        </motion.div>
    )
}

export const GlitchCTA = memo(GlitchCTAComponent)
