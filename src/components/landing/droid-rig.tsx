"use client"

import { useEffect, useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { useGLTF } from "@react-three/drei"
import * as THREE from "three"
import type { MotionValue } from "framer-motion"
import type { HeroPhase } from "./hero-section"

interface DroidRigProps {
  phase: HeroPhase
  /** 0..1 — прогресс скролла hero-секции (акты 1-2) */
  scrollProgress: MotionValue<number>
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)

// Слайд дроида вправо за экран: прогресс скролла 0.35 → 0.85
const SLIDE_START = 0.35
const SLIDE_RANGE = 0.5

export function DroidRig({ phase, scrollProgress }: DroidRigProps) {
  const groupRef = useRef<THREE.Group>(null)
  const { scene } = useGLTF("/white-droid.glb")

  // Канвас лежит под текстовыми слоями, поэтому указатель слушаем на window —
  // взгляд дроида работает, даже когда курсор над текстом.
  const pointer = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = -(e.clientY / window.innerHeight) * 2 + 1
    }
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [])

  const bones = useRef<{
    head: THREE.Object3D | null;
    spine: THREE.Object3D | null;
  }>({ head: null, spine: null })

  const initialRotation = useRef<{
    head: { x: number, y: number, z: number } | null;
    spine: { x: number, y: number, z: number } | null;
  }>({ head: null, spine: null })

  useMemo(() => {
    scene.traverse((child) => {
      if (child.isObject3D) {
        const name = child.name.toLowerCase()
        if (name.includes("head") || name.includes("голова") || name === "head") {
          bones.current.head = child
          if (!initialRotation.current.head) {
            initialRotation.current.head = { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z }
          }
        }
        if (name.includes("spine") || name.includes("chest") || name.includes("torso") || name.includes("корпус")) {
          bones.current.spine = child
          if (!initialRotation.current.spine) {
            initialRotation.current.spine = { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z }
          }
        }
      }
    })
  }, [scene])

  // Материалы для фейда материализации (transparent возвращаем как было)
  const materials = useMemo(() => {
    const set = new Set<THREE.Material>()
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach((m) => set.add(m))
        else if (mat) set.add(mat)
      }
    })
    return Array.from(set).map((mat) => ({ mat, wasTransparent: mat.transparent }))
  }, [scene])

  const fadeStart = useRef<number | null>(null)
  const fadeDone = useRef(false)

  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) return

    const visible = phase === "materialize" || phase === "ready"
    group.visible = visible
    if (!visible) return

    // Материализация: opacity 0 → 1 за ~450мс под глитч-бёрст
    if (!fadeDone.current) {
      if (fadeStart.current === null) {
        fadeStart.current = state.clock.elapsedTime
        materials.forEach(({ mat }) => { mat.transparent = true; mat.opacity = 0 })
      }
      const t = Math.min(1, (state.clock.elapsedTime - fadeStart.current) / 0.45)
      materials.forEach(({ mat }) => { mat.opacity = t })
      if (t >= 1) {
        fadeDone.current = true
        materials.forEach(({ mat, wasTransparent }) => {
          mat.transparent = wasTransparent
          mat.opacity = 1
        })
      }
    }

    const mouseX = pointer.current.x
    const mouseY = pointer.current.y
    const breathe = Math.sin(state.clock.elapsedTime * 2) * 0.01

    if (bones.current.head && initialRotation.current.head) {
      const init = initialRotation.current.head
      const targetY = init.y + (mouseY * (Math.PI / 5))
      const targetX = init.x + (mouseX * (Math.PI / 6))

      const smoothSpeed = delta * 6

      bones.current.head.rotation.y = THREE.MathUtils.lerp(bones.current.head.rotation.y, targetY, smoothSpeed)
      bones.current.head.rotation.x = THREE.MathUtils.lerp(bones.current.head.rotation.x, targetX + breathe, smoothSpeed)
    }

    if (bones.current.spine && initialRotation.current.spine) {
      const init = initialRotation.current.spine
      const targetY = init.y + (mouseY * (Math.PI / 9))
      const targetX = init.x + (mouseX * (Math.PI / 10))

      const smoothSpeed = delta * 3

      bones.current.spine.rotation.y = THREE.MathUtils.lerp(bones.current.spine.rotation.y, targetY, smoothSpeed)
      bones.current.spine.rotation.x = THREE.MathUtils.lerp(bones.current.spine.rotation.x, targetX + (breathe * 0.5), smoothSpeed)
    }

    // Акт 2: уезжает вправо за край + слегка отворачивается
    const p = scrollProgress.get()
    const slide = smoothstep(THREE.MathUtils.clamp((p - SLIDE_START) / SLIDE_RANGE, 0, 1))
    group.position.x = slide * (state.viewport.width / 2 + 2.2)

    group.rotation.y = THREE.MathUtils.lerp(
      group.rotation.y,
      -mouseX * 0.1 + slide * -0.35,
      delta * 2
    )
  })

  return (
    <group ref={groupRef} scale={2.5} position={[0, -2.25, 0]} visible={false}>
      <primitive object={scene} />
    </group>
  )
}

useGLTF.preload("/white-droid.glb")
