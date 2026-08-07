"use client"

import React, { ReactNode } from "react"

interface MarqueeProps {
  children: ReactNode
  /** seconds per full loop */
  durationSec?: number
  direction?: "left" | "right"
  /** tailwind gap class applied inside each copy, e.g. "gap-4" */
  gapClassName?: string
  className?: string
  /** останавливает ленту, пока курсор над ней */
  pauseOnHover?: boolean
}

export function Marquee({
  children,
  durationSec = 40,
  direction = "left",
  gapClassName = "gap-4 pr-4",
  className = "",
  pauseOnHover = false,
}: MarqueeProps) {
  return (
    <div className={`overflow-hidden ${pauseOnHover ? "landing-marquee-pause" : ""} ${className}`}>
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
