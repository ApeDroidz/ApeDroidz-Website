"use client"

// Сборка 3D-аватара дроида из его живого MML. Общий код для превьюера на
// лендинге (Ready to the Otherside) и для вкладки 3D в превьюере метаданных,
// который открывают маркетплейсы, — оба показывают ровно то, что читает
// Otherside: тело плюс отдельный GLB на каждый надетый слой.

import { useEffect, useMemo, useRef, useState } from "react"
import { useThree } from "@react-three/fiber"
import { useGLTF } from "@react-three/drei"
import * as THREE from "three"
import { SkeletonUtils } from "three-stdlib"
import { droidModelUrl } from "@/lib/media"

/** Адреса GLB из MML: сначала тело (<m-character>), затем надетые слои. */
export function parseMmlSources(doc: string): string[] {
  const out: string[] = []
  const re = /<m-(?:character|model)\b[^>]*\bsrc=["']([^"']+)["']/gi
  for (let m = re.exec(doc); m; m = re.exec(doc)) out.push(m[1])
  return out
}

/** Собирает аватар из тела и слоёв MML.
 *
 *  Все части экспортированы на одном скелете UE5, но каждая приезжает со СВОЕЙ
 *  копией костей. Если просто добавить их в сцену, слои останутся в bind-позе и
 *  на анимации разъедутся с телом. Поэтому каждый меш перепривязывается к
 *  костям тела: кости ищем ПО ИМЕНИ, а не по индексу (порядок в файлах не
 *  обязан совпадать), собственные boneInverses части сохраняем — в них сидит
 *  её bind-поза. */
export function assembleAvatar(scenes: THREE.Object3D[]): THREE.Object3D {
  // SkeletonUtils.clone: обычный clone не переносит привязку костей,
  // из-за чего клипы движений не проигрываются.
  const root = SkeletonUtils.clone(scenes[0]) as THREE.Object3D
  root.updateWorldMatrix(true, true)

  let skeleton: THREE.Skeleton | null = null
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.SkinnedMesh
    if (mesh.isSkinnedMesh) {
      mesh.frustumCulled = false
      if (!skeleton) skeleton = mesh.skeleton
    }
  })

  const bones = new Map<string, THREE.Bone>()
  if (skeleton) for (const bone of (skeleton as THREE.Skeleton).bones) bones.set(bone.name, bone)

  for (const part of scenes.slice(1)) {
    const clone = SkeletonUtils.clone(part) as THREE.Object3D
    clone.updateWorldMatrix(true, true)

    const meshes: THREE.Mesh[] = []
    clone.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) meshes.push(mesh)
    })

    for (const mesh of meshes) {
      // Части лежат в тех же мировых координатах, что и тело, — переносим
      // мировую матрицу в локальную нового родителя (у root она единичная).
      mesh.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale)
      root.add(mesh)

      const skinned = mesh as THREE.SkinnedMesh
      if (!skinned.isSkinnedMesh) continue
      skinned.frustumCulled = false
      if (!bones.size) continue
      const rebound = skinned.skeleton.bones.map((b) => bones.get(b.name) ?? b)
      skinned.bind(new THREE.Skeleton(rebound, skinned.skeleton.boneInverses), skinned.bindMatrix)
    }
  }

  return root
}

/** Грузит части, склеивает их и вписывает результат в кадр по высоте
 *  (габариты GLB заранее неизвестны). Suspense-хук: звать только внутри Canvas. */
export function useAssembledAvatar(urls: string[]): THREE.Object3D {
  const gltfs = useGLTF(urls)
  const invalidate = useThree((s) => s.invalidate)
  const key = urls.join("|")

  const prepared = useMemo(() => {
    const root = assembleAvatar(gltfs.map((g) => g.scene))
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
    // gltfs — новый массив на каждый рендер, поэтому ключ по адресам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => { invalidate() }, [prepared, invalidate])

  return prepared
}

export type AvatarLoad = {
  /** blob-адреса частей: [тело, ...слои]. null, пока не готово. */
  urls: string[] | null
  /** 0…100 по сумме размеров всех частей. */
  progress: number
  error: string | null
  /** Токен, который сейчас грузится, иначе null. */
  loadingId: number | null
}

/**
 * Тянет живой MML токена и все GLB, на которые он ссылается.
 *
 * Документ собирается на запрос, поэтому апгрейд до level 2 виден сразу.
 * Файлы качаем сами, а не отдаём загрузчику: только так виден настоящий
 * прогресс, а не спиннер вслепую.
 */
export function useDroidAvatar(tokenId: number, enabled = true): AvatarLoad {
  const [urls, setUrls] = useState<string[] | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<number | null>(tokenId)
  const blobUrls = useRef<string[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoadingId(tokenId)
    setProgress(0)
    setError(null)
    setUrls(null)

    // Предыдущий аватар больше не на экране: чистим и кэш загрузчика, и блобы,
    // иначе каждый просмотренный дроид остаётся в памяти вкладки целиком.
    if (blobUrls.current.length) {
      useGLTF.clear(blobUrls.current)
      blobUrls.current.forEach((u) => URL.revokeObjectURL(u))
      blobUrls.current = []
    }

    const run = async () => {
      let files: string[] = []
      try {
        // Свой origin, а не droidOthersideMmlUrl: там канонический адрес
        // сайта для метаданных, и на локалке/превью он увёл бы запрос на прод.
        const mml = await fetch(`/api/mml/${tokenId}.mml`)
        if (mml.ok) files = parseMmlSources(await mml.text())
      } catch {
        /* MML недоступен — ниже фолбэк на запечённую модель */
      }
      // Фолбэк: старая склеенная модель целиком, одним файлом.
      if (!files.length) files = [droidModelUrl(tokenId)]
      if (cancelled) return

      try {
        const responses = await Promise.all(files.map((u) => fetch(u)))
        const bad = responses.find((r) => !r.ok)
        if (bad) throw new Error(String(bad.status))

        // Общий процент — по сумме размеров всех частей: иначе шкала прыгала бы
        // с нуля на каждом новом файле.
        const total = responses.reduce((sum, r) => sum + (Number(r.headers.get("content-length")) || 0), 0)
        let received = 0

        const blobs = await Promise.all(responses.map(async (res) => {
          const reader = res.body?.getReader()
          if (!reader) throw new Error("no stream")
          const chunks: Uint8Array[] = []
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
              chunks.push(value)
              received += value.length
              if (!cancelled && total) setProgress(Math.min(99, Math.round((received / total) * 100)))
            }
          }
          return new Blob(chunks as BlobPart[], { type: "model/gltf-binary" })
        }))
        if (cancelled) return

        // отдаём модели готовые blob'ы — второй раз по сети они не пойдут
        const next = blobs.map((b) => URL.createObjectURL(b))
        blobUrls.current = next
        setProgress(100)
        setUrls(next)
        setLoadingId(null)
      } catch {
        if (!cancelled) {
          setError(`Droid #${tokenId} has no 3D model yet`)
          setLoadingId(null)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [tokenId, enabled])

  return { urls, progress, error, loadingId }
}

/** Свет сцены. Не зависит от HDRI со стороннего CDN — см. hero-scene. */
export function AvatarLights() {
  return (
    <>
      <ambientLight intensity={1.1} />
      <hemisphereLight args={["#ffffff", "#202028", 1.2]} />
      <directionalLight position={[5, 8, 6]} intensity={2.2} />
      <directionalLight position={[-6, 4, 5]} intensity={1} color="#8fa2ff" />
    </>
  )
}
