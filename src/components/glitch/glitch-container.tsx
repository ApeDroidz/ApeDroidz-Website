"use client"

import React from "react"

// Shared clip-path glitch. Extracted from upgrade-machine (the canonical copy);
// merge-machine reuses it with its own 5-step level scale via `levels`.
// Keyframes live in globals.css (.glitch-wrapper / .glitch-layer) — inlining a
// <style> tag here breaks hydration.

export interface GlitchLevel {
  /** animation-duration, e.g. "4s" */
  duration: string
  opacity: number
}

// intensity 1 = idle shimmer, 2 = agitated, 3 = violent break-up
export const GLITCH_LEVELS_DEFAULT: GlitchLevel[] = [
  { duration: "4s", opacity: 0.3 },
  { duration: "2s", opacity: 0.7 },
  { duration: "0.1s", opacity: 1 },
]

interface GlitchContainerProps {
  children: React.ReactNode
  /** 0 disables the effect entirely; 1..levels.length picks a level */
  intensity: number
  levels?: GlitchLevel[]
  className?: string
}

export function GlitchContainer({ children, intensity, levels = GLITCH_LEVELS_DEFAULT, className }: GlitchContainerProps) {
  if (intensity <= 0) return <>{children}</>
  const level = levels[Math.min(intensity, levels.length) - 1]
  return (
    <div
      className={`glitch-wrapper ${className ?? ""}`}
      style={{ "--g-dur": level.duration, "--g-op": level.opacity } as React.CSSProperties}
    >
      <div className="relative z-10 w-full h-full">{children}</div>
      <div className="glitch-layer layer-1 z-20 pointer-events-none" aria-hidden="true">{children}</div>
      <div className="glitch-layer layer-2 z-20 pointer-events-none" aria-hidden="true">{children}</div>
    </div>
  )
}
