"use client"

import { useEffect, useRef, useState } from "react"
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
      className="group relative flex flex-col"
    >
      <span className={`${LABEL_CLASS} text-white/25`}>{String(index + 1).padStart(2, "0")}</span>

      <span className="mt-7 font-semibold tracking-tight tabular-nums leading-[0.9] text-[2.4rem] md:text-[clamp(2.6rem,5.6vw,6rem)]">
        {text}
        {stat.suffix && <span className="text-white/30">{stat.suffix}</span>}
      </span>

      <span className="mt-6 text-lg md:text-xl font-medium tracking-tight">{stat.label}</span>
      {stat.hint && <span className="mt-1.5 font-sans text-sm text-white/35">{stat.hint}</span>}
    </motion.div>
  )
}

interface LiveStats {
  volume: number | null
  holders: number | null
  ath: number | null
}

/**
 * Крупные числа — коротко и всегда вниз: 159 759 → 159K, не 159.8K.
 * Единицу отдаём отдельно, чтобы она рисовалась серой, как «%» у Animated.
 */
const compact = (n: number): { value: string; unit: string } =>
  n >= 1_000_000 ? { value: String(Math.floor(n / 1_000_000)), unit: "M" }
  : n >= 1_000 ? { value: String(Math.floor(n / 1_000)), unit: "K" }
  : { value: Math.floor(n).toLocaleString("en-US"), unit: "" }

export function StatsStrip() {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.2 })
  const [live, setLive] = useState<LiveStats | null>(null)

  // Цифры коллекции — свой роут поверх OpenSea, кэш на сутки.
  useEffect(() => {
    let cancelled = false
    fetch("/api/collection-stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setLive({ volume: d.volume, holders: d.holders, ath: d.ath }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Живые значения подменяют плейсхолдеры из landing-data по ключу label.
  const withLive = (stat: Stat): Stat => {
    if (!live) return stat
    if (stat.label === "Total Volume" && live.volume != null) {
      const c = compact(live.volume)
      return { ...stat, display: c.value, suffix: c.unit }
    }
    if (stat.label === "Holders" && live.holders != null) return { ...stat, display: undefined, value: live.holders, suffix: "" }
    if (stat.label === "ATH" && live.ath != null) {
      const c = compact(live.ath)
      return { ...stat, display: c.value, suffix: c.unit }
    }
    return stat
  }

  // Партнёров пока немного — дублируем ряд, чтобы лента шла без разрывов.
  const partnerRow = Array.from({ length: Math.max(2, Math.ceil(14 / PARTNERS.length)) }, () => PARTNERS).flat()

  return (
    <section
      ref={ref}
      /* -mt: секция наезжает на хвост hero. Без этого её верх оказывается у
         нижней кромки ровно в тот момент, когда дроид уже растворился, и
         пользователь мотает почти пустой экран. */
      className="relative z-10 -mt-[38dvh] md:-mt-[45dvh] pt-0 pb-16 md:pb-28"
    >
      <div className="w-full px-[5vw]">
        <Reveal>
          <div className={`${LABEL_CLASS} text-white/35 mb-8 md:mb-10`}>The Network in numbers</div>
        </Reveal>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 md:gap-x-14 gap-y-10 md:gap-y-16">
          {STATS.map((s, i) => (
            <StatCell key={s.label} stat={withLive(s)} play={inView} index={i} />
          ))}
        </div>
      </div>

      {/* Партнёры — второстепенная строка под цифрами */}
      <div className="mt-14 md:mt-28">
        <Reveal className="flex flex-col">
          <div className={`${LABEL_CLASS} text-white/25 mb-8 px-[5vw]`}>Partners &amp; Friends</div>
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
                  style={{
                    height: `${1.75 * (p.scale ?? 1)}rem`,
                    filter: `grayscale(1) brightness(${p.brightness ?? 1})`,
                  }}
                  className="w-auto max-w-[170px] object-contain opacity-30 hover:opacity-80 transition-opacity duration-300 select-none"
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
