"use client"

import React, { useMemo } from "react"

const ASCII = "#@%&$/\\|=+*<>[]{}01"

/**
 * Детерминированная «порча» строки: часть символов заменяется на ASCII.
 * Никакого Math.random — иначе SSR и клиент разойдутся при гидрации.
 */
function corrupt(text: string, seed: number, ratio: number): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === " ") { out += " "; continue }
    // простая хеш-функция от позиции и сида
    const h = (i * 73 + seed * 131 + ((i * seed) % 17)) % 100
    out += h < ratio * 100 ? ASCII[(h + i) % ASCII.length] : ch
  }
  return out
}

/**
 * Живой глитч заголовка: вся строка периодически срывается по горизонтали и
 * вертикали, поверх идут белые полупрозрачные дубли-полосы, рябь строками и
 * короткие вспышки, где часть букв подменяется ASCII-символами.
 * Края огрублены турбулентностью с дилатацией — читается как пикселизация.
 *
 * Стили — в globals.css (.gt-*).
 */
export function GlitchText({ text, className = "" }: { text: string; className?: string }) {
  const variants = useMemo(
    () => [corrupt(text, 3, 0.45), corrupt(text, 11, 0.7), corrupt(text, 23, 0.3)],
    [text]
  )

  return (
    <span className={`gt-wrap ${className}`}>
      <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
        <filter id="gt-grain" x="-12%" y="-12%" width="124%" height="124%">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="1" seed="7" result="noise">
            <animate attributeName="seed" values="7;19;3;12;7" dur="1.2s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" result="rough" />
          {/* дилатация слепляет шум в блоки — эффект пикселизации */}
          <feMorphology in="rough" operator="dilate" radius="1" />
        </filter>
      </svg>

      {/* вся строка ездит по обеим осям */}
      <span className="gt-base">{text}</span>

      {/* белые дубли-полосы со своими сдвигами */}
      <span className="gt-ghost gt-ghost-a" aria-hidden="true">{text}</span>
      <span className="gt-ghost gt-ghost-b" aria-hidden="true">{text}</span>

      {/* ASCII-подмены: короткие вспышки в разных полосах */}
      <span className="gt-ascii gt-ascii-a" aria-hidden="true">{variants[0]}</span>
      <span className="gt-ascii gt-ascii-b" aria-hidden="true">{variants[1]}</span>
      <span className="gt-ascii gt-ascii-c" aria-hidden="true">{variants[2]}</span>

      {/* рябь строками поверх всего */}
      <span className="gt-scan" aria-hidden="true" />
    </span>
  )
}
