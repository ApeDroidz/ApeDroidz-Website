"use client"

import { memo } from "react"
import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"
import Link from "next/link"
import { droidStaticUrl } from "@/lib/media"

// Corner CTA on the landing page: announces the 3D drop and sends holders to
// the dashboard to pick which render represents their droid.
//
// The right-hand tile is a placeholder until the 3D previews are exported —
// swap PLACEHOLDER_3D for the real asset and the layout stays as is.
const PIXEL_DROID = droidStaticUrl(2, 1, false)
const PLACEHOLDER_3D = null as string | null

function Droid3DCTAComponent() {
    return (
        <motion.div
            initial={{ opacity: 0, x: -50, y: 50 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 1 }}
            className="fixed bottom-4 left-4 sm:bottom-6 sm:left-6 md:bottom-8 md:left-8 z-40 w-[160px] sm:w-[200px] md:w-[290px]"
            style={{ isolation: "isolate", willChange: "transform" }}
        >
            <Link
                href="/dashboard"
                className="group block relative overflow-hidden rounded-2xl border border-white/10 bg-black/90 backdrop-blur-xl shadow-[0_0_40px_rgba(0,0,0,0.6)] hover:border-white/20 transition-colors duration-300"
            >
                {/* ── Title ────────────────────────────────────────────────── */}
                <div className="px-2.5 pt-2.5 pb-1 sm:px-3 sm:pt-3 sm:pb-1.5">
                    <p className="text-[8px] sm:text-[12px] md:text-[14px] font-black tracking-[0.08em] uppercase leading-none whitespace-nowrap">
                        <span className="text-white drop-shadow-[0_0_5px_rgba(255,255,255,.2)]">3D Droidz</span>{" "}
                        <span className="text-[#3b82f6] drop-shadow-[0_0_8px_rgba(59,130,246,.4)]">is Live</span>
                    </p>
                </div>

                {/* ── Pixel → 3D ───────────────────────────────────────────── */}
                <div className="relative px-1.5 sm:px-1">
                    <div className="relative w-full aspect-[5/3] rounded-xl overflow-hidden border border-white/5 bg-[#090909] flex items-center justify-center gap-1.5 sm:gap-2 px-2">
                        {/* pixel version */}
                        <div className="relative h-[78%] aspect-square rounded-lg overflow-hidden border border-white/10 bg-black flex-shrink-0">
                            <img
                                src={PIXEL_DROID}
                                alt="Pixel droid"
                                draggable={false}
                                className="w-full h-full object-cover"
                                style={{ imageRendering: "pixelated" }}
                            />
                        </div>

                        <ArrowRight
                            size={14}
                            className="text-white/40 flex-shrink-0 group-hover:text-[#3b82f6] group-hover:translate-x-0.5 transition-all"
                        />

                        {/* 3D version — placeholder until the renders land */}
                        <div className="relative h-[78%] aspect-square rounded-lg overflow-hidden border border-white/10 bg-gradient-to-br from-[#12203a] to-[#0a0a0a] flex-shrink-0 flex items-center justify-center">
                            {PLACEHOLDER_3D ? (
                                <img src={PLACEHOLDER_3D} alt="3D droid" draggable={false} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-[11px] sm:text-[13px] font-black uppercase tracking-widest text-[#3b82f6] drop-shadow-[0_0_10px_rgba(59,130,246,.5)]">
                                    3D
                                </span>
                            )}
                        </div>

                        <div
                            className="absolute inset-0 pointer-events-none rounded-xl"
                            style={{ boxShadow: "inset 0 0 18px rgba(0,0,0,0.55)" }}
                        />
                    </div>
                </div>

                {/* ── Text & CTA ────────────────────────────────────────────── */}
                <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1.5 sm:gap-2 sm:px-3 sm:pb-3 sm:pt-2">
                    <h3 className="text-[15px] sm:text-[19px] md:text-[22px] font-black text-white leading-[0.92] tracking-tight uppercase">
                        Choose Your<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-200 to-white">
                            PFP Version
                        </span>
                    </h3>

                    <div className="w-full h-8 sm:h-9 flex items-center justify-center gap-2 rounded-lg font-black uppercase tracking-wider text-[10px] sm:text-[11px] transition-all duration-300 bg-white text-black group-hover:bg-[#0069FF] group-hover:text-white shadow-[0_0_20px_rgba(255,255,255,.1)] group-hover:shadow-[0_0_25px_rgba(0,105,255,.5)]">
                        Change PFP
                        <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform hidden sm:block" />
                    </div>
                </div>

                <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/20 blur-[60px] pointer-events-none" />
                <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-blue-600/20 blur-[60px] pointer-events-none" />
            </Link>
        </motion.div>
    )
}

export const Droid3DCTA = memo(Droid3DCTAComponent)
