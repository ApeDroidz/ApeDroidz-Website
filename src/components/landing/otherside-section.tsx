"use client"

import dynamic from "next/dynamic"
import { ArrowUpRight } from "lucide-react"
import { OTHERSIDE_URL } from "@/lib/landing-data"
import { GlitchReveal } from "@/components/glitch/glitch-reveal"
import { PRIMARY_BTN, Reveal } from "./ui"

// Канвас превьюера — только на клиенте, как и hero-сцена.
const DroidViewer = dynamic(() => import("./droid-viewer").then((m) => ({ default: m.DroidViewer })), {
  ssr: false,
  loading: () => (
    <div className="w-full rounded-2xl border border-white/10 bg-[#0a0a0a]/90 aspect-square lg:aspect-[5/4]" />
  ),
})

export function OthersideSection() {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      {/* мягкая подсветка за превьюером */}
      <div
        className="absolute right-0 top-1/2 -translate-y-1/2 w-[60vw] h-[60vw] max-w-[900px] max-h-[900px] pointer-events-none opacity-40"
        style={{ background: "radial-gradient(circle, rgba(59,130,246,0.16) 0%, rgba(0,0,0,0) 65%)" }}
      />

      <div className="relative w-full px-[5vw] grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-12 lg:gap-20 items-center">
        {/* Левая колонка — смысл */}
        <div>
          <Reveal>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/otherside.svg"
              alt="Otherside"
              draggable={false}
              className="h-7 md:h-9 w-auto select-none opacity-70"
            />
          </Reveal>

          <Reveal className="mt-8" delay={0.08}>
            <h2 className="font-semibold tracking-tight leading-[1.05] text-[clamp(2.4rem,5vw,4.5rem)]">
              <GlitchReveal play durationMs={700}>
                <span className="block">Ready to the Otherside</span>
              </GlitchReveal>
            </h2>
          </Reveal>

          <Reveal className="mt-7 max-w-xl" delay={0.14}>
            <p className="font-sans text-lg md:text-xl leading-[1.45] tracking-tight">
              <span className="text-white">Every Droid ships with a full 3D body. </span>
              <span className="text-white/35">
                Punch in any token number and inspect the model right here — the same file the metaverse loads.
              </span>
            </p>
          </Reveal>

          <Reveal className="mt-10" delay={0.2}>
            <a href={OTHERSIDE_URL} target="_blank" rel="noopener noreferrer" className={PRIMARY_BTN}>
              Enter the Otherside <ArrowUpRight size={16} />
            </a>
          </Reveal>
        </div>

        {/* Правая колонка — живой превьюер */}
        <Reveal delay={0.1}>
          <DroidViewer />
        </Reveal>
      </div>
    </section>
  )
}
