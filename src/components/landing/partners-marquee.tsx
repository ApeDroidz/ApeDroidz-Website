"use client"

import { PARTNERS } from "@/lib/landing-data"
import { Marquee } from "./marquee"
import { LABEL_CLASS, Reveal } from "./ui"

export function PartnersMarquee() {
  // Пока партнёр один — размножаем ряд, чтобы строка не была пустой.
  const row = Array.from({ length: Math.max(1, Math.ceil(8 / PARTNERS.length)) }, () => PARTNERS).flat()

  return (
    <section className="relative py-16 border-t border-white/10">
      <Reveal className="flex flex-col items-center">
        <div className={`${LABEL_CLASS} text-white/40 mb-8`}>Partners &amp; Friends</div>
        <Marquee durationSec={30} gapClassName="gap-16 pr-16" className="w-full">
          {row.map((p, i) => {
            const logo = (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.src}
                alt={p.name}
                title={p.name}
                loading="lazy"
                draggable={false}
                className="h-7 md:h-8 w-auto opacity-40 grayscale hover:opacity-100 hover:grayscale-0 transition-all duration-300 select-none"
              />
            )
            return p.url ? (
              <a key={`${p.name}-${i}`} href={p.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                {logo}
              </a>
            ) : (
              <span key={`${p.name}-${i}`} className="shrink-0">{logo}</span>
            )
          })}
        </Marquee>
      </Reveal>
    </section>
  )
}
