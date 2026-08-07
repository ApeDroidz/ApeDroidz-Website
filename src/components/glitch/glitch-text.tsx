"use client"

import React from "react"

const BANDS = 7

/**
 * Тот же приём, что у прелоадера NFT-вьювера (api/viewer/[id]): надпись
 * набрана горизонтальными полосами — каждая клипует ту же строку и рвётся
 * вбок на своём коротком клоке. Плюс еле заметный RGB-split по краям и
 * плёночное зерно поверх. Контур букв остаётся чистым: никакой турбулентности
 * по краям, только сдвиги полос.
 *
 * Стили — в globals.css (.gt-*).
 */
export function GlitchText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`gt-wrap ${className}`}>
      {/* невидимый экземпляр держит размер строки */}
      <span className="gt-sizer">{text}</span>

      {/* сама надпись: полосы стоят встык и рвутся каждая по-своему */}
      {Array.from({ length: BANDS }, (_, i) => (
        <span key={i} className={`gt-band gt-b${i + 1}`} aria-hidden="true">{text}</span>
      ))}

      {/* RGB-split — только по краям, как в референсе */}
      <span className="gt-ghost gt-ghost-r" aria-hidden="true">{text}</span>
      <span className="gt-ghost gt-ghost-c" aria-hidden="true">{text}</span>
    </span>
  )
}
