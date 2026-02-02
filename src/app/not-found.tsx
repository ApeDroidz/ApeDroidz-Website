"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { DigitalBackground } from "@/components/digital-background"
import { heroText, lineExpand, fadeUp, withDelay } from "@/lib/animations"

export default function NotFound() {
    return (
        <div className="relative min-h-screen w-full flex flex-col items-center justify-center text-white font-sans overflow-hidden bg-black">
            <div
                className="absolute inset-0 z-0 select-none pointer-events-none mix-blend-screen"
                style={{
                    maskImage: "linear-gradient(to bottom, black 40%, transparent 70%)",
                    WebkitMaskImage: "linear-gradient(to bottom, black 40%, transparent 70%)"
                }}
            >
                <DigitalBackground />
            </div>

            <div className="relative z-10 flex flex-col items-center text-center px-4">
                {/* Glitch Effect 404 - Dramatic scale-in */}
                <motion.h1
                    className="text-[120px] md:text-[200px] font-black leading-none tracking-tighter text-white select-none drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                    initial="hidden"
                    animate="show"
                    variants={heroText}
                >
                    404
                </motion.h1>

                {/* Animated divider line */}
                <motion.div
                    className="h-px w-24 bg-gradient-to-r from-transparent via-blue-500 to-transparent my-6 origin-center"
                    initial="hidden"
                    animate="show"
                    variants={withDelay(lineExpand, 0.3)}
                />

                {/* Subtext with fade up */}
                <motion.p
                    className="text-base md:text-lg font-bold font-mono text-blue-400 mb-10 uppercase tracking-[0.1em]"
                    initial="hidden"
                    animate="show"
                    variants={withDelay(fadeUp, 0.5)}
                >
                    System Failure: Page Not Found
                </motion.p>

                {/* Button with fade up and hover effects */}
                <motion.div
                    initial="hidden"
                    animate="show"
                    variants={withDelay(fadeUp, 0.7)}
                >
                    <Link
                        href="/"
                        className="inline-flex items-center justify-center gap-2 px-10 py-4 bg-white text-black font-black uppercase tracking-widest text-sm md:text-base rounded-xl hover:bg-blue-600 hover:text-white transition-all duration-300 ease-out hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] hover:scale-105"
                    >
                        Return to Main Page <span className="transition-transform group-hover:translate-x-1">→</span>
                    </Link>
                </motion.div>
            </div>
        </div>
    )
}
