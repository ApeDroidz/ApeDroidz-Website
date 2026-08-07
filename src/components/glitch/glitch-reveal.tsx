"use client"

import React, { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "framer-motion"

// Резкое глитч-появление: элемент вспыхивает кусками, с RGB-двоением и
// зерном, затем остаётся чистым. Ghost-слои размонтируются после анимации,
// так что в покое это обычный текст.

interface GlitchRevealProps {
  children: React.ReactNode
  /** запускает появление, когда становится true */
  play: boolean
  durationMs?: number
  delayMs?: number
  className?: string
  onComplete?: () => void
}

export function GlitchReveal({
  children,
  play,
  durationMs = 800,
  delayMs = 0,
  className = "",
  onComplete,
}: GlitchRevealProps) {
  const reduced = useReducedMotion()
  const [started, setStarted] = useState(false)
  const [done, setDone] = useState(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (!play) return
    const startTimer = setTimeout(() => setStarted(true), delayMs)
    const doneTimer = setTimeout(() => {
      setDone(true)
      onCompleteRef.current?.()
    }, delayMs + (reduced ? 0 : durationMs))
    return () => { clearTimeout(startTimer); clearTimeout(doneTimer) }
  }, [play, delayMs, durationMs, reduced])

  const style = { "--gr-dur": `${durationMs}ms` } as React.CSSProperties

  return (
    <span className={`gr-wrap ${className}`} style={style}>
      <span
        className={started && !done && !reduced ? "gr-body" : ""}
        style={{ visibility: started || done ? "visible" : "hidden", display: "block" }}
      >
        {children}
      </span>
      {started && !done && !reduced && (
        <>
          <span className="gr-ghost gr-ghost-r" aria-hidden="true">{children}</span>
          <span className="gr-ghost gr-ghost-c" aria-hidden="true">{children}</span>
        </>
      )}
    </span>
  )
}
