"use client"

import { ReactNode } from "react"
import { motion } from "framer-motion"
import { fadeUp, staggerContainer } from "@/lib/animations"
import { GlitchContainer } from "@/components/glitch/glitch-container"

// Кнопки лендинга — идиомы проекта (см. dashboard/upgrade module)
export const PRIMARY_BTN =
  "inline-flex items-center justify-center gap-2 bg-white text-black font-black uppercase tracking-widest text-sm rounded-xl px-8 py-4 hover:bg-[#0069FF] hover:text-white transition-colors duration-300 shadow-[0_0_20px_rgba(255,255,255,0.2)]"

export const SECONDARY_BTN =
  "inline-flex items-center justify-center gap-2 bg-transparent border border-white/15 text-white/80 font-black uppercase tracking-widest text-sm rounded-xl px-8 py-4 hover:bg-white/10 hover:border-white/30 hover:text-white transition-colors duration-300"

export const LABEL_CLASS =
  "font-mono text-[10px] font-black uppercase tracking-[0.2em]"

interface SectionHeaderProps {
  label: string
  title: string
  description?: string
  center?: boolean
  /** 0 — без глитча, 1..3 — интенсивность GlitchContainer на заголовке */
  glitch?: number
}

export function SectionHeader({ label, title, description, center = true, glitch = 0 }: SectionHeaderProps) {
  const heading = (
    <h2 className="font-semibold tracking-tight text-4xl md:text-6xl leading-none">
      {title}
    </h2>
  )
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.4 }}
      variants={staggerContainer}
      className={center ? "flex flex-col items-center text-center" : ""}
    >
      <motion.div variants={fadeUp} className={`${LABEL_CLASS} text-white/35 mb-4`}>
        {label}
      </motion.div>
      <motion.div variants={fadeUp} className="mb-5">
        {glitch > 0 ? (
          <GlitchContainer intensity={glitch} className="!h-auto">{heading}</GlitchContainer>
        ) : heading}
      </motion.div>
      {description && (
        <motion.p
          variants={fadeUp}
          className="max-w-2xl font-mono text-sm md:text-base text-white/60 leading-relaxed"
        >
          {description}
        </motion.p>
      )}
    </motion.div>
  )
}

/** Обёртка секции с whileInView-появлением контента ниже заголовка. */
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
