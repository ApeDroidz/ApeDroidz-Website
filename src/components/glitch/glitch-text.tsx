"use client"

import React from "react"

/**
 * Постоянный «живой» глитч в духе логотипа: белый текст с шершавыми краями
 * (SVG-турбулентность) и лёгким RGB-двоением, которое дрожит по steps.
 * В отличие от GlitchContainer тут ничего не рвётся на куски — эффект
 * держится всё время и остаётся читаемым.
 *
 * Стили и фильтр — в globals.css (.gt-*) и в разметке ниже соответственно.
 */
export function GlitchText({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`gt-wrap ${className}`}>
      {/* фильтр объявляем один раз рядом с текстом — он общий для всех слоёв */}
      <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
        <filter id="gt-grain" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise">
            <animate attributeName="seed" values="7;19;3;12;7" dur="1.6s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <span className="gt-base">{children}</span>
      <span className="gt-ghost gt-ghost-r" aria-hidden="true">{children}</span>
      <span className="gt-ghost gt-ghost-c" aria-hidden="true">{children}</span>
    </span>
  )
}
