"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Environment, useProgress } from "@react-three/drei"
import {
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  GlitchEffect,
  GlitchMode,
  RenderPass,
} from "postprocessing"
import * as THREE from "three"
import type { MotionValue } from "framer-motion"
import { Floor } from "@/components/floor"
import { DroidRig } from "./droid-rig"
import { droidFocus } from "./droid-focus"
import type { HeroPhase } from "./hero-section"

// Камера: FAR — стартовый общий план (как на старой главной), NEAR — наезд
// после материализации (дроид в кадре по пояс), WIDE — отъезд на акте 2,
// чтобы дроид целиком поместился в правой половине рядом с текстом.
const CAM = {
  desktop: {
    far: new THREE.Vector3(0, 0, 9),        // интро, пока дроида нет
    near: new THREE.Vector3(0, 0.1, 8.4),   // акт 1 — дроид почти в полный рост
    wide: new THREE.Vector3(0, 1.55, 4.6),  // акт 2 — крупный план от пояса и выше
  },
  mobile: {
    far: new THREE.Vector3(0, 0, 12),
    near: new THREE.Vector3(0, 0.2, 13),
    wide: new THREE.Vector3(0, 1.5, 8),
  },
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)

function CameraRig({
  phase,
  isMobile,
  scrollProgress,
}: {
  phase: HeroPhase
  isMobile: boolean
  scrollProgress: MotionValue<number>
}) {
  const camera = useThree((s) => s.camera)
  const target = useMemo(() => new THREE.Vector3(), [])
  const lookAt = useMemo(() => new THREE.Vector3(), [])
  const lookCurrent = useMemo(() => new THREE.Vector3(0, 0, 0), [])

  useFrame((_, delta) => {
    const cam = isMobile ? CAM.mobile : CAM.desktop
    const arrived = phase === "materialize" || phase === "ready"

    // Тот же сегмент, что и у наезда в droid-rig (SHIFT).
    const shift = arrived
      ? smoothstep(THREE.MathUtils.clamp((scrollProgress.get() - 0.25) / 0.2, 0, 1))
      : 0

    if (!arrived) {
      target.copy(cam.far)
    } else {
      target.copy(cam.near).lerp(cam.wide, shift)
      // На крупном плане подъезжаем вбок к дроиду, иначе он уходит за край.
      // Камера подъезжает к дроиду, но с отступом — он должен остаться справа.
      target.x += (droidFocus.x - 1.15) * shift
    }

    camera.position.x = THREE.MathUtils.damp(camera.position.x, target.x, 2.2, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, target.y, 2.2, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, target.z, 2.2, delta)

    // Наводка: от центра сцены к груди дроида по мере наезда.
    lookAt.set((droidFocus.x - 1.15) * shift, droidFocus.y * shift, 0)
    lookCurrent.x = THREE.MathUtils.damp(lookCurrent.x, lookAt.x, 2.2, delta)
    lookCurrent.y = THREE.MathUtils.damp(lookCurrent.y, lookAt.y, 2.2, delta)
    camera.lookAt(lookCurrent)
  })
  return null
}

// Глитч-бёрст материализации. @react-three/postprocessing несовместим с
// three 0.182 (его barrel тянет N8AO/SSR со снесённым WebGLMultipleRenderTargets),
// поэтому композер собран напрямую из `postprocessing`. useFrame с priority 1
// перехватывает рендер у R3F на время монтирования; на анмаунте всё возвращается.
function GlitchBurst() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const composer = useMemo(() => {
    const c = new EffectComposer(gl)
    c.addPass(new RenderPass(scene, camera))
    const chromatic = new ChromaticAberrationEffect()
    const glitch = new GlitchEffect({
      chromaticAberrationOffset: chromatic.offset,
      strength: new THREE.Vector2(0.25, 0.65),
      delay: new THREE.Vector2(0, 0),
      duration: new THREE.Vector2(0.1, 0.3),
      ratio: 0.85,
    })
    glitch.mode = GlitchMode.CONSTANT_WILD
    c.addPass(new EffectPass(camera, glitch))
    c.addPass(new EffectPass(camera, chromatic))
    return c
  }, [gl, scene, camera])

  useEffect(() => {
    composer.setSize(size.width, size.height)
  }, [composer, size])

  useEffect(() => () => composer.dispose(), [composer])

  useFrame((_, delta) => {
    composer.render(delta)
  }, 1)

  return null
}

/** Срабатывает ровно один раз, когда Suspense-boundary (GLB + HDRI) разрезолвился. */
function ReadySignal({ onReady }: { onReady: () => void }) {
  useEffect(() => { onReady() }, [onReady])
  return null
}

/** Прокидывает прогресс загрузки наружу (строка LOADING n% под заголовком). */
function LoadingReporter({ onProgress }: { onProgress: (pct: number) => void }) {
  const { progress } = useProgress()
  useEffect(() => { onProgress(Math.round(progress)) }, [progress, onProgress])
  return null
}

interface HeroSceneProps {
  phase: HeroPhase
  scrollProgress: MotionValue<number>
  /** false → frameloop останавливается (hero ушёл из вьюпорта) */
  active: boolean
  /** false → без постпроцессинг-бёрста (reduced motion) */
  burst: boolean
  onReady: () => void
  onProgress: (pct: number) => void
}

export function HeroScene({ phase, scrollProgress, active, burst, onReady, onProgress }: HeroSceneProps) {
  const [isMounted, setIsMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    setIsMobile(window.innerWidth < 768)
    setIsMounted(true)
  }, [])

  if (!isMounted) {
    return null
  }

  return (
    <div className="absolute inset-0 w-full h-full">
      <LoadingReporter onProgress={onProgress} />
      <Canvas
        camera={{ position: [0, 0, isMobile ? 11 : 8], fov: 35 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        frameloop={active ? "always" : "never"}
      >
        <ambientLight intensity={0.5} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} />
        <spotLight position={[-10, 5, 10]} angle={0.15} penumbra={1} intensity={0.5} color="#4f46e5" />

        <CameraRig phase={phase} isMobile={isMobile} scrollProgress={scrollProgress} />
        <Floor scrollProgress={scrollProgress} />

        <Suspense fallback={null}>
          <DroidRig phase={phase} scrollProgress={scrollProgress} isMobile={isMobile} />
          <Environment preset="city" />
          <ReadySignal onReady={onReady} />
        </Suspense>

        {burst && phase === "materialize" && <GlitchBurst />}
      </Canvas>
    </div>
  )
}
