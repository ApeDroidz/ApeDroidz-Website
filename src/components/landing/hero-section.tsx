"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import {
  motion,
  useInView,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion"
import { ChevronDown } from "lucide-react"
import { useScramble } from "@/hooks/useScramble"
import { GlitchContainer, GLITCH_STYLES } from "@/components/glitch/glitch-container"

const HeroScene = dynamic(
  () => import("./hero-scene").then((mod) => ({ default: mod.HeroScene })),
  { ssr: false, loading: () => null }
)

// Интро-таймлайн: boot (фон рисуется) → headline (текст печатается, GLB качается)
// → materialize (дроид глитчится в кадр) → ready (scroll-индикатор).
export type HeroPhase = "boot" | "headline" | "materialize" | "ready"

const HEADLINE_1 = "BORN IN THE GLITCH."
const HEADLINE_2 = "ACTIVATED ON APECHAIN."

const LORE_LABEL = "// INCOMING TRANSMISSION"
const LORE_1 = "3333 glitch-born Droidz built on ApeChain. Each one is a living fragment of the closed Droidz Network."
const LORE_2 = "They level up, merge and mutate. Every upgrade is written back into the chain — no two fragments of the Network ever run the same."
const LORE_3 = "Holders don't just collect Droidz. They operate them — through the games, tools and machines of the Network."

/** Резервирует место под финальный текст, чтобы перебор символов не дёргал layout. */
function ScrambleLine({ final, current, className = "" }: { final: string; current: string; className?: string }) {
  return (
    <span className={`relative block whitespace-nowrap ${className}`}>
      <span className="invisible">{final}</span>
      <span className="absolute inset-0">{current}</span>
    </span>
  )
}

export function HeroSection() {
  const heroRef = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()

  const [phase, setPhase] = useState<HeroPhase>("boot")
  const [headlineDone, setHeadlineDone] = useState(false)
  const [glbReady, setGlbReady] = useState(false)
  const [loadPct, setLoadPct] = useState(0)
  const [loreOn, setLoreOn] = useState(false)

  // boot → headline: даём фону и грид-полу отрисоваться первыми
  useEffect(() => {
    const t = setTimeout(() => setPhase("headline"), 120)
    return () => clearTimeout(t)
  }, [])

  // headline → materialize → ready: и текст доигран, и модель загружена
  useEffect(() => {
    if (phase === "headline" && headlineDone && glbReady) {
      setPhase("materialize")
      const t = setTimeout(() => setPhase("ready"), reduced ? 350 : 850)
      return () => clearTimeout(t)
    }
  }, [phase, headlineDone, glbReady, reduced])

  const onSceneReady = useCallback(() => setGlbReady(true), [])
  const onSceneProgress = useCallback((pct: number) => setLoadPct(pct), [])

  const headlinePlay = phase !== "boot"
  const line1 = useScramble({ text: HEADLINE_1, play: headlinePlay, durationMs: 900 })
  const line2 = useScramble({
    text: HEADLINE_2,
    play: headlinePlay,
    delayMs: 450,
    durationMs: 1350,
    onComplete: () => setHeadlineDone(true),
  })

  // Скролл-прогресс актов 1-2 (0..1 на всю высоту hero-обёртки)
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end end"],
  })

  const heroInView = useInView(heroRef)
  const sceneActive = heroInView || phase !== "ready"

  // Акт 2: заголовок гаснет, лор появляется слева
  const headlineOpacity = useTransform(scrollYProgress, [0.18, 0.42], [1, 0])
  const headlineY = useTransform(scrollYProgress, [0.18, 0.42], [0, -60])
  const loreOpacity = useTransform(scrollYProgress, [0.32, 0.5], [0, 1])
  const loreX = useTransform(scrollYProgress, [0.32, 0.5], [-40, 0])
  const indicatorOpacity = useTransform(scrollYProgress, [0, 0.06], [1, 0])

  // Одноразовая защёлка декода лора
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (v > 0.38) setLoreOn(true)
  })

  const p1 = useScramble({ text: LORE_1, play: loreOn, durationMs: 1000 })
  const p2 = useScramble({ text: LORE_2, play: loreOn, delayMs: 300, durationMs: 1100 })
  const p3 = useScramble({ text: LORE_3, play: loreOn, delayMs: 600, durationMs: 1200 })

  return (
    <section ref={heroRef} className="relative h-[220dvh]">
      <style>{GLITCH_STYLES}</style>

      <div className="sticky top-0 h-[100dvh] overflow-hidden">
        {/* Слой 1: заголовок (дроид материализуется ПОВЕРХ него) */}
        <motion.div
          style={{ opacity: headlineOpacity, y: headlineY }}
          className="absolute inset-0 z-0 flex flex-col items-center justify-center px-4 text-center"
        >
          <GlitchContainer intensity={phase === "materialize" ? 3 : 1} className="!h-auto">
            <h1 className="font-black uppercase tracking-tighter leading-[1.02] text-[8.5vw] md:text-[5.2vw]">
              <ScrambleLine final={HEADLINE_1} current={line1} />
              <ScrambleLine final={HEADLINE_2} current={line2} className="text-[#3b82f6]" />
            </h1>
          </GlitchContainer>

          {phase === "headline" && !glbReady && (
            <div className="mt-8 font-mono text-[10px] font-black uppercase tracking-[0.3em] text-white/40">
              LOADING {loadPct}%
            </div>
          )}
        </motion.div>

        {/* Слой 2: 3D-сцена */}
        <div className="absolute inset-0 z-10 pointer-events-none">
          <HeroScene
            phase={phase}
            scrollProgress={scrollYProgress}
            active={sceneActive}
            burst={!reduced}
            onReady={onSceneReady}
            onProgress={onSceneProgress}
          />
        </div>

        {/* Слой 3: лор-блок (акт 2) */}
        <motion.div
          style={{ opacity: loreOpacity, x: loreX }}
          className="absolute inset-y-0 left-0 z-20 flex items-center w-full max-w-xl px-6 md:pl-[7vw]"
        >
          <div>
            <div className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-[#00FF94] mb-5">
              {LORE_LABEL}
            </div>
            <p className="font-mono text-sm md:text-base text-white/70 leading-relaxed mb-4">{p1}</p>
            <p className="font-mono text-sm md:text-base text-white/70 leading-relaxed mb-4">{p2}</p>
            <p className="font-mono text-sm md:text-base text-white/70 leading-relaxed">{p3}</p>
          </div>
        </motion.div>

        {/* Слой 3: scroll-индикатор */}
        <motion.div
          style={{ opacity: indicatorOpacity }}
          className="absolute inset-x-0 bottom-7 z-20 flex justify-center pointer-events-none"
        >
          {phase === "ready" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
              <GlitchContainer intensity={1}>
                <div className="flex flex-col items-center gap-1.5 text-white/60">
                  <span className="font-mono text-[10px] font-black uppercase tracking-[0.3em]">Scroll</span>
                  <motion.span
                    animate={reduced ? undefined : { y: [0, 6, 0] }}
                    transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
                  >
                    <ChevronDown size={18} />
                  </motion.span>
                </div>
              </GlitchContainer>
            </motion.div>
          )}
        </motion.div>
      </div>
    </section>
  )
}
