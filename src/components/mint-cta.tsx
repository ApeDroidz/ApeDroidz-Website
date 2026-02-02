"use client"

import { useState, memo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

function MintCTAComponent() {
    const [isVisible, setIsVisible] = useState(true)

    if (!isVisible) return null

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0, x: -50, y: 50 }}
                    animate={{ opacity: 1, x: 0, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 1 }}
                    className="fixed bottom-4 left-4 sm:bottom-6 sm:left-6 md:bottom-8 md:left-8 z-40 flex flex-col w-[140px] sm:w-[220px] md:w-[280px]"
                    style={{
                        isolation: 'isolate',
                        willChange: 'transform',
                        backfaceVisibility: 'hidden',
                        transform: 'translateZ(0)'
                    }}
                >
                    {/* Main Card */}
                    <Link href="/batteries_mint" className="block relative overflow-hidden rounded-2xl border border-white/10 bg-black/80 backdrop-blur-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] group hover:border-white/20 transition-colors duration-300">

                        {/* Content Container */}
                        <div className="flex flex-col p-1">
                            {/* IMAGE/GIF */}
                            <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-white/5">
                                <img
                                    src="/DRD-UPD.gif"
                                    alt="Droid Upgrade Preview"
                                    className="w-full h-full object-cover scale-105 group-hover:scale-100 transition-transform duration-500"
                                />

                                {/* Floating Badge */}
                                <div className="absolute top-2 left-2 px-2 py-0.5 bg-blue-600/90 backdrop-blur-md rounded text-[9px] font-black uppercase text-white shadow-lg border border-blue-400/30">
                                    New Arrival
                                </div>
                            </div>

                            {/* TEXT & ACTION */}
                            <div className="flex flex-col gap-3 p-4 pt-3">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs font-mono text-blue-400 tracking-widest uppercase">Limited Supply</span>
                                    <h3 className="text-2xl font-black text-white leading-[0.9] tracking-tight uppercase drop-shadow-lg">
                                        Mint Your <br />
                                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-200 to-white animate-pulse">Energy Batteries</span>
                                    </h3>
                                </div>

                                <div className="group/btn relative w-full h-10 flex items-center justify-center gap-2 bg-white hover:bg-blue-600 text-black hover:text-white rounded-lg font-black uppercase tracking-wider text-xs transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(37,99,235,0.5)]">
                                    Mint Now
                                    <ArrowRight size={14} className="group-hover/btn:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </div>

                        {/* Decorative Glow */}
                        <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/20 blur-[60px] pointer-events-none" />
                        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-blue-600/20 blur-[60px] pointer-events-none" />
                    </Link>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

// Memoize to prevent parent re-renders from causing GIF flicker
export const MintCTA = memo(MintCTAComponent)