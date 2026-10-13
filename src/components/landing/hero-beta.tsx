"use client"

import { useEffect, useState } from "react"
import { animate, useReducedMotion } from "framer-motion"
import { LABEL_CLASS } from "./ui"
import { POOL_MILESTONES, poolLevel } from "@/lib/survivalPoolLevels"

// Анонс публичной беты Droidz Survival в hero главной (владелец, 13.10.2026):
// видео-анонс + PLAY + слегка показать пул. Видео — тот же плеер, что на
// лендинге игры (components/survival/landing/video.tsx): на десктопе играет сразу
// без звука и только на экране, на телефоне — постер и тап (рядом и так 3D-сцена).

const nextMilestone = (ape: number) =>
  POOL_MILESTONES.find((m) => m > ape) ?? POOL_MILESTONES[POOL_MILESTONES.length - 1]
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })

/** Сумма пула с /api/survival/pool; раз в минуту, пока вкладка на виду (роут кэшируется на 30 с). */
function usePoolApe(): number | null | undefined {
  const [ape, setApe] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch("/api/survival/pool", { cache: "no-store" })
        const j = r.status === 200 ? ((await r.json()) as { poolApe?: number }) : null
        if (alive) setApe(typeof j?.poolApe === "number" ? j.poolApe : null)
      } catch {
        if (alive) setApe(null)
      }
    }
    void load()
    const id = setInterval(() => { if (document.visibilityState === "visible") void load() }, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return ape
}

/**
 * Пул одной строкой и полосой: сумма нарастает от нуля, полоса доползает до
 * следующего уровня (уровни те же, что в игре — lib/survivalPoolLevels).
 * Белая сумма, синяя только полоса (feedback: APE не красить).
 */
export function HeroPoolMeter({ play }: { play: boolean }) {
  const ape = usePoolApe()
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!play || typeof ape !== "number") return
    if (reduced) { setShown(ape); return }
    const c = animate(shown, ape, { duration: 1.8, ease: [0.16, 1, 0.3, 1], onUpdate: setShown })
    return () => c.stop()
    // shown — только стартовая точка: при обновлении пула едем от текущего значения
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, ape, reduced])

  // Нет живого сезона / API молчит — блок не показываем, hero и без него цел.
  if (ape === null) return null

  const amount = typeof ape === "number" ? ape : 0
  const goal = nextMilestone(amount)
  const lv = poolLevel(amount)
  const pct = Math.min(100, (shown / goal) * 100)

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`${LABEL_CLASS} text-white/45`}>
          Prize pool · <span className="md:hidden">Lvl {lv}</span><span className="hidden md:inline">grows every run</span>
        </span>
        <span className="whitespace-nowrap font-semibold tabular-nums tracking-tight text-white">
          <span className="text-lg md:text-xl">{typeof ape === "number" ? fmt(shown) : "—"}</span>{" "}
          <span className="text-xs md:text-sm font-bold">$APE</span>
        </span>
      </div>
      <div
        className="relative mt-2 h-1.5 rounded-full bg-white/[0.08]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={amount}
        aria-label="Prize pool toward the next level"
      >
        {/* Полоса минта батареек, как на лендинге игры (globals.css .progress-pulse). */}
        <div className="progress-pulse h-full rounded-full" style={{ width: `${Math.max(pct, play ? 2 : 0)}%` }} />
      </div>
      <div className="mt-1.5 hidden md:flex justify-between font-mono text-[10px] uppercase tracking-wider text-white/35">
        <span>Lvl {lv}</span>
        <span>Lvl {lv + 1} · {fmt(goal)}</span>
      </div>
    </div>
  )
}
