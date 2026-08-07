"use client"

import React, { useMemo } from "react"

const ASCII = "#@%&$/\\|=+*<>[]{}01"
const SLICES = 6

/**
 * Детерминированная «порча» строки: часть символов заменяется на ASCII.
 * Никакого Math.random — иначе SSR и клиент разойдутся при гидрации.
 */
function corrupt(text: string, seed: number, ratio: number): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === " ") { out += " "; continue }
    const h = (i * 73 + seed * 131 + ((i * seed) % 17)) % 100
    out += h < ratio * 100 ? ASCII[(h + i) % ASCII.length] : ch
  }
  return out
}

/**
 * Живой глитч заголовка.
 *
 * Ключевое: самой «цельной» надписи нет — она собрана из горизонтальных
 * полос (по одной копии на полосу). В покое полосы стоят встык и читаются
 * как обычный текст, а в момент срыва разъезжаются по горизонтали и
 * вертикали, то есть рвётся именно белая заливка, а не её призрак.
 * Поверх — короткие ASCII-подмены и рябь строк развёртки.
 *
 * Стили — в globals.css (.gt-*).
 */
export function GlitchText({ text, className = "" }: { text: string; className?: string }) {
  const variants = useMemo(
    () => [corrupt(text, 3, 0.5), corrupt(text, 11, 0.75), corrupt(text, 23, 0.35)],
    [text]
  )

  return (
    <span className={`gt-wrap ${className}`}>
      <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
        <filter id="gt-grain" x="-12%" y="-12%" width="124%" height="124%">
          <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="1" seed="7" result="noise">
            <animate attributeName="seed" values="7;19;3;12;7" dur="1.2s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="rough" />
          {/* дилатация слепляет шум в блоки — эффект пикселизации */}
          <feMorphology in="rough" operator="dilate" radius="0.9" />
        </filter>
      </svg>

      {/* держит размер строки; сам текст невидим */}
      <span className="gt-sizer">{text}</span>

      {/* надпись собрана из полос — они и разъезжаются */}
      {Array.from({ length: SLICES }, (_, i) => (
        <span key={i} className={`gt-slice gt-slice-${i}`} aria-hidden="true">{text}</span>
      ))}

      {/* ASCII-подмены: короткие вспышки в разных полосах */}
      <span className="gt-ascii gt-ascii-a" aria-hidden="true">{variants[0]}</span>
      <span className="gt-ascii gt-ascii-b" aria-hidden="true">{variants[1]}</span>
      <span className="gt-ascii gt-ascii-c" aria-hidden="true">{variants[2]}</span>

      {/* рябь строками поверх всего */}
      <span className="gt-scan" aria-hidden="true" />
    </span>
  )
}
