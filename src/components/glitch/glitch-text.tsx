"use client"

import React from "react"

/**
 * Постоянный «живой» глитч заголовка: белый текст с огрублёнными краями
 * (турбулентность + дилатация даёт блочный, пиксельный край), белые
 * полупрозрачные дубли вместо RGB-двоения и периодические вертикальные
 * срывы полос — как просадка сигнала.
 *
 * Стили — в globals.css (.gt-*).
 */
export function GlitchText({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`gt-wrap ${className}`}>
      {/* фильтр общий для всех слоёв, объявляем один раз рядом с текстом */}
      <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
        <filter id="gt-grain" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="7" result="noise">
            <animate attributeName="seed" values="7;19;3;12;7" dur="1.4s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="rough" />
          {/* дилатация «слепляет» края в блоки — читается как пикселизация */}
          <feMorphology in="rough" operator="dilate" radius="0.9" />
        </filter>
      </svg>

      <span className="gt-base">{children}</span>
      {/* дубли-полосы: белые, полупрозрачные, со сдвигом по вертикали */}
      <span className="gt-ghost gt-ghost-a" aria-hidden="true">{children}</span>
      <span className="gt-ghost gt-ghost-b" aria-hidden="true">{children}</span>
    </span>
  )
}
