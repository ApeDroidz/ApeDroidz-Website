"use client"

import { motion } from "framer-motion"

export function SkeletonLoader() {
    return (
        <div className="pt-20 flex-1 flex flex-col lg:flex-row w-full max-w-[1600px] mx-auto animate-pulse">

            {/* === LEFT: GAME BOARD SKELETON (70%) === */}
            <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 min-h-[500px] relative">
                {/* Title */}
                <div className="h-10 sm:h-14 w-48 sm:w-64 bg-white/5 rounded-xl mb-2" />
                <div className="h-3 sm:h-4 w-32 sm:w-40 bg-white/5 rounded-lg mb-10" />

                {/* Grid */}
                <div className="w-full max-w-xl">
                    <div className="grid grid-cols-4 gap-3 sm:gap-4">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div
                                key={i}
                                className="aspect-[3/4] rounded-xl bg-white/5 border border-white/5"
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* === RIGHT: CONTROL PANEL SKELETON (30%) === */}
            <div className="w-full lg:w-[30%] flex flex-col gap-6 p-4 sm:p-6 border-l-0 lg:border-l border-white/[0.06]">

                {/* Balance */}
                <div className="h-[60px] rounded-2xl border border-white/5 bg-white/5" />

                {/* Daily Ticket */}
                <div className="h-[200px] rounded-2xl border border-white/5 bg-white/5 flex flex-col p-5 gap-4">
                    <div className="h-4 w-32 bg-white/5 rounded-full" />
                    <div className="flex-1 rounded-xl bg-white/5" />
                    <div className="h-10 rounded-xl bg-white/5" />
                </div>

                {/* Buy Tickets */}
                <div className="flex-1 min-h-[300px] rounded-2xl border border-white/5 bg-white/5 flex flex-col p-5 gap-4">
                    <div className="h-4 w-32 bg-white/5 rounded-full" />
                    <div className="grid grid-cols-3 gap-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-[60px] rounded-xl bg-white/5" />
                        ))}
                    </div>
                    <div className="mt-auto h-12 rounded-xl bg-white/5" />
                </div>

            </div>
        </div>
    )
}
