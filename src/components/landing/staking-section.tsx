"use client"

import { ArrowUpRight, Lock } from "lucide-react"
import { X_URL } from "@/lib/socials"
import { GlitchContainer } from "@/components/glitch/glitch-container"
import { LABEL_CLASS, SECONDARY_BTN, Reveal } from "./ui"

// Модуль ещё закрыт: показываем «опечатанную» панель, а не пустой тизер.
const READOUT = [
  { k: "Module", v: "STAKING" },
  { k: "Status", v: "SEALED" },
  { k: "Access", v: "HOLDERS ONLY" },
]

export function StakingSection() {
  return (
    <section id="staking" className="relative py-16 md:py-28 scroll-mt-24">
      <div className="w-full px-6 md:px-[5vw]">
        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md px-6 py-10 md:px-14 md:py-16 grid lg:grid-cols-[1.1fr_minmax(0,0.9fr)] gap-10 lg:gap-16 items-center">
          {/* Смысл */}
          <div>
            <Reveal>
              <div className={`${LABEL_CLASS} text-white/35 mb-4`}>Next module</div>
              <h2 className="font-semibold tracking-tight text-[2rem] md:text-[clamp(2.2rem,4.6vw,4rem)] leading-none">
                <GlitchContainer intensity={1} className="!h-auto">
                  <span>Staking</span>
                </GlitchContainer>
              </h2>
            </Reveal>

            <Reveal className="mt-7 max-w-xl" delay={0.08}>
              <p className="font-sans text-base md:text-lg leading-relaxed">
                <span className="text-white">Put your Droidz to work. </span>
                <span className="text-white/35">
                  The mechanics are still being wired into the Network — locked until they are.
                </span>
              </p>
            </Reveal>

            <Reveal className="mt-8 md:mt-10 flex flex-wrap items-center gap-3 md:gap-4" delay={0.14}>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 md:px-6 py-3.5 md:py-4 text-xs md:text-sm font-black uppercase tracking-widest text-[#5f5f5f] select-none cursor-not-allowed">
                {/* сплошной цвет, а не opacity: у замка дужка перекрывает корпус
                    и любая прозрачность рисует шов на пересечении */}
                <Lock size={15} className="text-[#5f5f5f]" /> Locked
              </span>
              <a href={X_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_BTN}>
                Get notified <ArrowUpRight size={16} />
              </a>
            </Reveal>
          </div>

          {/* «Опечатанная» панель */}
          <Reveal delay={0.1}>
            <div className="rounded-2xl border border-white/10 bg-black/50 p-6 md:p-8">
              <div className="space-y-4">
                {READOUT.map((row) => (
                  <div key={row.k} className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-3 last:border-0">
                    <span className={`${LABEL_CLASS} text-white/30`}>{row.k}</span>
                    <span className="font-mono text-sm text-white/70">{row.v}</span>
                  </div>
                ))}
              </div>

              {/* прогресс без числа: работа идёт, деталей пока нет */}
              <div className="mt-8">
                <div className={`${LABEL_CLASS} text-white/30 mb-3`}>Wiring</div>
                <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full w-1/3 rounded-full bg-white/25 progress-pulse" />
                </div>
                <div className="mt-4 font-mono text-[11px] text-white/25">
                  // details drop when the module is live
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
