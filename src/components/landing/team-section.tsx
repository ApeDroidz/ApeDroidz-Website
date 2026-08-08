"use client"

import { ArrowUpRight } from "lucide-react"
import { CREATORS, Creator } from "@/lib/landing-data"
import { LABEL_CLASS, Reveal } from "./ui"

function CreatorCard({ creator, index }: { creator: Creator; index: number }) {
  const inner = (
    <div className="group relative h-full rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-8 md:p-10 flex flex-col justify-between gap-10 hover:border-white/25 transition-colors duration-300">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          {creator.avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={creator.avatar}
              alt={creator.name}
              draggable={false}
              className="w-14 h-14 rounded-full object-cover border border-white/10 select-none"
            />
          )}
          <span className={`${LABEL_CLASS} text-white/30`}>{creator.role}</span>
        </div>
        {creator.url && (
          <ArrowUpRight size={18} className="text-white/25 group-hover:text-white transition-colors shrink-0" />
        )}
      </div>

      <div>
        {creator.logo ? (
          <span className="block">
            {creator.logoCaption && (
              <span className="block font-medium tracking-tight text-white/45 text-[0.8rem] md:text-[0.95rem] mb-2.5">
                {creator.logoCaption}
              </span>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={creator.logo}
              alt={creator.name}
              draggable={false}
              className="h-9 md:h-11 w-auto select-none"
            />
          </span>
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
            <span className="text-white/35">The</span> Makers
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {CREATORS.map((c, i) => <CreatorCard key={c.name} creator={c} index={i} />)}
        </div>
      </div>
    </section>
  )
}
