"use client"

import { honoraryStaticUrl } from "@/lib/media"
import { HONORARIES, HONORARY_OPENSEA_URL, HonoraryEntry } from "@/lib/landing-data"
import { Marquee } from "./marquee"
import { SECONDARY_BTN, Reveal, SectionHeader } from "./ui"

function HonoraryCard({ entry }: { entry: HonoraryEntry }) {
  return (
    <div className="w-36 md:w-44 shrink-0">
      <div className="rounded-xl border border-white/10 bg-[#0a0a0a] overflow-hidden hover:border-white/30 transition-colors duration-300">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={honoraryStaticUrl(entry.id)}
          alt={`${entry.name} — Honorary ApeDroid #${entry.id}`}
          width={176}
          height={176}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="w-full aspect-square object-cover select-none"
        />
      </div>
      <div className="mt-2 px-0.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-white/60 truncate">{entry.name}</span>
        <span className="font-mono text-[10px] text-white/30 shrink-0">#{entry.id}</span>
      </div>
    </div>
  )
}

export function HonorariesSection() {
  return (
    <section className="relative py-24 md:py-32 border-t border-white/10">
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeader
          label="1/1 Series"
          title="ApeChain Honoraries"
          description="Honorary ApeDroidz — 1/1 droids handed to the people who built and carried the Droidz Network."
        />
      </div>

      <Reveal className="mt-14">
        <Marquee durationSec={70}>
          {HONORARIES.map((h) => <HonoraryCard key={h.id} entry={h} />)}
        </Marquee>
      </Reveal>

      <Reveal className="mt-14 flex justify-center" delay={0.15}>
        <a href={HONORARY_OPENSEA_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_BTN}>
          View on OpenSea
        </a>
      </Reveal>
    </section>
  )
}
