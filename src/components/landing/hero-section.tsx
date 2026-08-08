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
import Link from "next/link"
import { ArrowUpRight, ChevronDown } from "lucide-react"
import { GlitchContainer } from "@/components/glitch/glitch-container"
import { GlitchText } from "@/components/glitch/glitch-text"
import { GlitchReveal } from "@/components/glitch/glitch-reveal"
import { ACCENT_BTN } from "./ui"

const HeroScene = dynamic(
  () => import("./hero-scene").then((mod) => ({ default: mod.HeroScene })),
  { ssr: false, loading: () => null }
)

// Интро-таймлайн: boot (фон рисуется) → headline (текст вспыхивает глитчем,
// GLB догружается) → materialize (дроид глитчится в кадр) → ready.
export type HeroPhase = "boot" | "headline" | "materialize" | "ready"

const LORE_LABEL = "// INCOMING TRANSMISSION"

// Короткие строки с серыми акцентами — читается как передача, а не как абзац.
const LORE: Array<Array<{ t: string; dim?: boolean }>> = [
  [{ t: "3333 " }, { t: "glitch-born Droidz, ", dim: true }, { t: "built on ApeChain." }],
  [{ t: "Level up. Merge. Mutate. " }, { t: "Every upgrade is written back into the chain.", dim: true }],
  [{ t: "Holders don't collect Droidz — " }, { t: "they operate them.", dim: true }],
]

export function HeroSection() {
  const heroRef = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()

  const [phase, setPhase] = useState<HeroPhase>("boot")
  const [headlineDone, setHeadlineDone] = useState(false)
  const [glbReady, setGlbReady] = useState(false)
  const [loadPct, setLoadPct] = useState(0)

  // boot → headline: даём фону и грид-полу отрисоваться первыми
  useEffect(() => {
    const t = setTimeout(() => setPhase("headline"), 120)
    return () => clearTimeout(t)
  }, [])

  // headline → materialize: и текст доигран, и модель загружена
  useEffect(() => {
    if (phase === "headline" && headlineDone && glbReady) setPhase("materialize")
  }, [phase, headlineDone, glbReady])

  // materialize → ready (отдельным эффектом: смена фазы не должна чистить свой же таймер)
  useEffect(() => {
    if (phase !== "materialize") return
    const t = setTimeout(() => setPhase("ready"), reduced ? 350 : 850)
    return () => clearTimeout(t)
  }, [phase, reduced])

  const onSceneReady = useCallback(() => setGlbReady(true), [])

  // Страховка на монтировании: если сцена не отрапортовала (медленная сеть,
  // сторонний CDN под HDRI), всё равно уходим из фазы загрузки.
  useEffect(() => {
    const t = setTimeout(() => setGlbReady(true), 9000)
    return () => clearTimeout(t)
  }, [])
  const onSceneProgress = useCallback((pct: number) => setLoadPct(pct), [])
  const onHeadlineDone = useCallback(() => setHeadlineDone(true), [])

  const headlinePlay = phase !== "boot"

  // Скролл-прогресс hero (0..1 на всю высоту обёртки)
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end end"],
  })

  const heroInView = useInView(heroRef)
  const sceneActive = heroInView || phase !== "ready"

  // Заголовок гаснет, лор въезжает слева, в конце тоже уходит
  const headlineOpacity = useTransform(scrollYProgress, [0.16, 0.3], [1, 0])
  const headlineY = useTransform(scrollYProgress, [0.16, 0.3], [0, -50])
  const loreOpacity = useTransform(scrollYProgress, [0.3, 0.42, 0.82, 0.93], [0, 1, 1, 0])
  const loreX = useTransform(scrollYProgress, [0.3, 0.42], [-40, 0])
  const indicatorOpacity = useTransform(scrollYProgress, [0, 0.05], [1, 0])

  // Абзацы лора живут внутри sticky-контейнера — whileInView тут бесполезен,
  // поэтому одноразовая защёлка по прогрессу скролла.
  const [loreOn, setLoreOn] = useState(false)
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (v > 0.32) setLoreOn(true)
  })

  return (
    <section ref={heroRef} className="relative h-[230dvh]">
      <div className="sticky top-0 h-[100dvh] overflow-hidden">
        {/* Слой 1: заголовок (дроид материализуется ПОВЕРХ него) */}
        <motion.div
          style={{ opacity: headlineOpacity, y: headlineY }}
          className="absolute inset-0 z-30 flex flex-col items-start justify-center pb-[10vh] pl-[7vw] pr-6 text-left"
        >
          <GlitchReveal play={headlinePlay} durationMs={620} delayMs={0} className="mb-2 md:mb-3">
            <span className="flex items-center gap-[0.4em] font-light tracking-tight text-[clamp(0.8rem,2vw,1.7rem)] text-white/60">
              Activated on
              <a
                href="https://apechain.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="ApeChain"
                className="pointer-events-auto inline-flex opacity-60 hover:opacity-100 transition-opacity"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/Apechain.svg"
                  alt="ApeChain"
                  draggable={false}
                  className="h-[0.95em] w-auto brightness-0 invert select-none translate-y-[0.05em]"
                />
              </a>
            </span>
          </GlitchReveal>

          <h1 className="leading-[0.95] pointer-events-none">
            {/* «Born in» — глитчит только на появлении */}
            <motion.span
              initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
              animate={headlinePlay ? { opacity: 1, y: 0, filter: "blur(0px)" } : {}}
              transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
              className="block font-normal tracking-tight text-[clamp(2.4rem,6.8vw,6.4rem)]"
            >
              Born in
            </motion.span>

            {/* «The Glitch» — появляется глитчем и продолжает подрагивать */}
            <GlitchReveal play={headlinePlay} durationMs={760} delayMs={240} onComplete={onHeadlineDone}>
              {headlineDone ? (
                <GlitchText text="The Glitch" className="font-bold tracking-tight text-[clamp(2.4rem,6.8vw,6.4rem)]" />
              ) : (
                <span className="block font-bold tracking-tight text-[clamp(2.4rem,6.8vw,6.4rem)]">
                  The Glitch
                </span>
              )}
            </GlitchReveal>
          </h1>

          {/* Круглая кнопка — новый паттерн активного действия */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={phase === "ready" ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mt-10 pointer-events-auto"
          >
            <Link href="/dashboard" className={ACCENT_BTN}>
              Go to Dashboard <ArrowUpRight size={16} />
            </Link>
          </motion.div>

          {phase === "headline" && !glbReady && (
            <div className="mt-10 font-mono text-[10px] font-black uppercase tracking-[0.3em] text-white/30 self-start">
              {loadPct > 0 ? `LOADING ${loadPct}%` : "LOADING"}
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
          className="absolute inset-y-0 left-0 z-20 pointer-events-none flex items-center w-full md:w-[52%] px-6 md:pl-[7vw]"
        >
          <div className="max-w-xl">
            <div className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/35 mb-7">
              {LORE_LABEL}
            </div>
            {LORE.map((line, i) => (
              <motion.p
                key={i}
                initial={{ opacity: 0, y: 18 }}
                animate={loreOn ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
                transition={{ duration: 0.7, delay: 0.14 * i, ease: [0.16, 1, 0.3, 1] }}
                className="font-sans text-xl md:text-[1.75rem] leading-[1.35] tracking-tight font-normal mb-7 last:mb-0"
              >
                {line.map((chunk, j) => (
                  <span key={j} className={chunk.dim ? "text-white/35" : "text-white"}>{chunk.t}</span>
                ))}
              </motion.p>
            ))}
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
                  <span className="font-mono text-[13px] font-black uppercase tracking-[0.3em]">Scroll</span>
                  <motion.span
                    animate={reduced ? undefined : { y: [0, 6, 0] }}
                    transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
                  >
                    <ChevronDown size={23} />
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
