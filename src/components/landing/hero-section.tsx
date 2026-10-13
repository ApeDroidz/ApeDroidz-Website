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
import { ArrowUpRight, ChevronDown, Play } from "lucide-react"
import { GlitchContainer } from "@/components/glitch/glitch-container"
import { GlitchText } from "@/components/glitch/glitch-text"
import { GlitchReveal } from "@/components/glitch/glitch-reveal"
import { ACCENT_BTN } from "./ui"
import { HeroPoolMeter } from "./hero-beta"
import { GameplayVideo } from "@/components/survival/landing/video"
import { trackFunnel } from "@/lib/survivalFunnel"
import { isMobileDevice } from "@/lib/survivalDevice"

const HeroScene = dynamic(
  () => import("./hero-scene").then((mod) => ({ default: mod.HeroScene })),
  { ssr: false, loading: () => null }
)

// Интро-таймлайн: boot (фон рисуется) → headline (текст вспыхивает глитчем,
// GLB догружается) → materialize (дроид глитчится в кадр) → ready.
export type HeroPhase = "boot" | "headline" | "materialize" | "ready"

// PLAY ведёт прямо в игру, полной загрузкой страницы (как PlayLink лендинга игры):
// от главной с её 3D-сценой в памяти под игрой ничего не остаётся.
const PLAY_HREF = "/droidz_survival/play"

// Вторая кнопка — белый контур: синим в hero только PLAY и полоса пула.
const GHOST_BTN =
  "inline-flex items-center justify-center gap-2 rounded-full border border-white/25 text-white font-black uppercase tracking-widest hover:bg-white hover:text-black transition-colors duration-300"

const LORE_LABEL = "// INCOMING TRANSMISSION"

// Короткие строки с серыми акцентами — читается как передача, а не как абзац.
const LORE: Array<Array<{ t: string; dim?: boolean }>> = [
  [
    { t: "3333 Droidz born from a system glitch — " },
    { t: "the Network connects creators, builders, influencers and other extraordinary people.", dim: true },
  ],
  [
    { t: "Upgrade system, merges, mini-games and holder tools. " },
    { t: "The Network keeps shipping.", dim: true },
  ],
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
  const headlineOpacity = useTransform(scrollYProgress, [0.14, 0.26], [1, 0])
  const headlineY = useTransform(scrollYProgress, [0.14, 0.26], [0, -50])
  const loreOpacity = useTransform(scrollYProgress, [0.26, 0.36, 0.82, 0.93], [0, 1, 1, 0])
  const loreX = useTransform(scrollYProgress, [0.26, 0.36], [-40, 0])
  const indicatorOpacity = useTransform(scrollYProgress, [0, 0.05], [1, 0])

  // Абзацы лора живут внутри sticky-контейнера — whileInView тут бесполезен,
  // поэтому одноразовая защёлка по прогрессу скролла.
  const [loreOn, setLoreOn] = useState(false)
  // Заголовок на телефоне — одной строкой, на десктопе — в две; держим один
  // вариант в DOM, чтобы не гонять глитч дважды.
  const [isNarrow, setIsNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    const sync = () => setIsNarrow(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])
  // Телефон/планшет: видео — постер и тап (рядом и так 3D-сцена); до монтирования
  // считаем телефоном, чтобы ничего не начало качаться раньше времени.
  const [mobile, setMobile] = useState(true)
  useEffect(() => setMobile(isMobileDevice()), [])
  // Слой заголовка погас (дальше лор) — убираем его целиком: видео встаёт на паузу
  // (его IntersectionObserver видит display:none), невидимые кнопки не ловят клики.
  const [headlineGone, setHeadlineGone] = useState(false)
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (v > 0.28) setLoreOn(true)
    setHeadlineGone(v > 0.27)
  })

  return (
    <section ref={heroRef} className="relative h-[275dvh]">
      <div className="sticky top-0 h-[100dvh] overflow-hidden">
        {/* Слой 1: анонс публичной беты Droidz Survival (владелец, 13.10.2026):
            заголовок, видео-анонс, живой пул и PLAY. Дроид материализуется ПОВЕРХ
            заголовка, как и раньше; «Check Your Droidz» осталась второй кнопкой. */}
        <motion.div
          style={{ opacity: headlineOpacity, y: headlineY, display: headlineGone ? "none" : undefined }}
          className="absolute inset-0 z-30 flex flex-col items-center md:items-start justify-start md:justify-center pt-[max(10dvh,80px)] md:pt-[84px] md:pb-[2dvh] px-5 md:pl-[7vw] md:pr-6 text-center md:text-left"
        >
          <GlitchReveal play={headlinePlay} durationMs={620} delayMs={0} className="mb-2 md:mb-3">
            {/* Зелёная точка «live» — как на лендинге игры, единственный зелёный. */}
            <span className="inline-flex items-center gap-2 font-mono text-[10px] md:text-[11px] font-bold uppercase tracking-[0.25em] text-white/70">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34D399] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34D399]" />
              </span>
              New game · Live on
              <a
                href="https://apechain.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="ApeChain"
                className="pointer-events-auto inline-flex opacity-70 hover:opacity-100 transition-opacity"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/Apechain.svg"
                  alt="ApeChain"
                  draggable={false}
                  className="h-[1.15em] w-auto brightness-0 invert select-none"
                />
              </a>
            </span>
          </GlitchReveal>

          {/* Телефон — по центру в своих кеглях, десктоп — слева; один вариант в
              DOM, чтобы не гонять глитч дважды. Эффекты общие: мягкое появление у
              первой строки и живой глитч у второй. */}
          <h1 className={`pointer-events-none ${isNarrow ? "leading-[1.05] flex flex-col items-center" : "leading-[0.95]"}`}>
            <motion.span
              initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
              animate={headlinePlay ? { opacity: 1, y: 0, filter: "blur(0px)" } : {}}
              transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
              className={`block font-normal tracking-tight ${isNarrow ? "text-[7.6vw]" : "text-[clamp(1.9rem,4.1vw,4rem)]"}`}
            >
              Droidz Survival Game
            </motion.span>

            <GlitchReveal play={headlinePlay} durationMs={760} delayMs={240} onComplete={onHeadlineDone}>
              {headlineDone ? (
                <GlitchText text="Public Beta is Live" className={`font-bold tracking-tight ${isNarrow ? "text-[7.6vw]" : "text-[clamp(1.9rem,4.1vw,4rem)]"}`} />
              ) : (
                <span className={`block font-bold tracking-tight ${isNarrow ? "text-[7.6vw]" : "text-[clamp(1.9rem,4.1vw,4rem)]"}`}>
                  Public Beta is Live
                </span>
              )}
            </GlitchReveal>
          </h1>

          {/* Видео, пул и кнопки — одной колонкой. Ширина ограничена и высотой
              экрана, чтобы на ноутбуке 720 px кнопки не уезжали под край. */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={headlineDone ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mt-4 md:mt-7 w-full max-w-[420px] md:max-w-none md:w-[min(500px,38vw,calc((100dvh-440px)*1.97))] md:min-w-[340px] pointer-events-auto"
          >
            {headlineDone && <GameplayVideo tapToPlay={mobile} />}

            <div className="mt-3 md:mt-5">
              <HeroPoolMeter play={headlineDone} />
            </div>

            <div className="mt-4 md:mt-6 flex items-center justify-center md:justify-start gap-2.5 md:gap-3">
              <a
                href={PLAY_HREF}
                onClick={() => trackFunnel("play_click", { again: true })}
                className={`${ACCENT_BTN} flex-1 md:flex-none !px-6 md:!px-10 !py-3 md:!py-4 !text-xs md:!text-sm`}
              >
                <Play size={15} fill="currentColor" /> Play
              </a>
              <Link href="/dashboard" className={`${GHOST_BTN} flex-1 md:flex-none whitespace-nowrap px-5 md:px-7 py-3 md:py-4 text-[11px] md:text-xs`}>
                {/* На телефоне коротко — полное название переносилось в две строки. */}
                <span className="md:hidden">My Droidz</span>
                <span className="hidden md:inline">Check Your Droidz</span>
                <ArrowUpRight size={15} />
              </Link>
            </div>
          </motion.div>
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

        {/* Индикатор загрузки модели — там, где появится дроид */}
        {phase === "headline" && !glbReady && (
          <div className="absolute inset-x-0 bottom-[22dvh] md:inset-y-0 md:bottom-auto md:right-0 md:left-auto z-20 flex md:w-[45%] items-center justify-center pointer-events-none">
            <span className="font-mono text-[10px] font-black uppercase tracking-[0.3em] text-white/25">
              {loadPct > 0 ? `LOADING ${loadPct}%` : "LOADING"}
            </span>
          </div>
        )}

        {/* Слой 3: лор-блок (акт 2) */}
        <motion.div
          style={{ opacity: loreOpacity, x: loreX }}
          className="absolute inset-x-0 top-0 bottom-auto md:bottom-0 z-20 pointer-events-none flex items-start md:items-center pt-[14dvh] md:pt-0 md:pb-[10dvh] w-full md:w-[52%] px-6 md:pl-[7vw]"
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
                className="font-sans text-[1.05rem] md:text-[1.75rem] leading-[1.4] md:leading-[1.35] tracking-tight font-normal mb-5 md:mb-7 last:mb-0"
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
                {/* Тень: на телефоне индикатор ложится на белую грудь дроида */}
                <div className="flex flex-col items-center gap-1.5 text-white/60 drop-shadow-[0_2px_7px_rgba(0,0,0,0.95)]">
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
