"use client"

import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { OTHERSIDE_URL, PLAY_IMAGES } from "@/lib/landing-data"
import { GlitchContainer } from "@/components/glitch/glitch-container"
import { LABEL_CLASS, PRIMARY_BTN, SECONDARY_BTN, Reveal } from "./ui"

export function PlaySection() {
  return (
    <section className="relative py-24 md:py-32 border-t border-white/10">
      <div className="max-w-5xl mx-auto px-6 flex flex-col items-center text-center">
        <Reveal>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/full-logo.svg" alt="ApeDroidz" className="h-9 md:h-11 w-auto opacity-90 mx-auto" draggable={false} />
        </Reveal>

        <Reveal className="mt-8" delay={0.1}>
          <GlitchContainer intensity={2} className="!h-auto">
            <h2 className="font-black uppercase tracking-tighter text-4xl md:text-6xl leading-none">
              Ready to the Other&nbsp;Side?
            </h2>
          </GlitchContainer>
        </Reveal>

        <Reveal className="mt-6 max-w-2xl" delay={0.15}>
          <p className="font-mono text-sm md:text-base text-white/60 leading-relaxed">
            Every Droid ships with a full 3D avatar built for Otherside. Take yours through the portal —
            or put it to work in the Glitch Games.
          </p>
        </Reveal>

        <Reveal className="mt-10 flex flex-col sm:flex-row items-center gap-4" delay={0.2}>
          <a href={OTHERSIDE_URL} target="_blank" rel="noopener noreferrer" className={PRIMARY_BTN}>
            Play <ExternalLink size={16} />
          </a>
          <Link href="/glitch_games/cards" className={SECONDARY_BTN}>
            Glitch Games
          </Link>
        </Reveal>

        <Reveal className="mt-14 grid grid-cols-1 sm:grid-cols-2 gap-4 w-full" delay={0.25}>
          {PLAY_IMAGES.map((img) => {
            const card = (
              <div
                key={img.src}
                className="group relative rounded-2xl border border-white/10 bg-black/90 overflow-hidden hover:border-white/30 transition-all duration-300"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.src}
                  alt={img.alt}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="w-full aspect-[16/9] object-cover select-none group-hover:scale-[1.03] transition-transform duration-500"
                />
                <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/90 to-transparent text-left">
                  <span className={`${LABEL_CLASS} text-white/80`}>{img.alt}</span>
                </div>
              </div>
            )
            return img.href ? (
              <Link key={img.src} href={img.href}>{card}</Link>
            ) : card
          })}
        </Reveal>
      </div>
    </section>
  )
}
