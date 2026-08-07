"use client"

import Link from "next/link"
import { SOCIALS } from "@/lib/socials"
import { Reveal } from "./landing/ui"

const LABEL = "font-mono text-[10px] font-black uppercase tracking-[0.2em]"

// Те же группы, что и в хедере: Explore / Upgrade / Tools.
const NAV_EXPLORE: Array<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/glitch_games/cards", label: "Glitch Cards" },
]

const NAV_UPGRADE: Array<{ href: string; label: string }> = [
  { href: "/upgrade_module", label: "Upgrade Module" },
  { href: "/batteries_mint", label: "Mint Batteries" },
]

const NAV_TOOLS: Array<{ href: string; label: string }> = [
  { href: "/merge_mechanism", label: "Merge Mechanism" },
  { href: "/grid", label: "Grid Maker" },
]

function NavColumn({ title, items }: { title: string; items: Array<{ href: string; label: string }> }) {
  return (
    <div>
      <div className={`${LABEL} text-white/30 mb-5`}>{title}</div>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="text-sm text-white/60 hover:text-white transition-colors">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Footer() {
  return (
    <footer className="relative px-[5vw] pb-8 pt-10">
      <Reveal>
        <div className="rounded-3xl border border-white/10 bg-white/[0.02] px-7 py-12 md:px-12 md:py-14">
          <div className="grid gap-12 md:grid-cols-[1.2fr_1fr_1fr_1fr] md:gap-8">
            {/* Бренд + соцсети */}
            <div className="flex flex-col justify-between gap-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/full-logo.svg" alt="ApeDroidz" className="h-8 w-auto" draggable={false} />

              <div className="flex gap-2">
                {SOCIALS.map((social) => (
                  <Link
                    key={social.name}
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={social.name}
                    className="flex items-center justify-center w-[42px] h-[42px] border border-white/10 rounded-xl hover:bg-white/[0.06] hover:border-white/25 transition-all duration-300 text-white/50 hover:text-white group"
                  >
                    <social.Icon className={social.name === "OpenSea"
                      ? "w-[18px] h-[18px] brightness-0 invert-[0.55] group-hover:invert transition-all duration-300"
                      : "w-[18px] h-[18px]"} />
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <div className={`${LABEL} text-white/30 mb-5`}>Explore</div>
              <ul className="space-y-3">
                {NAV_EXPLORE.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="text-sm text-white/60 hover:text-white transition-colors">
                      {item.label}
                    </Link>
                  </li>
                ))}
                <li className="flex items-center gap-2">
                  <span className="text-sm text-white/25 cursor-default">Staking</span>
                  <span className="text-[8px] font-black uppercase tracking-widest border border-white/15 text-white/40 rounded px-1.5 py-0.5">Soon</span>
                </li>
              </ul>
            </div>

            <NavColumn title="Upgrade" items={NAV_UPGRADE} />
            <NavColumn title="Tools" items={NAV_TOOLS} />
          </div>

          <div className={`mt-14 pt-7 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-3 ${LABEL} text-white/25`}>
            <span>© 2026 ApeDroidz</span>
            <span>All Systems Glitched</span>
          </div>
        </div>
      </Reveal>
    </footer>
  )
}
