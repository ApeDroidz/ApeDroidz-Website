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
import type { HeroPhase } from "./hero-section"

// Камера: FAR — стартовый общий план (как на старой главной),
// NEAR — наезд после материализации, дроид в кадре примерно по пояс.
// Тюнить здесь.
const CAM = {
  desktop: { far: new THREE.Vector3(0, 0, 8), near: new THREE.Vector3(0, 1.05, 4.6) },
  mobile: { far: new THREE.Vector3(0, 0, 11), near: new THREE.Vector3(0, 1.15, 6.6) },
}

function CameraRig({ phase, isMobile }: { phase: HeroPhase; isMobile: boolean }) {
  const camera = useThree((s) => s.camera)
  useFrame((_, delta) => {
    const cam = isMobile ? CAM.mobile : CAM.desktop
    const target = phase === "materialize" || phase === "ready" ? cam.near : cam.far
    camera.position.x = THREE.MathUtils.damp(camera.position.x, target.x, 2.2, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, target.y, 2.2, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, target.z, 2.2, delta)
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

        <CameraRig phase={phase} isMobile={isMobile} />
        <Floor />

        <Suspense fallback={null}>
          <DroidRig phase={phase} scrollProgress={scrollProgress} />
          <Environment preset="city" />
          <ReadySignal onReady={onReady} />
        </Suspense>

        {burst && phase === "materialize" && <GlitchBurst />}
      </Canvas>
    </div>
  )
}
