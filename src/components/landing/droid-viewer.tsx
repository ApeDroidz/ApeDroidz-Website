"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Canvas } from "@react-three/fiber"
import { Environment, OrbitControls, useAnimations, useGLTF } from "@react-three/drei"
import * as THREE from "three"
import { type OrbitControls as OrbitControlsImpl } from "three-stdlib"
import { Crosshair, Footprints, Hand, Loader2, Minus, Music, Pause, Play, Plus, Radio, RotateCcw, Shuffle, Zap } from "lucide-react"
import { AvatarLights, useAssembledAvatar, useDroidAvatar } from "@/components/droid-avatar"
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

/** Модель токена плюс клипы движений: сборка и вписывание в кадр — общие. */
function FittedModel({ urls, move, onMoveEnd }: { urls: string[]; move: MoveId | null; onMoveEnd: () => void }) {
  const prepared = useAssembledAvatar(urls)
  const groupRef = useRef<THREE.Group>(null)

  // Клипы лежат в отдельных GLB и делят скелет с моделью токена.
  const clips = useAnimationClips()
  const { actions } = useAnimations(clips, groupRef)

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
  urls, controlsRef, move, onMoveEnd, spin,
}: {
  urls: string[]
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>
  move: MoveId | null
  onMoveEnd: () => void
  spin: boolean
}) {
  return (
    <Canvas camera={{ position: [0, 0.1, 4.2], fov: 35 }} gl={{ antialias: true, alpha: true }} dpr={[1, 2]}>
      <AvatarLights />
      <Suspense fallback={null}>
        <FittedModel urls={urls} move={move} onMoveEnd={onMoveEnd} />
      </Suspense>
      <Suspense fallback={null}>
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
  // Ввод и загрузка ошибаются по-разному: «введите число от 1 до 3333» живёт
  // здесь, а отказ загрузки приходит из хука.
  const [inputError, setInputError] = useState<string | null>(null)
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

  // Аватар берём из живого MML токена — того самого документа, что читает
  // Otherside: тело плюс отдельный GLB на каждый надетый слой, все из R2.
  const { urls: modelUrls, progress, error: loadError, loadingId } = useDroidAvatar(tokenId, mounted)
  const error = inputError ?? loadError

  const submit = (raw: string) => {
    const n = parseInt(raw.replace(/\D/g, ""), 10)
    if (!n || n < 1 || n > MAX_ID) {
      setInputError(`Enter a number between 1 and ${MAX_ID}`)
      return
    }
    setInputError(null)
    setTokenId(n)
  }

  const randomId = () => {
    const n = 1 + Math.floor(Math.random() * MAX_ID)
    setInput(String(n))
    setInputError(null)
    setTokenId(n)
  }

  return (
    <div ref={wrapRef} className="w-full rounded-2xl border border-white/10 bg-[#0a0a0a]/90 backdrop-blur-xl overflow-hidden">
      {/* Строка управления. Главное действие — случайный дроид: номер своего
          токена знает только владелец, а посмотреть «хоть какого-нибудь»
          хочется каждому. Поэтому белая кнопка ему, а ввод номера с Load —
          второстепенный путь и приглушён. */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={randomId}
          className="shrink-0 inline-flex items-center gap-2 rounded-full bg-white text-black font-black uppercase tracking-widest text-[10px] px-5 py-2.5 hover:bg-[#0069FF] hover:text-white transition-colors cursor-pointer"
        >
          <Shuffle size={13} />
          Random droid
        </button>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(input) }}
          className="flex items-center gap-1.5 ml-auto min-w-0"
        >
          <div className="flex items-center gap-1 w-[92px] sm:w-[110px] min-w-0 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 focus-within:border-white/25 transition-colors">
            <span className="font-mono text-xs text-white/25">#</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              inputMode="numeric"
              placeholder={`1–${MAX_ID}`}
              aria-label="Droid token id"
              className="w-full bg-transparent font-mono text-xs text-white/75 outline-none placeholder:text-white/15"
            />
          </div>
          <button
            type="submit"
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/45 hover:text-white hover:border-white/25 transition-colors cursor-pointer"
          >
            Load
          </button>
        </form>
      </div>

      {/* Сцена */}
      <div className="relative aspect-[4/5] sm:aspect-square lg:aspect-[5/4] w-full">
        {mounted && modelUrls ? (
          <ViewerCanvas
            urls={modelUrls}
            controlsRef={controlsRef}
            move={move}
            onMoveEnd={() => setMove(null)}
            spin={spin}
          />
        ) : null}

        {(loadingId !== null || !mounted) && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-10 pointer-events-none">
            <div className="flex items-center gap-2 text-white/45">
              <Loader2 size={15} className="animate-spin" />
              <span className={LABEL_CLASS}>Loading #{loadingId ?? tokenId}</span>
            </div>
            <div className="w-full max-w-[220px]">
              <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-white/70 transition-[width] duration-150 ease-out"
                  style={{ width: `${Math.max(progress, 4)}%` }}
                />
              </div>
              <div className={`${LABEL_CLASS} text-white/25 mt-2 text-center`}>{progress}%</div>
            </div>
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

        <div className="absolute left-4 bottom-3 hidden sm:flex items-center gap-1.5 text-white/25 pointer-events-none">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Drag · rotate</span>
          <span className="text-white/15">/</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Right-drag · move</span>
        </div>
      </div>
    </div>
  )
}

MOVES.forEach((m) => useGLTF.preload(m.file))
