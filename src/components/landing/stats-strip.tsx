"use client"

import { useRef } from "react"
import { motion, useInView } from "framer-motion"
import { PARTNERS, STATS, Stat } from "@/lib/landing-data"
import { useCountUp } from "@/hooks/useCountUp"
import { Marquee } from "./marquee"
import { LABEL_CLASS, Reveal } from "./ui"

function StatCell({ stat, play, index }: { stat: Stat; play: boolean; index: number }) {
  const v = useCountUp(stat.value, play && !stat.display, 1100 + index * 120)
  const text = stat.display ?? v.toLocaleString("en-US")
  return (
    <motion.div
      initial={{ opacity: 0, y: 26 }}
      animate={play ? { opacity: 1, y: 0 } : { opacity: 0, y: 26 }}
      transition={{ duration: 0.75, delay: index * 0.09, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex flex-col pt-6"
    >
      {/* тонкая линия сверху, которая «загорается» при наведении */}
      <span className="absolute inset-x-0 top-0 h-px bg-white/12" />
      <motion.span
        className="absolute left-0 top-0 h-px bg-white/70"
        initial={{ width: 0 }}
        animate={play ? { width: "38%" } : { width: 0 }}
        transition={{ duration: 0.9, delay: 0.2 + index * 0.09, ease: [0.16, 1, 0.3, 1] }}
      />

      <span className={`${LABEL_CLASS} text-white/25`}>{String(index + 1).padStart(2, "0")}</span>

      <span className="mt-7 font-semibold tracking-tight tabular-nums leading-[0.9] text-[clamp(2.6rem,5.6vw,6rem)]">
        {text}
        {stat.suffix && <span className="text-white/30">{stat.suffix}</span>}
      </span>

      <span className="mt-6 text-lg md:text-xl font-medium tracking-tight">{stat.label}</span>
      {stat.hint && <span className="mt-1.5 font-sans text-sm text-white/35">{stat.hint}</span>}
    </motion.div>
  )
}

export function StatsStrip() {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.2 })

  // Партнёров пока немного — дублируем ряд, чтобы лента шла без разрывов.
  const partnerRow = Array.from({ length: Math.max(2, Math.ceil(14 / PARTNERS.length)) }, () => PARTNERS).flat()

  return (
    <section ref={ref} className="relative pt-4 pb-20 md:pb-28">
      <div className="w-full px-[5vw]">
        <Reveal>
          <div className={`${LABEL_CLASS} text-white/35 mb-10`}>The Network in numbers</div>
        </Reveal>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 md:gap-x-14 gap-y-16">
          {STATS.map((s, i) => (
            <StatCell key={s.label} stat={s} play={inView} index={i} />
          ))}
        </div>
      </div>

      {/* Партнёры — второстепенная строка под цифрами */}
      <div className="mt-20 md:mt-28">
        <Reveal className="flex flex-col items-center">
          <div className={`${LABEL_CLASS} text-white/25 mb-8`}>Partners &amp; Friends</div>
          <Marquee durationSec={46} gapClassName="gap-14 pr-14" className="w-full" pauseOnHover>
            {partnerRow.map((p, i) => {
              const logo = (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.src}
                  alt={p.name}
                  title={p.name}
                  loading="lazy"
                  draggable={false}
                  className="h-6 md:h-7 w-auto max-w-[140px] object-contain opacity-30 grayscale hover:opacity-80 transition-all duration-300 select-none"
                />
              )
              return p.url ? (
                <a key={`${p.name}-${i}`} href={p.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  {logo}
                </a>
              ) : (
                <span key={`${p.name}-${i}`} className="shrink-0">{logo}</span>
              )
            })}
          </Marquee>
        </Reveal>
      </div>
    </section>
  )
}
