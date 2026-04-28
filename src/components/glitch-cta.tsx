"use client"

import { useEffect, useRef, useState, memo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

// ─── Config ────────────────────────────────────────────────────────────────────
// Flight first, then Cards. Each clip plays through ONE full cycle (we parse
// the GIF binary to get its real duration) before crossfading to the next.
// `key` on the <img> remounts it so the GIF restarts from frame 0 each cycle —
// mirrors the "fresh on each hover" feel of the videos on /glitch_games.
const SLOTS = [
    { src: "/glitch_flight.gif", alt: "Glitch Flight preview" },
    { src: "/glitch_cards.gif",  alt: "Glitch Cards preview"  },
]

const DEFAULT_MS = 5000   // fallback if duration parsing fails
const MIN_MS = 1500        // sanity-clamp: never swap faster than this

/**
 * Parse a GIF's total animation duration (ms) by walking its frame headers.
 *
 * GIF structure: every animated frame is preceded by a Graphic Control
 * Extension block: 0x21 0xF9 0x04 [packed] [delay_lo] [delay_hi] [tcid] 0x00.
 * Delay is in centiseconds (1/100 s). Many encoders write 0 (= "no delay"
 * which most browsers treat as ~100ms) so we floor it.
 */
async function getGifDurationMs(url: string): Promise<number> {
    try {
        const res = await fetch(url, { cache: "force-cache" })
        if (!res.ok) return DEFAULT_MS
        const buf = new Uint8Array(await res.arrayBuffer())
        let total = 0
        for (let i = 0; i + 7 < buf.length; i++) {
            if (buf[i] === 0x21 && buf[i + 1] === 0xF9 && buf[i + 2] === 0x04) {
                const delay = (buf[i + 4] | (buf[i + 5] << 8)) || 10  // floor 0→10cs (~100ms)
                total += delay * 10
                i += 7
            }
        }
        if (total < MIN_MS) return Math.max(total || DEFAULT_MS, MIN_MS)
        return total
    } catch {
        return DEFAULT_MS
    }
}

// ─── Component ─────────────────────────────────────────────────────────────────
function GlitchCTAComponent() {
    const [slot, setSlot] = useState(0)
    const [cycle, setCycle] = useState(0)
    // Per-slot duration in ms. Parsed from each GIF on mount.
    const [durations, setDurations] = useState<number[]>(() => SLOTS.map(() => DEFAULT_MS))
    const slotRef = useRef(0)
    const timerRef = useRef<number | null>(null)

    // Parse durations once.
    useEffect(() => {
        let alive = true
        Promise.all(SLOTS.map(s => getGifDurationMs(s.src))).then(ds => {
            if (!alive) return
            setDurations(ds)
        })
        return () => { alive = false }
    }, [])

    // Drive the swap loop, re-scheduling whenever the slot or its duration changes.
    useEffect(() => {
        const ms = durations[slotRef.current] ?? DEFAULT_MS
        if (timerRef.current) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => {
            slotRef.current = (slotRef.current + 1) % SLOTS.length
            setSlot(slotRef.current)
            setCycle(c => c + 1)
        }, ms)
        return () => { if (timerRef.current) window.clearTimeout(timerRef.current) }
    }, [slot, durations])

    const current = SLOTS[slot]

    return (
        <motion.div
            initial={{ opacity: 0, x: -50, y: 50 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 1 }}
            className="fixed bottom-4 left-4 sm:bottom-6 sm:left-6 md:bottom-8 md:left-8 z-40 w-[180px] sm:w-[230px] md:w-[340px]"
            style={{ isolation: "isolate", willChange: "transform" }}
        >
            <Link
                href="/glitch_games"
                className="group block relative overflow-hidden rounded-2xl border border-white/10 bg-black/90 backdrop-blur-xl shadow-[0_0_40px_rgba(0,0,0,0.6)] hover:border-white/20 transition-colors duration-300"
            >
                {/* ── Title ────────────────────────────────────────────────── */}
                <div className="px-2.5 pt-2.5 pb-1 sm:px-3 sm:pt-3 sm:pb-1.5">
                    <p className="text-[8px] sm:text-[12px] md:text-[14px] font-black tracking-[0.08em] uppercase leading-none whitespace-nowrap">
                        <span className="text-white drop-shadow-[0_0_5px_rgba(255,255,255,.2)]">Glitch Games</span>{" "}
                        <span className="text-[#3b82f6] drop-shadow-[0_0_8px_rgba(59,130,246,.4)]">Season 2 is Live</span>
                    </p>
                </div>

                {/* ── Preview window: alternating Flight / Cards GIFs (16:9) ── */}
                <div className="relative px-1.5 sm:px-1">
                    <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-white/5 bg-[#090909]">
                        <AnimatePresence mode="sync">
                            <motion.img
                                key={`${slot}-${cycle}`}
                                src={current.src}
                                alt={current.alt}
                                draggable={false}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.35, ease: "easeOut" }}
                                className="absolute inset-0 w-full h-full object-cover"
                                onError={(e) => {
                                    ;(e.currentTarget as HTMLImageElement).style.display = "none"
                                }}
                            />
                        </AnimatePresence>

                        {/* Subtle inner vignette */}
                        <div
                            className="absolute inset-0 pointer-events-none rounded-xl"
                            style={{ boxShadow: "inset 0 0 18px rgba(0,0,0,0.55)" }}
                        />

                        {/* Slot indicator dots */}
                        <div className="absolute top-1.5 right-1.5 flex gap-1">
                            {SLOTS.map((_, i) => (
                                <span
                                    key={i}
                                    className={`block w-1 h-1 rounded-full transition-colors ${
                                        i === slot ? "bg-[#3b82f6]" : "bg-white/20"
                                    }`}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                {/* ── Text & CTA ────────────────────────────────────────────── */}
                <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1.5 sm:gap-2 sm:px-3 sm:pb-3 sm:pt-2">
                    <h3 className="text-[15px] sm:text-[19px] md:text-[22px] font-black text-white leading-[0.92] tracking-tight uppercase">
                        Try Your Luck<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-200 to-white md:hidden">
                            &amp; Win Rewards
                        </span>
                        <span className="hidden md:inline text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-200 to-white">
                            And Win Rewards
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
