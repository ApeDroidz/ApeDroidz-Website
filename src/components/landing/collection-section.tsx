"use client"

import { ArrowUpRight } from "lucide-react"
import { droidAnimatedWebpUrl } from "@/lib/media"
import { DROID_CONTRACT, MARQUEE_ROW_A, MARQUEE_ROW_B, MarqueeDroid, openseaItemUrl } from "@/lib/landing-data"
import { OPENSEA_COLLECTION_URL } from "@/lib/socials"
import { Marquee } from "./marquee"
import { LABEL_CLASS, SECONDARY_BTN, Reveal } from "./ui"

function DroidCard({ droid }: { droid: MarqueeDroid }) {
  const { id } = droid
  return (
    <a
      href={openseaItemUrl(DROID_CONTRACT, id)}
      target="_blank"
      rel="noopener noreferrer"
      title={`ApeDroid #${id} on OpenSea`}
      className="group relative w-40 md:w-56 shrink-0 rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden hover:border-white/40 transition-colors duration-300"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={droidAnimatedWebpUrl(id, droid.super)}
        alt={`ApeDroid #${id}`}
        width={224}
        height={224}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="w-full aspect-square object-cover select-none"
      />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2.5 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <span className="font-mono text-xs text-white/80">#{id}</span>
        <ArrowUpRight size={14} className="text-white/80" />
      </div>
    </a>
  )
}

export function CollectionSection() {
  return (
    <section className="relative py-20 md:py-28">
      <div className="w-full px-[5vw] flex flex-col md:flex-row md:items-start md:justify-between gap-8">
        <Reveal>
          <div className={`${LABEL_CLASS} text-white/35 mb-4`}>Main Collection</div>
          <h2 className="font-semibold tracking-tight text-[clamp(2.2rem,4.6vw,4rem)] leading-none">ApeDroidz</h2>
          <p className="mt-6 max-w-xl font-sans text-base md:text-lg leading-relaxed">
            <span className="text-white">3333 glitch-born droids on ApeChain. </span>
            <span className="text-white/35">
              Every Droid starts as pixel art, upgrades into a fully animated version and ships with a 3D body
              made for Otherside. 169 SUPER mutations hide in the set.
            </span>
          </p>
        </Reveal>
        <Reveal delay={0.1} className="md:pt-8 shrink-0">
          <a
            href={OPENSEA_COLLECTION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={SECONDARY_BTN}
          >
            View all <ArrowUpRight size={16} />
          </a>
        </Reveal>
      </div>

      <Reveal className="mt-14 space-y-4">
        <Marquee durationSec={64} pauseOnHover>
          {MARQUEE_ROW_A.map((d) => <DroidCard key={d.id} droid={d} />)}
        </Marquee>
        <Marquee durationSec={64} direction="right" pauseOnHover>
          {MARQUEE_ROW_B.map((d) => <DroidCard key={d.id} droid={d} />)}
        </Marquee>
      </Reveal>
    </section>
  )
}
