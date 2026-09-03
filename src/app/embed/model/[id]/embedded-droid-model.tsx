"use client"

import { Suspense, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Canvas } from "@react-three/fiber"
import { Environment, OrbitControls } from "@react-three/drei"
import { Loader2 } from "lucide-react"
import { AvatarLights, useAssembledAvatar, useDroidAvatar } from "@/components/droid-avatar"

const LABEL = "font-mono text-[10px] uppercase tracking-[0.2em]"

function Avatar({ urls }: { urls: string[] }) {
  const prepared = useAssembledAvatar(urls)
  return <primitive object={prepared} />
}

function Stage({ tokenId }: { tokenId: number }) {
  const { urls, progress, error, loadingId } = useDroidAvatar(tokenId)

  // Страницу открывает вкладка 3D в превьюере — там уже есть логотип-индикатор,
  // общий для Pixel и Animated. Шлём ему проценты, чтобы 3D заполняла тот же
  // логотип, а не показывала второй, свой. Свой остаётся для случая, когда
  // страницу открыли напрямую, без превьюера.
  const [embedded, setEmbedded] = useState(false)
  useEffect(() => { setEmbedded(window.parent !== window) }, [])

  useEffect(() => {
    if (window.parent === window) return
    const post = (message: Record<string, unknown>) => {
      try { window.parent.postMessage({ tokenId, ...message }, "*") } catch { /* чужой origin */ }
    }
    if (error) post({ type: "apedroidz:modelError", message: error })
    else if (loadingId === null) post({ type: "apedroidz:modelReady" })
    else post({ type: "apedroidz:modelProgress", value: progress })
  }, [tokenId, progress, error, loadingId])

  return (
    <div className="relative w-full h-full">
      {urls && (
        <Canvas camera={{ position: [0, 0.1, 4.2], fov: 35 }} gl={{ antialias: true, alpha: true }} dpr={[1, 2]}>
          <AvatarLights />
          <Suspense fallback={null}>
            <Avatar urls={urls} />
          </Suspense>
          <Suspense fallback={null}>
            <Environment preset="city" />
          </Suspense>
          <OrbitControls
            enablePan
            screenSpacePanning
            autoRotate
            autoRotateSpeed={1.1}
            minDistance={2.6}
            maxDistance={9}
            minPolarAngle={Math.PI / 6}
            maxPolarAngle={Math.PI / 1.7}
          />
        </Canvas>
      )}

      {loadingId !== null && !error && !embedded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-10 pointer-events-none">
          <div className="flex items-center gap-2 text-white/45">
            <Loader2 size={15} className="animate-spin" />
            <span className={LABEL}>Loading #{loadingId}</span>
          </div>
          <div className="w-full max-w-[220px]">
            <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-white/70 transition-[width] duration-150 ease-out"
                style={{ width: `${Math.max(progress, 4)}%` }}
              />
            </div>
            <div className={`${LABEL} text-white/25 mt-2 text-center`}>{progress}%</div>
          </div>
        </div>
      )}

      {error && !embedded && (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
          <p className={`${LABEL} text-white/40`}>{error}</p>
        </div>
      )}

      {/* Подсказки о перетаскивании тут нет намеренно: страницу вставляют в
          превьюер, где по нижним углам уже стоят бейджи уровня и номера. */}
    </div>
  )
}

// Канвас — только на клиенте: WebGL на сервере не существует, а сборка аватара
// трогает URL.createObjectURL.
export const EmbeddedDroidModel = dynamic(() => Promise.resolve(Stage), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-black" />,
})
