"use client"

import { Suspense, useEffect, useState } from "react"
import { Canvas } from "@react-three/fiber"
import { Environment, Loader } from "@react-three/drei"
import { DroidModel } from "@/components/droid-model"
import { Floor } from "@/components/floor"

// Добавляем интерфейс, чтобы принимать пропсы от page.tsx
interface SceneProps {
  activeEmotion: string | null
  onEmotionEnd: () => void
}

export function Scene({ activeEmotion, onEmotionEnd }: SceneProps) {
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  if (!isMounted) {
    return <div className="absolute inset-0 w-full h-full bg-black" />
  }

  return (
    <div className="absolute inset-0 w-full h-full">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 35 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        {/* Освещение */}
        <ambientLight intensity={0.5} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} />
        <spotLight position={[-10, 5, 10]} angle={0.15} penumbra={1} intensity={0.5} color="#4f46e5" />

        <Suspense fallback={null}>
          <DroidModel
            activeEmotion={activeEmotion}
            onEmotionEnd={onEmotionEnd}
          />

          <Floor />

          <Environment preset="city" />
        </Suspense>
      </Canvas>

      <Loader containerStyles={{ background: 'transparent' }} />
    </div>
  )
}