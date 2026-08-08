"use client"

import Image from "next/image"
import { honoraryStaticUrl } from "@/lib/media"
import { HONORARIES, HONORARY_OPENSEA_URL, HonoraryEntry } from "@/lib/landing-data"
import { XIcon } from "@/lib/socials"
import { Marquee } from "./marquee"
import { LABEL_CLASS, SECONDARY_BTN, Reveal } from "./ui"
import { ArrowUpRight } from "lucide-react"

const handleOf = (entry: HonoraryEntry) =>
  entry.x ? `@${entry.x.replace(/\/+$/, "").split("/").pop()}` : `#${entry.id}`

function HonoraryCard({ entry }: { entry: HonoraryEntry }) {
  const Wrapper = entry.x ? "a" : "div"
  return (
    <Wrapper
      {...(entry.x ? { href: entry.x, target: "_blank", rel: "noopener noreferrer" } : {})}
      title={entry.x ? `${entry.name} on X` : entry.name}
      className="group w-28 md:w-36 shrink-0 flex flex-col items-center text-center"
    >
      <div className="relative">
        <div className="rounded-full overflow-hidden border border-white/10 group-hover:border-white/40 transition-colors duration-300 w-24 h-24 md:w-32 md:h-32 bg-[#0a0a0a]">
          <Image
            src={honoraryStaticUrl(entry.id)}
            alt={`${entry.name} — Honorary ApeDroid #${entry.id}`}
            width={160}
            height={160}
            sizes="(max-width: 768px) 96px, 128px"
            loading="lazy"
            draggable={false}
            className="w-full h-full object-cover select-none scale-[1.02] group-hover:scale-110 transition-transform duration-500"
          />
        </div>
        {entry.x && (
          <span className="absolute -bottom-1 -right-1 flex items-center justify-center w-7 h-7 rounded-full bg-black border border-white/15 text-white/50 opacity-0 group-hover:opacity-100 group-hover:text-white transition-all duration-300">
            <XIcon className="w-3 h-3" />
          </span>
        )}
      </div>
      <div className="mt-3 w-full">
        <div className="font-medium text-xs md:text-sm tracking-tight text-white/70 group-hover:text-white transition-colors truncate">
          {entry.name}
        </div>
        <div className="font-mono text-[10px] text-white/25 group-hover:text-[#3b82f6] transition-colors truncate">
          {handleOf(entry)}
        </div>
      </div>
    </Wrapper>
  )
}

export function HonorariesSection() {
  const half = Math.ceil(HONORARIES.length / 2)
  const rowA = HONORARIES.slice(0, half)
  const rowB = HONORARIES.slice(half)

  return (
    <section className="relative py-14 md:py-28 overflow-hidden">
      {/* мягкое свечение за «залом славы» */}
      <div
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[420px] pointer-events-none opacity-50"
        style={{ background: "radial-gradient(ellipse at center, rgba(59,130,246,0.10) 0%, rgba(0,0,0,0) 70%)" }}
      />

      <div className="relative w-full px-6 md:px-[5vw] flex flex-col md:flex-row md:items-start md:justify-between gap-6 md:gap-8">
        <Reveal>
          <div className={`${LABEL_CLASS} text-white/35 mb-4`}>1/1 Series</div>
          <h2 className="font-semibold tracking-tight text-[2rem] md:text-[clamp(2.2rem,4.6vw,4rem)] leading-none">
            ApeChain <span className="text-white/35">Honoraries</span>
          </h2>
          <p className="mt-5 md:mt-6 max-w-xl font-sans text-[0.95rem] md:text-lg leading-relaxed">
            <span className="text-white">Hand-made 1/1 Droidz for the people who built and carried the Network — </span>
            <span className="text-white/35">
              founders, artists and collectors across ApeChain. Each one is named after its owner.
            </span>
          </p>
        </Reveal>
        <Reveal delay={0.1} className="md:pt-8 shrink-0 [&_a]:px-6 [&_a]:py-3.5 md:[&_a]:px-9 md:[&_a]:py-4 [&_a]:text-xs md:[&_a]:text-sm">
          <a
            href={HONORARY_OPENSEA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={SECONDARY_BTN}
          >
            View all <ArrowUpRight size={16} />
          </a>
        </Reveal>
      </div>

      <Reveal className="relative mt-10 md:mt-14 space-y-6 md:space-y-8">
        <Marquee durationSec={90} gapClassName="gap-6 pr-6" pauseOnHover>
          {rowA.map((h) => <HonoraryCard key={h.id} entry={h} />)}
        </Marquee>
        <Marquee durationSec={90} direction="right" gapClassName="gap-6 pr-6" pauseOnHover>
          {rowB.map((h) => <HonoraryCard key={h.id} entry={h} />)}
        </Marquee>
      </Reveal>
    </section>
  )
}
