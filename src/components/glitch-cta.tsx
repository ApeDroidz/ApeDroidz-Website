"use client"

import { useEffect, useRef, useState, memo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

// ─── Config ────────────────────────────────────────────────────────────────────
// Flight first, then Cards. Each plays for SLOT_MS, then crossfades.
//
// We use a fixed schedule rather than parsing the GIF's binary frame delays
// because (a) the parser was unreliable on these particular files and could
// return absurd durations (e.g. >30s) when LZW image data happened to contain
// the magic GCE bytes, leaving the panel "stuck" on the first gif; and
// (b) a uniform cadence is easier to reason about — set once, both gifs
// rotate predictably.
//
// Restart trick: bumping `cycle` forces React to remount the <img>, which
// makes the GIF play from frame 0 again instead of letting it loop silently
// in place. Mirrors the "fresh on each hover" feel of /glitch_games videos.
const SLOT_MS = 5500
const SLOTS = [
    { src: "/glitch_flight.gif", alt: "Glitch Flight preview" },
    { src: "/glitch_cards.gif",  alt: "Glitch Cards preview"  },
]

// ─── Component ─────────────────────────────────────────────────────────────────
function GlitchCTAComponent() {
    const [slot, setSlot] = useState(0)
    const [cycle, setCycle] = useState(0)
    const slotRef = useRef(0)

    useEffect(() => {
        const id = window.setInterval(() => {
            slotRef.current = (slotRef.current + 1) % SLOTS.length
            setSlot(slotRef.current)
            setCycle(c => c + 1)
        }, SLOT_MS)
        return () => window.clearInterval(id)
    }, [])

    const current = SLOTS[slot]

    return (
        <motion.div
            initial={{ opacity: 0, x: -50, y: 50 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 1 }}
            // Slightly narrower than before (was 180/230/340) so the bottom-right
            // VEO watermark gets clipped by the object-position trick below.
            className="fixed bottom-4 left-4 sm:bottom-6 sm:left-6 md:bottom-8 md:left-8 z-40 w-[160px] sm:w-[200px] md:w-[290px]"
            style={{ isolation: "isolate", willChange: "transform" }}
        >
            <Link
                href="/glitch_games/cards"
                className="group block relative overflow-hidden rounded-2xl border border-white/10 bg-black/90 backdrop-blur-xl shadow-[0_0_40px_rgba(0,0,0,0.6)] hover:border-white/20 transition-colors duration-300"
            >
                {/* ── Title ────────────────────────────────────────────────── */}
                <div className="px-2.5 pt-2.5 pb-1 sm:px-3 sm:pt-3 sm:pb-1.5">
                    <p className="text-[8px] sm:text-[12px] md:text-[14px] font-black tracking-[0.08em] uppercase leading-none whitespace-nowrap">
                        <span className="text-white drop-shadow-[0_0_5px_rgba(255,255,255,.2)]">Glitch Games</span>{" "}
                        <span className="text-[#3b82f6] drop-shadow-[0_0_8px_rgba(59,130,246,.4)]">Season 2 is Live</span>
                    </p>
                </div>

                {/* ── Preview window ───────────────────────────────────────────
                     - aspect-[5/3] (1.667) is slightly tighter than the gif's
                       16:9 (1.78). With object-cover that means the image
                       overflows horizontally → we clip a few % off the sides.
                     - object-left anchors it to the left edge so the clip
                       happens entirely on the RIGHT, where the VEO watermark
                       lives. Net effect: VEO is cropped without obviously
                       distorting the gif. */}
                <div className="relative px-1.5 sm:px-1">
                    <div className="relative w-full aspect-[5/3] rounded-xl overflow-hidden border border-white/5 bg-[#090909]">
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
                                className="absolute inset-0 w-full h-full object-cover object-left"
                                onError={(e) => {
                                    ;(e.currentTarget as HTMLImageElement).style.display = "none"
                                }}
                            />
                        </AnimatePresence>

                        {/* Inner vignette */}
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
