"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useFrame } from "@react-three/fiber"
import { useGLTF } from "@react-three/drei"
import * as THREE from "three"
import type { MotionValue } from "framer-motion"
import type { HeroPhase } from "./hero-section"
import { droidFocus } from "./droid-focus"
import { MEDIA_BASE } from "@/lib/media"

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
//   0.00–0.18  стоит справа в полный рост (акт 1, текст слева)
//   0.15–0.34  камера наезжает — в кадре верх корпуса (акт 2, лор слева)
//   0.34–0.80  держится: у лора есть время, чтобы его прочитали
//   0.80–0.98  растворяется глитчем ровно до конца секции — без «мёртвого» экрана
const SHIFT = { from: 0.15, to: 0.34 }
const DISSOLVE = { from: 0.8, to: 0.98 }

// Базовое положение в мировых единицах: правая половина кадра.
// Константа, а не доля viewport — иначе при наезде камеры дроид «сползает» в центр.
const PARK_X_DESKTOP = 1.95
// Ноги стоят ровно на полу: у модели min.y = 0, поэтому позиция группы = уровень пола.
const GROUND_Y = -2.6
const SCALE = 2.86   // +30% к прежним 2.2
const PARK_X_MOBILE = 0   // по центру экрана

// ── Подборка для главной ─────────────────────────────────────────────────────
// Первым стоит белый — он и был на лендинге, с него всё начинается. Дальше
// коллекционные дроиды: у них тот же скелет и те же габариты, поэтому вся
// хореография (наезд камеры, разворот, растворение) применяется к группе и не
// зависит от того, какая модель внутри.
//
// Модели собраны из актуальных трейтов (scripts/3d/bake_hero_droid.py) — тех
// же файлов, что читает Otherside. Запечённые модели на GCS для этого не
// годятся: они отстали от переработанных трейтов.
// Сборка весит 22–90 МБ, здесь 0.8–2.5 МБ: текстуры ужаты до 512 (у #1 до 384,
// у него одного 45 текстур) и переведены в WebP, геометрия — Draco. Крыло
// ангела у #1 приехало на 671 тысяче треугольников, поэтому ему ещё и
// упрощение геометрии. Путь неизменяемый: на зоне Cache Rule с TTL в год,
// поменяется модель — поменяется и адрес.
// Порядок — очередь показа. Соседи не должны быть похожи: два «глитчевых»
// зелёных (#1 и #3273) разведены по разным концам, между ними светлый mono,
// тёмный король и розовый.
//   #1     glitch + крылья железного ангела + мозг  — редчайшее тело (27 из 3333)
//   #620   mono, проволочный контур + рога          — тело mono (56)
//   #4     robogob + плащ короля + золотые рога     — robogob (39)
//   #77    gum + мох + череп динозавра
//   #3273  glitch + огонь + плащ короля
//   #1752  gold + чёрное худи + огненные глаза      — тело gold (76)
const HERO_MODELS = [
  "/white-droid.glb",
  `${MEDIA_BASE}/apedroidz/3D-media/hero/v2/1.glb`,
  `${MEDIA_BASE}/apedroidz/3D-media/hero/v2/620.glb`,
  `${MEDIA_BASE}/apedroidz/3D-media/hero/v2/4.glb`,
  `${MEDIA_BASE}/apedroidz/3D-media/hero/v2/77.glb`,
  `${MEDIA_BASE}/apedroidz/3D-media/hero/v2/3273.glb`,
  `${MEDIA_BASE}/apedroidz/3D-media/hero/v2/1752.glb`,
]

/** Сколько дроид держится в кадре, прежде чем смениться. */
const HOLD_S = 3.8
/** Длительность подмены. Столько же живёт глитч-бёрст поверх сцены. */
const SWAP_S = 0.45
/** Материализация первого дроида на входе. */
const MATERIALIZE_S = 0.45

/** Общие для всех моделей значения кадра. Гоняются через ref, а не через
 *  состояние: перерисовывать дерево 60 раз в секунду незачем. */
type SharedFrame = {
  pointer: { x: number; y: number }
  /** Прозрачность конкретного слота: ключ — индекс модели. */
  opacity: number[]
}

// ── Одна модель ──────────────────────────────────────────────────────────────
// Кости и материалы у каждой модели свои, поэтому взгляд за курсором и фейд
// живут здесь, а не в риге. Риг двигает общую группу.
function DroidModel({ index, url, shared, onReady }: {
  index: number
  url: string
  shared: React.MutableRefObject<SharedFrame>
  onReady: (index: number) => void
}) {
  const { scene } = useGLTF(url, true)   // true → Draco-декодер

  // Компонент рендерится только когда GLB разрезолвился, значит модель готова
  // к подмене. Риг ждёт этого сигнала и не начинает смену раньше.
  useEffect(() => { onReady(index) }, [onReady, index])

  const bones = useRef<{ head: THREE.Object3D | null; spine: THREE.Object3D | null }>({ head: null, spine: null })
  const initialRotation = useRef<{
    head: { x: number; y: number; z: number } | null
    spine: { x: number; y: number; z: number } | null
  }>({ head: null, spine: null })

  useMemo(() => {
    bones.current = { head: null, spine: null }
    initialRotation.current = { head: null, spine: null }
    scene.traverse((child) => {
      const name = child.name.toLowerCase()
      if (!bones.current.head && (name.includes("head") || name.includes("голова"))) {
        bones.current.head = child
        initialRotation.current.head = { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z }
      }
      if (!bones.current.spine &&
        (name.includes("spine") || name.includes("chest") || name.includes("torso") || name.includes("корпус"))) {
        bones.current.spine = child
        initialRotation.current.spine = { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z }
      }
    })
  }, [scene])

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

  // Материалы моделей общие на уровень кэша drei: при размонтировании
  // возвращаем их в исходное состояние, иначе следующий монтаж получит
  // прозрачность от прошлой подмены.
  useEffect(() => () => {
    materials.forEach(({ mat, wasTransparent }) => {
      mat.transparent = wasTransparent
      mat.opacity = 1
    })
  }, [materials])

  const groupRef = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return

    const opacity = shared.current.opacity[index] ?? 0
    group.visible = opacity > 0.01
    if (!group.visible) return

    if (opacity >= 0.999) {
      materials.forEach(({ mat, wasTransparent }) => { mat.transparent = wasTransparent; mat.opacity = 1 })
    } else {
      materials.forEach(({ mat }) => { mat.transparent = true; mat.opacity = opacity })
    }

    const mouseX = shared.current.pointer.x
    const mouseY = shared.current.pointer.y
    const breathe = Math.sin(performance.now() * 0.002) * 0.01

    if (bones.current.head && initialRotation.current.head) {
      const init = initialRotation.current.head
      const smoothSpeed = delta * 6
      bones.current.head.rotation.y = THREE.MathUtils.lerp(
        bones.current.head.rotation.y, init.y + mouseY * (Math.PI / 5), smoothSpeed)
      bones.current.head.rotation.x = THREE.MathUtils.lerp(
        bones.current.head.rotation.x, init.x + mouseX * (Math.PI / 6) + breathe, smoothSpeed)
    }

    if (bones.current.spine && initialRotation.current.spine) {
      const init = initialRotation.current.spine
      const smoothSpeed = delta * 3
      bones.current.spine.rotation.y = THREE.MathUtils.lerp(
        bones.current.spine.rotation.y, init.y + mouseY * (Math.PI / 9), smoothSpeed)
      bones.current.spine.rotation.x = THREE.MathUtils.lerp(
        bones.current.spine.rotation.x, init.x + mouseX * (Math.PI / 10) + breathe * 0.5, smoothSpeed)
    }
  })

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  )
}

export function DroidRig({ phase, scrollProgress, isMobile }: DroidRigProps) {
  const groupRef = useRef<THREE.Group>(null)

  // Активная модель, уходящая (пока идёт подмена) и следующая — следующая
  // держится смонтированной заранее, чтобы её текстуры уехали на видеокарту
  // до подмены, а не в момент неё.
  const [active, setActive] = useState(0)
  const [outgoing, setOutgoing] = useState<number | null>(null)

  const shared = useRef<SharedFrame>({ pointer: { x: 0, y: 0 }, opacity: HERO_MODELS.map((_, i) => (i === 0 ? 0 : 0)) })

  const swapT = useRef(1)          // 0..1, прогресс текущей подмены
  const materializeT = useRef(0)   // 0..1, появление первого дроида
  const holdFor = useRef(0)        // сколько активный дроид уже стоит, секунд

  const next = (active + 1) % HERO_MODELS.length

  // Канвас лежит под текстовыми слоями, поэтому указатель слушаем на window —
  // взгляд дроида работает, даже когда курсор над текстом.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      shared.current.pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      shared.current.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1
    }
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [])

  // Массового предзагруза нет: следующая модель монтируется заранее и тянется
  // сама, по одной. Дёрнуть все четыре разом значило бы выложить 5 МБ в канал
  // сразу после первого экрана.
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set())
  const markLoaded = useCallback((i: number) => {
    setLoaded((prev) => (prev.has(i) ? prev : new Set(prev).add(i)))
  }, [])

  // Зеркало loaded для кадрового цикла: читать состояние прямо в useFrame
  // нельзя — замыкание там живёт с прошлого рендера.
  const loadedRef = useRef<Set<number>>(new Set())
  loadedRef.current = loaded


  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) return

    const visible = phase === "materialize" || phase === "ready"
    group.visible = visible
    if (!visible) return

    const p = scrollProgress.get()
    const shift = seg(p, SHIFT.from, SHIFT.to)
    const dissolve = seg(p, DISSOLVE.from, DISSOLVE.to)

    // Появление первого дроида — как было: opacity 0 → 1 под глитч-бёрст.
    if (materializeT.current < 1) {
      materializeT.current = Math.min(1, materializeT.current + delta / MATERIALIZE_S)
    }

    // Подмена идёт и в полный рост, и на крупном плане — дроид меняется, пока
    // ты на герое. Не трогаем только растворение на выходе: там модель и так
    // уже гаснет, и вторая смена поверх читалась бы как сбой.
    // Ещё одно условие — следующая модель должна быть загружена, иначе
    // уходящий растворится в пустоту.
    if (swapT.current >= 1) {
      const canSwap = phase === "ready"
        && materializeT.current >= 1
        && dissolve < 0.01
        && loadedRef.current.has(next)
        && HERO_MODELS.length > 1
      holdFor.current = canSwap ? holdFor.current + delta : 0
      if (holdFor.current >= HOLD_S) {
        holdFor.current = 0
        swapT.current = 0
        setOutgoing(active)
        setActive(next)
      }
    } else {
      swapT.current = Math.min(1, swapT.current + delta / SWAP_S)
      if (swapT.current >= 1 && outgoing !== null) setOutgoing(null)
    }

    // Прозрачности слотов: входящий проявляется, уходящий гаснет, остальные
    // молчат. Общий множитель — материализация и растворение на выходе.
    const globalFade = materializeT.current * (1 - dissolve)
    for (let i = 0; i < HERO_MODELS.length; i++) {
      shared.current.opacity[i] =
        i === active ? swapT.current * globalFade
          : i === outgoing ? (1 - swapT.current) * globalFade
            : 0
    }

    const parkX = isMobile ? PARK_X_MOBILE : PARK_X_DESKTOP
    group.position.x = parkX
    // Телефон: дроид стоит по центру, нижний край кадра режет его по пояс;
    // при скролле подрастает и опускается ещё ниже.
    group.position.y = isMobile ? GROUND_Y - 2.34 - shift * 0.85 : GROUND_Y

    group.scale.setScalar(isMobile ? SCALE * (0.95 + shift * 0.13) : SCALE)

    // Точка наводки для камеры — грудь дроида в «припаркованном» положении.
    // Уход за край (exit) сюда НЕ входит: иначе камера гонится за улетающей
    // моделью и кадр дёргается на стыке с блоком цифр.
    droidFocus.x = parkX
    // Уровень наводки: на телефоне целимся в макушку — тогда на крупном плане
    // в кадре остаются голова и грудь, а не полкорпуса.
    droidFocus.y = group.position.y + SCALE * (isMobile ? 1.7 : 1.32)
    droidFocus.dissolve = dissolve
    // Пока идёт подмена — просим сцену подмешать глитч-бёрст.
    droidFocus.swap = swapT.current < 1 ? 1 : 0

    // Разворот корпуса вправо (на акте 2 чуть сильнее).
    group.rotation.y = THREE.MathUtils.lerp(
      group.rotation.y,
      isMobile ? 0 : -shared.current.pointer.x * 0.1 - 0.5 - shift * 0.25,
      delta * 2
    )
  }, -1)   // раньше моделей: они читают opacity, который считается здесь

  // В сцене живут только активная, уходящая и следующая модели. Держать все
  // пять смонтированными значило бы занять видеопамять пятью комплектами
  // текстур 1000×1000 ради одной видимой.
  // До фазы ready в сцене только первый дроид: подборка не должна тянуться
  // одновременно с первым экраном и задерживать его появление.
  const mounted = useMemo(() => {
    if (phase !== "ready") return [active]
    const set = new Set<number>([active, next])
    if (outgoing !== null) set.add(outgoing)
    return Array.from(set)
  }, [phase, active, next, outgoing])

  return (
    <group ref={groupRef} scale={2.2} position={[0, -2.6, 0]} visible={false}>
      {mounted.map((i) => (
        // Своя граница на каждую модель: подгрузка следующей не должна
        // подвешивать ту, что уже в кадре.
        <Suspense key={HERO_MODELS[i]} fallback={null}>
          <DroidModel index={i} url={HERO_MODELS[i]} shared={shared} onReady={markLoaded} />
        </Suspense>
      ))}
    </group>
  )
}

useGLTF.preload("/white-droid.glb", true)
