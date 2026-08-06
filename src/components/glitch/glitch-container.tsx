"use client"

import React from "react"

// Shared clip-path glitch. Extracted from upgrade-machine (the canonical copy);
// merge-machine reuses it with its own 5-step level scale via `levels`.
//
// The keyframes/wrapper CSS is NOT injected by the component — render
// `<style>{GLITCH_STYLES}</style>` once per page/section (project idiom),
// then wrap anything in <GlitchContainer intensity={n}>.

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

export const GLITCH_STYLES = `
  @keyframes glitch-anim-1 { 0% { clip-path: inset(50% 0 30% 0); transform: translate(-5px, 0); } 5% { clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); } 10% { clip-path: inset(80% 0 5% 0); transform: translate(-5px, 0); } 15% { clip-path: inset(30% 0 60% 0); transform: translate(5px, 0); } 20% { clip-path: inset(60% 0 20% 0); transform: translate(-5px, 0); } 25% { clip-path: inset(10% 0 85% 0); transform: translate(5px, 0); } 30% { clip-path: inset(40% 0 40% 0); transform: translate(-5px, 0); } 35% { clip-path: inset(80% 0 10% 0); transform: translate(5px, 0); } 40% { clip-path: inset(20% 0 50% 0); transform: translate(-5px, 0); } 45% { clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); } 50% { clip-path: inset(10% 0 80% 0); transform: translate(-5px, 0); } 55% { clip-path: inset(70% 0 20% 0); transform: translate(5px, 0); } 60% { clip-path: inset(30% 0 60% 0); transform: translate(-5px, 0); } 65% { clip-path: inset(90% 0 5% 0); transform: translate(5px, 0); } 70% { clip-path: inset(15% 0 80% 0); transform: translate(-5px, 0); } 75% { clip-path: inset(55% 0 10% 0); transform: translate(5px, 0); } 80% { clip-path: inset(25% 0 50% 0); transform: translate(-5px, 0); } 85% { clip-path: inset(75% 0 15% 0); transform: translate(5px, 0); } 90% { clip-path: inset(10% 0 85% 0); transform: translate(-5px, 0); } 95% { clip-path: inset(45% 0 45% 0); transform: translate(5px, 0); } 100% { clip-path: inset(50% 0 30% 0); transform: translate(-5px, 0); } }
  @keyframes glitch-anim-2 { 0% { clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); } 5% { clip-path: inset(80% 0 10% 0); transform: translate(-5px, 0); } 10% { clip-path: inset(30% 0 60% 0); transform: translate(5px, 0); } 15% { clip-path: inset(70% 0 20% 0); transform: translate(-5px, 0); } 20% { clip-path: inset(10% 0 40% 0); transform: translate(5px, 0); } 25% { clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); } 30% { clip-path: inset(20% 0 70% 0); transform: translate(5px, 0); } 35% { clip-path: inset(90% 0 5% 0); transform: translate(-5px, 0); } 40% { clip-path: inset(30% 0 50% 0); transform: translate(5px, 0); } 45% { clip-path: inset(60% 0 20% 0); transform: translate(-5px, 0); } 50% { clip-path: inset(10% 0 85% 0); transform: translate(5px, 0); } 55% { clip-path: inset(80% 0 10% 0); transform: translate(-5px, 0); } 60% { clip-path: inset(40% 0 40% 0); transform: translate(5px, 0); } 65% { clip-path: inset(20% 0 70% 0); transform: translate(-5px, 0); } 70% { clip-path: inset(70% 0 15% 0); transform: translate(5px, 0); } 75% { clip-path: inset(10% 0 80% 0); transform: translate(-5px, 0); } 80% { clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); } 85% { clip-path: inset(25% 0 60% 0); transform: translate(-5px, 0); } 90% { clip-path: inset(85% 0 5% 0); transform: translate(5px, 0); } 95% { clip-path: inset(35% 0 50% 0); transform: translate(-5px, 0); } 100% { clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); } }

  .glitch-wrapper { position: relative; width: 100%; height: 100%; }
  .glitch-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: transparent; opacity: var(--g-op, 0.3); }
  .glitch-wrapper .layer-1 { animation: glitch-anim-1 var(--g-dur, 4s) infinite step-end alternate-reverse; }
  .glitch-wrapper .layer-2 { animation: glitch-anim-2 var(--g-dur, 4s) infinite step-end alternate-reverse; }

  @media (prefers-reduced-motion: reduce) {
    .glitch-wrapper .glitch-layer { display: none; }
  }
`

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
