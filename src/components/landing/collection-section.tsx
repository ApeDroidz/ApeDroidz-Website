"use client"

import { droidStaticUrl } from "@/lib/media"
import { MARQUEE_ROW_A, MARQUEE_ROW_B } from "@/lib/landing-data"
import { OPENSEA_COLLECTION_URL } from "@/lib/socials"
import { Marquee } from "./marquee"
import { PRIMARY_BTN, Reveal, SectionHeader } from "./ui"

function DroidCard({ id }: { id: number }) {
  return (
    <div className="w-28 md:w-40 shrink-0 rounded-xl border border-white/10 bg-[#0a0a0a] overflow-hidden hover:border-white/30 transition-colors duration-300">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={droidStaticUrl(id, 1, false)}
        alt={`ApeDroid #${id}`}
        width={160}
        height={160}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="w-full aspect-square object-cover select-none"
      />
    </div>
  )
}

export function CollectionSection() {
  return (
    <section className="relative py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeader
          label="The Collection"
          title="ApeDroidz"
          description="The main collection — 3333 animated pixel droids living on ApeChain. Every Droid levels from static L1 art to fully animated L2, with 169 SUPER mutations hiding in the set."
        />
      </div>

      <Reveal className="mt-14 space-y-4">
        <Marquee durationSec={48}>
          {MARQUEE_ROW_A.map((id) => <DroidCard key={id} id={id} />)}
        </Marquee>
        <Marquee durationSec={48} direction="right">
          {MARQUEE_ROW_B.map((id) => <DroidCard key={id} id={id} />)}
        </Marquee>
      </Reveal>

      <Reveal className="mt-14 flex justify-center" delay={0.15}>
        <a href={OPENSEA_COLLECTION_URL} target="_blank" rel="noopener noreferrer" className={PRIMARY_BTN}>
          View on OpenSea
        </a>
      </Reveal>
    </section>
  )
}
