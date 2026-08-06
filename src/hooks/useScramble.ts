"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "framer-motion"

const DEFAULT_CHARSET = "!<>-_\\/[]{}=+*^?#01APEDROIDZ"

interface UseScrambleOpts {
  text: string
  /** starts (or restarts) the decode when it flips to true */
  play: boolean
  durationMs?: number
  delayMs?: number
  charset?: string
  onComplete?: () => void
}

/**
 * Terminal-style decode: leading characters resolve to the real text while the
 * tail keeps cycling through glitch glyphs. Returns the string to render —
 * keep the element `font-mono` so the width stays stable while it churns.
 */
export function useScramble({
  text,
  play,
  durationMs = 900,
  delayMs = 0,
  charset = DEFAULT_CHARSET,
  onComplete,
}: UseScrambleOpts): string {
  const [output, setOutput] = useState("")
  const reduced = useReducedMotion()
  // Keep the callback out of the effect deps so an inline arrow doesn't restart the loop.
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (!play) {
      setOutput("")
      return
    }
    if (reduced) {
      setOutput(text)
      onCompleteRef.current?.()
      return
    }

    let raf = 0
    let start: number | null = null
    let frame = 0

    const tick = (now: number) => {
      if (start === null) start = now + delayMs
      const t = now - start
      if (t < 0) {
        raf = requestAnimationFrame(tick)
        return
      }
      const progress = Math.min(1, t / durationMs)
      const reveal = Math.floor(text.length * progress)
      frame++
      let out = text.slice(0, reveal)
      for (let i = reveal; i < text.length; i++) {
        const ch = text[i]
        // Deterministic per-index churn, re-rolled every other frame.
        out += ch === " " ? " " : charset[(i * 7 + (frame >> 1) * 13) % charset.length]
      }
      setOutput(out)
      if (progress >= 1) {
        onCompleteRef.current?.()
        return
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [play, text, durationMs, delayMs, charset, reduced])

  return output
}
