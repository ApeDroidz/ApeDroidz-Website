"use client"

import { ArrowUpRight } from "lucide-react"
import { CREATORS, Creator } from "@/lib/landing-data"
import { LABEL_CLASS, Reveal } from "./ui"

function CreatorCard({ creator, index }: { creator: Creator; index: number }) {
  const inner = (
    <div className="group relative h-full rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-8 md:p-10 flex flex-col justify-between gap-10 hover:border-white/25 transition-colors duration-300">
      <div className="flex items-start justify-between gap-6">
        <span className={`${LABEL_CLASS} text-white/30`}>{creator.role}</span>
        {creator.url && (
          <ArrowUpRight size={18} className="text-white/25 group-hover:text-white transition-colors shrink-0" />
        )}
      </div>

      <div>
        {creator.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={creator.logo}
            alt={creator.name}
            draggable={false}
            className="h-9 md:h-11 w-auto opacity-80 group-hover:opacity-100 transition-opacity select-none"
          />
        ) : (
          <span className="block font-semibold tracking-tight text-3xl md:text-4xl">{creator.name}</span>
        )}
        {creator.note && (
          <p className="mt-5 max-w-sm font-sans text-sm md:text-base text-white/35 leading-relaxed">{creator.note}</p>
        )}
      </div>
    </div>
  )

  return (
    <Reveal delay={0.08 * index} className="h-full">
      {creator.url ? (
        <a href={creator.url} target="_blank" rel="noopener noreferrer" className="block h-full">{inner}</a>
      ) : inner}
    </Reveal>
  )
}

export function TeamSection() {
  if (CREATORS.length === 0) return null
  return (
    <section className="relative py-20 md:py-28">
      <div className="w-full px-[5vw]">
        <Reveal>
          <div className={`${LABEL_CLASS} text-white/35 mb-4`}>Created by</div>
          <h2 className="font-semibold tracking-tight text-[clamp(2.2rem,4.6vw,4rem)] leading-none">
            The <span className="text-white/35">Makers</span>
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {CREATORS.map((c, i) => <CreatorCard key={c.name} creator={c} index={i} />)}
        </div>
      </div>
    </section>
  )
}
