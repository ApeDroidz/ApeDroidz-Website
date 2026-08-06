"use client"

import { useRef } from "react"
import { useInView } from "framer-motion"
import { STATS, Stat } from "@/lib/landing-data"
import { useCountUp } from "@/hooks/useCountUp"
import { LABEL_CLASS } from "./ui"

function StatTile({ stat, play }: { stat: Stat; play: boolean }) {
  const v = useCountUp(stat.value, play)
  const text = stat.display ? String(v) : v.toLocaleString("en-US")
  return (
    <div className="flex flex-col items-center gap-2 py-10 md:py-14">
      <span className="font-black tracking-tighter text-4xl md:text-5xl tabular-nums">
        {text}
        {stat.suffix}
      </span>
      <span className={`${LABEL_CLASS} text-white/40`}>{stat.label}</span>
    </div>
  )
}

export function StatsStrip() {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  return (
    <section ref={ref} className="relative border-y border-white/10 bg-black/60 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 divide-x divide-white/10">
        {STATS.map((s) => (
          <StatTile key={s.label} stat={s} play={inView} />
        ))}
      </div>
    </section>
  )
}
