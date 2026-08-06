"use client"

import React, { ReactNode } from "react"

// The track holds two identical copies of the content; each copy carries the
// inter-item gap as padding-right, so translateX(-50%) loops seamlessly.
const MARQUEE_STYLES = `
  @keyframes landing-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  .landing-marquee-track { display: flex; width: max-content; will-change: transform; animation: landing-marquee var(--marquee-dur, 40s) linear infinite; }
  .landing-marquee-track.reverse { animation-direction: reverse; }
  @media (prefers-reduced-motion: reduce) { .landing-marquee-track { animation: none; } }
`

interface MarqueeProps {
  children: ReactNode
  /** seconds per full loop */
  durationSec?: number
  direction?: "left" | "right"
  /** tailwind gap class applied inside each copy, e.g. "gap-4" */
  gapClassName?: string
  className?: string
}

export function Marquee({
  children,
  durationSec = 40,
  direction = "left",
  gapClassName = "gap-4 pr-4",
  className = "",
}: MarqueeProps) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <style>{MARQUEE_STYLES}</style>
      <div
        className={`landing-marquee-track ${direction === "right" ? "reverse" : ""}`}
        style={{ "--marquee-dur": `${durationSec}s` } as React.CSSProperties}
      >
        <div className={`flex shrink-0 items-center ${gapClassName}`}>{children}</div>
        <div className={`flex shrink-0 items-center ${gapClassName}`} aria-hidden="true">{children}</div>
      </div>
    </div>
  )
}
