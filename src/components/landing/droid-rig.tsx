"use client"

import { useEffect, useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { useGLTF } from "@react-three/drei"
import * as THREE from "three"
import type { MotionValue } from "framer-motion"
import type { HeroPhase } from "./hero-section"
import { droidFocus } from "./droid-focus"

interface DroidRigProps {
  phase: HeroPhase
  /** 0..1 — прогресс скролла hero-секции */
  scrollProgress: MotionValue<number>
  isMobile: boolean
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)
const seg = (p: number, from: number, to: number) =>
  smoothstep(THREE.MathUtils.clamp((p - from) / (to - from), 0, 1))

// Хореография по прогрессу hero:
//   0.00–0.25  стоит справа в полный рост (акт 1, текст слева)
//   0.25–0.45  камера наезжает — в кадре верх корпуса (акт 2, лор слева)
//   0.45–0.86  держится
//   0.46–0.90  медленно растворяется глитчем — переход к цифрам мягче
const SHIFT = { from: 0.25, to: 0.45 }
const DISSOLVE = { from: 0.46, to: 0.9 }

// Базовое положение в мировых единицах: правая половина кадра.
// Константа, а не доля viewport — иначе при наезде камеры дроид «сползает» в центр.
const PARK_X_DESKTOP = 1.95
// Ноги стоят ровно на полу: у модели min.y = 0, поэтому позиция группы = уровень пола.
const GROUND_Y = -2.6
const SCALE = 2.86   // +30% к прежним 2.2
const PARK_X_MOBILE = 0.85

export function DroidRig({ phase, scrollProgress, isMobile }: DroidRigProps) {
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

    const p = scrollProgress.get()
    const shift = seg(p, SHIFT.from, SHIFT.to)
    const dissolve = seg(p, DISSOLVE.from, DISSOLVE.to)

    // Растворение на выходе: тот же приём, что и при появлении, но наоборот.
    if (fadeDone.current && dissolve > 0) {
      const visibleAmount = 1 - dissolve
      materials.forEach(({ mat }) => { mat.transparent = true; mat.opacity = visibleAmount })
      group.visible = visibleAmount > 0.01
    } else if (fadeDone.current) {
      materials.forEach(({ mat, wasTransparent }) => { mat.transparent = wasTransparent; mat.opacity = 1 })
    }

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

    const parkX = isMobile ? PARK_X_MOBILE : PARK_X_DESKTOP
    group.position.x = parkX
    group.position.y = GROUND_Y

    group.scale.setScalar(SCALE)

    // Точка наводки для камеры — грудь дроида в «припаркованном» положении.
    // Уход за край (exit) сюда НЕ входит: иначе камера гонится за улетающей
    // моделью и кадр дёргается на стыке с блоком цифр.
    droidFocus.x = parkX
    droidFocus.y = GROUND_Y + SCALE * 1.32   // уровень головы
    droidFocus.dissolve = dissolve

    // Разворот корпуса вправо (на акте 2 чуть сильнее).
    group.rotation.y = THREE.MathUtils.lerp(
      group.rotation.y,
      -mouseX * 0.1 - 0.5 - shift * 0.25,
      delta * 2
    )
  })

  return (
    <group ref={groupRef} scale={2.2} position={[0, -2.6, 0]} visible={false}>
      <primitive object={scene} />
    </group>
  )
}

useGLTF.preload("/white-droid.glb")
