"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useThree } from "@react-three/fiber"
import { Environment, OrbitControls, useAnimations, useGLTF } from "@react-three/drei"
import * as THREE from "three"
import { SkeletonUtils, type OrbitControls as OrbitControlsImpl } from "three-stdlib"
import { Crosshair, Footprints, Hand, Loader2, Minus, Music, Pause, Play, Plus, Radio, RotateCcw, Shuffle, Zap } from "lucide-react"
import { droidModelUrl } from "@/lib/media"
import { LABEL_CLASS } from "./ui"

const MAX_ID = 3333
const DEFAULT_ID = 777

// Клипы движений — те же файлы, что крутились в старом меню Moves.
const MOVES = [
  { id: "Hello", label: "Hello", file: "/animations/standing-greeting.glb", Icon: Hand },
  { id: "Dance", label: "Dance", file: "/animations/Dance.glb", Icon: Music },
  { id: "HipHop", label: "Hip-Hop", file: "/animations/hip-hop-dance.glb", Icon: Radio },
  { id: "Punch", label: "Punch", file: "/animations/punching-bag.glb", Icon: Crosshair },
  { id: "Kick", label: "Kick", file: "/animations/mma-kick.glb", Icon: Footprints },
  { id: "Attack", label: "Attack", file: "/animations/kick-to-the-groin.glb", Icon: Zap },
] as const

type MoveId = (typeof MOVES)[number]["id"]

/** Центрирует и вписывает модель по высоте кадра (габариты GLB заранее неизвестны). */
function FittedModel({ url, move, onMoveEnd }: { url: string; move: MoveId | null; onMoveEnd: () => void }) {
  const { scene } = useGLTF(url)
  const invalidate = useThree((s) => s.invalidate)
  const groupRef = useRef<THREE.Group>(null)

  const prepared = useMemo(() => {
    // SkeletonUtils.clone: обычный clone не переносит привязку костей,
    // из-за чего клипы движений не проигрываются.
    const root = SkeletonUtils.clone(scene) as THREE.Object3D
    root.updateWorldMatrix(true, true)

    // Габариты считаем ТОЛЬКО по мешам: кости и пустые узлы у этих GLB
    // раздувают Box3.setFromObject и модель уезжает из кадра.
    const box = new THREE.Box3()
    root.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) return
      mesh.geometry.computeBoundingBox()
      const bb = mesh.geometry.boundingBox
      if (bb) box.union(bb.clone().applyMatrix4(mesh.matrixWorld))
    })

    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const scale = 2.2 / (size.y || 1)   // видимая высота кадра ≈ 2.65 юнита
    root.scale.setScalar(scale)
    root.position.set(-center.x * scale, -center.y * scale, -center.z * scale)
    return root
  }, [scene])

  // Клипы лежат в отдельных GLB и делят скелет с моделью токена.
  const clips = useAnimationClips()
  const { actions } = useAnimations(clips, groupRef)

  useEffect(() => { invalidate() }, [prepared, invalidate])

  useEffect(() => {
    if (!move) return
    const action = actions[move]
    if (!action) { onMoveEnd(); return }

    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.3)
    action.clampWhenFinished = true
    action.play()

    const mixer = action.getMixer()
    const onFinished = () => { action.fadeOut(0.4); onMoveEnd() }
    mixer.addEventListener("finished", onFinished)
    return () => { mixer.removeEventListener("finished", onFinished) }
  }, [move, actions, onMoveEnd])

  return (
    <group ref={groupRef}>
      <primitive object={prepared} />
    </group>
  )
}

/** Загружает все клипы движений один раз и проставляет им имена из MOVES. */
function useAnimationClips(): THREE.AnimationClip[] {
  const loaded = MOVES.map((m) => useGLTF(m.file).animations)
  return useMemo(() => {
    const out: THREE.AnimationClip[] = []
    loaded.forEach((clips, i) => {
      if (clips.length) {
        const clip = clips[0].clone()
        clip.name = MOVES[i].id
        out.push(clip)
      }
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.length])
}

function ViewerCanvas({
  url, controlsRef, move, onMoveEnd, spin,
}: {
  url: string
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>
  move: MoveId | null
  onMoveEnd: () => void
  spin: boolean
}) {
  return (
    <Canvas camera={{ position: [0, 0.1, 4.2], fov: 35 }} gl={{ antialias: true, alpha: true }} dpr={[1, 2]}>
      <ambientLight intensity={0.6} />
      <spotLight position={[6, 8, 6]} angle={0.3} penumbra={1} intensity={1.2} />
      <spotLight position={[-8, 4, 6]} angle={0.3} penumbra={1} intensity={0.5} color="#4f46e5" />
      <Suspense fallback={null}>
        <FittedModel url={url} move={move} onMoveEnd={onMoveEnd} />
        <Environment preset="city" />
      </Suspense>
      <OrbitControls
        ref={controlsRef}
        enablePan
        screenSpacePanning
        autoRotate={spin}
        autoRotateSpeed={1.1}
        minDistance={2.6}
        maxDistance={9}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 1.7}
      />
    </Canvas>
  )
}

export function DroidViewer() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const [tokenId, setTokenId] = useState(DEFAULT_ID)
  const [input, setInput] = useState(String(DEFAULT_ID))
  const [error, setError] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<number | null>(DEFAULT_ID)
  const [move, setMove] = useState<MoveId | null>(null)
  const [spin, setSpin] = useState(true)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)

  // Кнопочный зум: двигаем камеру вдоль луча «камера → цель».
  const zoom = (factor: number) => {
    const c = controlsRef.current
    if (!c) return
    const cam = c.object as THREE.PerspectiveCamera
    const dir = cam.position.clone().sub(c.target)
    const dist = THREE.MathUtils.clamp(dir.length() * factor, c.minDistance, c.maxDistance)
    cam.position.copy(c.target.clone().add(dir.normalize().multiplyScalar(dist)))
    c.update()
  }

  const resetView = () => {
    const c = controlsRef.current
    if (!c) return
    c.target.set(0, 0, 0)
    c.object.position.set(0, 0.1, 4.2)
    c.update()
  }

  // Модели по ~4.7 МБ — монтируем канвас только когда блок доехал до экрана.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || mounted) return
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setMounted(true); io.disconnect() } },
      { rootMargin: "200px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [mounted])

  // Пока GLB тянется, держим индикатор — Suspense внутри канваса молчаливый.
  useEffect(() => {
    if (!mounted) return
    let cancelled = false
    setLoadingId(tokenId)
    setError(null)
    fetch(droidModelUrl(tokenId), { method: "HEAD" })
      .then((r) => { if (!cancelled && !r.ok) setError(`Droid #${tokenId} has no 3D model yet`) })
      .catch(() => { if (!cancelled) setError("Could not reach the model server") })
      .finally(() => { if (!cancelled) setTimeout(() => setLoadingId(null), 600) })
    return () => { cancelled = true }
  }, [tokenId, mounted])

  const submit = (raw: string) => {
    const n = parseInt(raw.replace(/\D/g, ""), 10)
    if (!n || n < 1 || n > MAX_ID) {
      setError(`Enter a number between 1 and ${MAX_ID}`)
      return
    }
    setError(null)
    setTokenId(n)
  }

  const randomId = () => {
    const n = 1 + Math.floor(Math.random() * MAX_ID)
    setInput(String(n))
    setTokenId(n)
  }

  return (
    <div ref={wrapRef} className="w-full rounded-2xl border border-white/10 bg-[#0a0a0a]/90 backdrop-blur-xl overflow-hidden">
      {/* Строка управления */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className={`${LABEL_CLASS} text-white/30 hidden sm:block`}>Droid</span>
        <form
          onSubmit={(e) => { e.preventDefault(); submit(input) }}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          <div className="flex items-center gap-1 flex-1 min-w-0 rounded-lg border border-white/10 bg-black/60 px-3 py-2 focus-within:border-white/30 transition-colors">
            <span className="font-mono text-sm text-white/30">#</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              inputMode="numeric"
              placeholder={`1–${MAX_ID}`}
              aria-label="Droid token id"
              className="w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-white/20"
            />
          </div>
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-white text-black font-black uppercase tracking-widest text-[10px] px-4 py-2.5 hover:bg-[#0069FF] hover:text-white transition-colors"
          >
            Load
          </button>
        </form>
        <button
          type="button"
          onClick={randomId}
          title="Random droid"
          className="shrink-0 rounded-lg border border-white/10 p-2.5 text-white/50 hover:text-white hover:border-white/30 transition-colors"
        >
          <Shuffle size={14} />
        </button>
      </div>

      {/* Сцена */}
      <div className="relative aspect-square lg:aspect-[5/4] w-full">
        {mounted ? (
          <ViewerCanvas
            url={droidModelUrl(tokenId)}
            controlsRef={controlsRef}
            move={move}
            onMoveEnd={() => setMove(null)}
            spin={spin}
          />
        ) : null}

        {(loadingId !== null || !mounted) && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-white/40 pointer-events-none">
            <Loader2 size={16} className="animate-spin" />
            <span className={LABEL_CLASS}>Loading #{loadingId ?? tokenId}</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center px-4">
            <span className="font-mono text-[11px] text-[#ff6b6b] bg-black/80 border border-[#ff6b6b]/30 rounded-lg px-3 py-1.5">
              {error}
            </span>
          </div>
        )}

        {/* Меню движений — вертикальная колонка справа */}
        <div className="absolute right-3 top-3 flex flex-col rounded-xl border border-white/10 bg-black/70 backdrop-blur-sm overflow-hidden">
          {MOVES.map(({ id, label, Icon }, i) => (
            <button
              key={id}
              type="button"
              onClick={() => setMove(id)}
              disabled={move !== null}
              title={label}
              aria-label={label}
              className={`group relative p-2.5 transition-colors disabled:cursor-default ${
                move === id ? "text-white bg-white/10" : "text-white/45 hover:text-white hover:bg-white/10"
              } ${i > 0 ? "border-t border-white/10" : ""}`}
            >
              <Icon size={15} />
              <span className="pointer-events-none absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-black/90 border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-white/80 opacity-0 group-hover:opacity-100 transition-opacity">
                {label}
              </span>
            </button>
          ))}
        </div>

        {/* Микро-навигация: зум + сброс вида */}
        <div className="absolute right-3 bottom-3 flex flex-col rounded-xl border border-white/10 bg-black/70 backdrop-blur-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setSpin((v) => !v)}
            aria-label={spin ? "Pause rotation" : "Play rotation"}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            {spin ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <span className="h-px bg-white/10" />
          <button type="button" onClick={() => zoom(0.82)} aria-label="Zoom in"
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 transition-colors">
            <Plus size={14} />
          </button>
          <span className="h-px bg-white/10" />
          <button type="button" onClick={() => zoom(1.22)} aria-label="Zoom out"
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 transition-colors">
            <Minus size={14} />
          </button>
          <span className="h-px bg-white/10" />
          <button type="button" onClick={resetView} aria-label="Reset view"
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 transition-colors">
            <RotateCcw size={13} />
          </button>
        </div>

        <div className="absolute left-4 bottom-3 flex items-center gap-1.5 text-white/25 pointer-events-none">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Drag · rotate</span>
          <span className="text-white/15">/</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Right-drag · move</span>
        </div>
      </div>
    </div>
  )
}

MOVES.forEach((m) => useGLTF.preload(m.file))
