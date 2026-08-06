"use client"

import Link from "next/link"
import { SOCIALS } from "@/lib/socials"

const LABEL = "font-mono text-[10px] font-black uppercase tracking-[0.2em]"

const NAV_EXPLORE: Array<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/grid", label: "Grid Maker" },
  { href: "/glitch_games/cards", label: "Glitch Games" },
]

const NAV_TOOLS: Array<{ href: string; label: string }> = [
  { href: "/upgrade_module", label: "Upgrade Module" },
  { href: "/batteries_mint", label: "Mint Batteries" },
  { href: "/merge_mechanism", label: "Merge Mechanism" },
]

export function Footer() {
  return (
    <footer className="relative border-t border-white/10 bg-black">
      <div className="max-w-6xl mx-auto px-6 py-14 grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_auto]">
        {/* Бренд */}
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/full-logo.svg" alt="ApeDroidz" className="h-8 w-auto mb-4" draggable={false} />
          <p className="font-mono text-xs text-white/40 leading-relaxed max-w-xs">
            3333 glitch-born Droidz built on ApeChain. Each one is a living fragment of the closed Droidz Network.
          </p>
        </div>

        {/* Навигация */}
        <div>
          <div className={`${LABEL} text-white/40 mb-4`}>Explore</div>
          <ul className="space-y-2.5">
            {NAV_EXPLORE.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="font-mono text-sm text-white/70 hover:text-white transition-colors">
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <span className="font-mono text-sm text-white/30 cursor-default">Staking</span>
              <span className="text-[8px] font-black uppercase tracking-widest bg-[#0069FF] text-white rounded px-1.5 py-0.5">Soon</span>
            </li>
          </ul>
        </div>

        <div>
          <div className={`${LABEL} text-white/40 mb-4`}>Tools</div>
          <ul className="space-y-2.5">
            {NAV_TOOLS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="font-mono text-sm text-white/70 hover:text-white transition-colors">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Соцсети */}
        <div>
          <div className={`${LABEL} text-white/40 mb-4`}>Connect</div>
          <div className="flex gap-2">
            {SOCIALS.map((social) => (
              <Link
                key={social.name}
                href={social.url}
                target="_blank"
                rel="noopener noreferrer"
                title={social.name}
                className="flex items-center justify-center w-[44px] h-[44px] bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/30 transition-all duration-300 text-white/60 hover:text-white group"
              >
                <social.Icon className={social.name === "OpenSea"
                  ? "w-5 h-5 brightness-0 invert-[0.6] group-hover:invert transition-all duration-300"
                  : "w-5 h-5"} />
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className={`border-t border-white/10 py-5 text-center ${LABEL} text-white/30`}>
        © 2026 ApeDroidz — All Systems Glitched
      </div>
    </footer>
  )
}
