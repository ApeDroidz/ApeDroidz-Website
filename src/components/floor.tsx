"use client"

import { useRef } from "react"
import { Grid, ContactShadows } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import type { MotionValue } from "framer-motion"

const BASE_Y = -2.6   // совпадает с GROUND_Y дроида: ноги стоят на сетке
const FADE_START = 0.16
const FADE_RANGE = 0.34

interface FloorProps {
  /** 0..1 — прогресс hero; пол уезжает вниз и растворяется по мере скролла */
  scrollProgress?: MotionValue<number>
}

export function Floor({ scrollProgress }: FloorProps) {
  const groupRef = useRef<THREE.Group>(null)
  const gridRef = useRef<THREE.Mesh>(null)
  const shadowRef = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!scrollProgress || !groupRef.current) return
    const p = scrollProgress.get()
    const t = THREE.MathUtils.clamp((p - FADE_START) / FADE_RANGE, 0, 1)
    const eased = t * t * (3 - 2 * t)

    groupRef.current.position.y = BASE_Y - eased * 9

    // fadeDistance у drei Grid — uniform шейдера, его можно двигать напрямую.
    const gridMat = gridRef.current?.material as { fadeDistance?: number } | undefined
    if (gridMat && typeof gridMat.fadeDistance === "number") {
      gridMat.fadeDistance = THREE.MathUtils.lerp(18, 0.01, eased)
    }
    shadowRef.current?.traverse((child) => {
      const mesh = child as THREE.Mesh
      const mat = mesh.material as THREE.Material | undefined
      if (mesh.isMesh && mat && "opacity" in mat) {
        mat.transparent = true
        mat.opacity = 0.5 * (1 - eased)
      }
    })
  })

  return (
    <group ref={groupRef} position={[0, BASE_Y, 0]}>
      {/* Тень под роботом */}
      <group ref={shadowRef}>
        <ContactShadows resolution={1024} scale={20} blur={2} opacity={0.5} far={10} color="#000000" />
      </group>

      {/* Сетка с прозрачностью */}
      <Grid
        ref={gridRef}
        renderOrder={-1}
        infiniteGrid
        cellSize={0.7}
        sectionSize={0.7}
        fadeDistance={18}
        sectionColor={"rgba(101, 101, 101, 0.2)"}
        cellColor={"rgba(101, 101, 101, 0.2)"}
        sectionThickness={1}
        cellThickness={1}
      />
    </group>
  )
}
