"use client"

import { motion } from "framer-motion"

interface GlitchPowerProps {
  level: number
  progress: number // 0 to 100
}

export function GlitchPower({ level, progress }: GlitchPowerProps) {
  return (
    <div className="relative p-6 rounded-2xl border border-white/10 bg-black/60 backdrop-blur-md overflow-hidden group">
      {/* Фоновое свечение при ховере */}
      <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="relative z-10 mb-3">
        <h2 className="text-lg font-bold tracking-wider text-white/90">
          GLITCH POWER: LVL {level}
        </h2>
      </div>

      {/* Progress Bar Container */}
      <div className="relative">
        {/* Progress Bar */}
        <div className="h-6 w-full bg-white/5 rounded-full overflow-hidden border border-white/10 relative">
          {/* Animated Bar */}
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1.5, ease: "easeOut" }}
            className="h-full bg-gradient-to-r from-white/40 via-white to-white/40 relative"
          >
            {/* Эффект "тока" внутри бара */}
            <div className="absolute inset-0 w-full h-full bg-[linear-gradient(90deg,transparent_0%,rgba(0,0,0,0.5)_50%,transparent_100%)] animate-shimmer" />
          </motion.div>
        </div>

        {/* Labels под прогресс баром */}
        <div className="mt-2 flex justify-between text-xs font-mono text-white/60">
          <span>0</span>
          <span>100</span>
        </div>
      </div>
    </div>
  )
}