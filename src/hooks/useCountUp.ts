"use client"

import { useEffect, useState } from "react"
import { animate, useReducedMotion } from "framer-motion"
import { EASE_OUT_EXPO } from "@/lib/animations"

/** Animated counter 0 → `to`, started by `play`. */
export function useCountUp(to: number, play: boolean, durationMs = 1200): number {
  const [value, setValue] = useState(0)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!play) return
    if (reduced) {
      setValue(to)
      return
    }
    const controls = animate(0, to, {
      duration: durationMs / 1000,
      ease: [...EASE_OUT_EXPO],
      onUpdate: (v) => setValue(Math.round(v)),
    })
    return () => controls.stop()
  }, [play, to, durationMs, reduced])

  return value
}
