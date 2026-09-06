"use client"

import { useState, useCallback, useMemo } from "react"
import { NFTItem } from "@/app/upgrade_module/page"
import { Loader2, Download, Share2 } from "lucide-react"
import {
    GridStyle, FOOTER_LOGOS, layoutFooterLogos,
    is3d, getAnimatedUrl, getStillUrl, getPixelUrl, get3dDownloadUrl, gridBackground, calculateGridDimensions,
} from "./grid-art"

interface GridDownloadButtonProps {
    droids: NFTItem[]
    gridOrder: string[]
    style: GridStyle
}

const CANVAS_SIZE = 1200
const FRAME_DELAY = 190

/** Грузит картинку через fetch + blob, а не подставляя адрес прямо в <img>.
 *
 *  Прямой путь ломался ровно на 3D-гридах. Превью и список кладут те же адреса
 *  в кеш ОБЫЧНЫМ запросом, без CORS-заголовков (там пиксели никто не читает,
 *  и crossOrigin нарочно не ставится). Выгрузке же crossOrigin нужен — иначе
 *  холст становится «грязным». Браузер переиспользует закешированный ответ,
 *  отклоняет его как непригодный для CORS, и картинка не грузится вовсе.
 *
 *  Blob-адрес свой и same-origin: ни кеша, ни CORS, ни грязного холста.
 *  Созданные адреса складываем в `keep`, чтобы освободить их одним махом
 *  после отрисовки — освобождать сразу после onload рискованно. */
const loadImage = async (src: string, keep: string[], timeoutMs = 20000): Promise<HTMLImageElement> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
        const res = await fetch(src, { signal: ctrl.signal, cache: 'no-cache' })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${src}`)
        const blobUrl = URL.createObjectURL(await res.blob())
        keep.push(blobUrl)
        return await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = () => reject(new Error(`Image decode failed: ${src}`))
            img.src = blobUrl
        })
    } finally {
        clearTimeout(timer)
    }
}

// Storage stores some art as .png and some as .webp (honorary = png only).
// Try the given URL, then the other extension, so a single naming mismatch
// never drops a cell from the canvas/GIF.
const loadImageWithFallback = async (src: string, keep: string[], timeoutMs = 20000): Promise<HTMLImageElement> => {
    try {
        return await loadImage(src, keep, timeoutMs)
    } catch (err) {
        if (src.includes('.webp')) {
            return await loadImage(src.replace('.webp', '.png'), keep, timeoutMs)
        }
        if (src.includes('.png')) {
            return await loadImage(src.replace('.png', '.webp'), keep, timeoutMs)
        }
        throw err
    }
}

// Draws a fallback cell so a single broken image doesn't sink the whole grid.
const drawPlaceholderCell = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    label: string
) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.fillRect(x, y, size, size)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
    ctx.lineWidth = Math.max(2, size * 0.01)
    ctx.strokeRect(x, y, size, size)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
    ctx.font = `bold ${Math.floor(size * 0.12)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + size / 2, y + size / 2)
}

const fetchSafeBlobUrl = async (url: string): Promise<string> => {
    try {
        const response = await fetch(url, { cache: 'no-cache' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = await response.blob()
        return URL.createObjectURL(blob)
    } catch {
        return url
    }
}

export function GridDownloadButton({ droids, gridOrder, style }: GridDownloadButtonProps) {
    const [isGenerating, setIsGenerating] = useState(false)
    const [progress, setProgress] = useState(0)
    const [statusText, setStatusText] = useState("")

    const { cols, rows } = useMemo(() => calculateGridDimensions(droids.length), [droids.length])

    // Тот же фон, что в превью: тёмный под 3D, оранжевый под SUPER, иначе синий.
    const bgColor = useMemo(() => gridBackground(droids, style), [droids, style])

    // Open Twitter with pre-filled post
    const openTwitterShare = (isAnimated: boolean) => {
        const text = isAnimated
            ? `Check out my Animated @ApeDroidz Grid 🤖\n\n⚡️ Create yours with the Grid Tool at ApeDroidz.com/grid\n\nOnly for holders.`
            : `Check out my @ApeDroidz Grid 🤖\n\n⚡️ Create yours with the Grid Tool at ApeDroidz.com/grid\n\nOnly for holders.`

        const twitterUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
        window.open(twitterUrl, '_blank', 'noopener,noreferrer')
    }

    const generateGrid = useCallback(async () => {
        if (droids.length < 2) return

        setIsGenerating(true)
        setProgress(0)
        setStatusText("Preparing...")

        // Blob-адреса всех загруженных картинок: освобождаем разом в конце,
        // когда холст уже отрисован.
        const blobUrls: string[] = []

        try {
            // Dynamic imports — browser-only libs that break SSR
            // @ts-ignore
            const { default: GIF } = await import('gif.js');
            // @ts-ignore
            const { default: gifFrames } = await import('gif-frames');
            // Формат выбирается по содержимому: хотя бы один анимированный
            // дроид — GIF, иначе обычный PNG. Гнать статичный грид через
            // GIF-кодировщик незачем: файл тяжелее, палитра беднее, а бюсты
            // с их градиентами от 256 цветов заметно грязнятся.
            const animatedDroids = droids.filter(d => getAnimatedUrl(d, style) !== null)
            const hasAnimations = animatedDroids.length > 0
            const MAX_FRAMES = 4

            // Calculate cell size
            const cellSize = CANVAS_SIZE / Math.max(cols, rows)

            // Статика ячейки: бюст — полный рендер, если ячейка крупнее 512px
            // превью; при сбое откатываемся на превью, потом на пиксель.
            const loadStill = async (droid: NFTItem): Promise<HTMLImageElement> => {
                const candidates = is3d(droid, style)
                    ? [get3dDownloadUrl(droid, cellSize), getStillUrl(droid, style), getPixelUrl(droid)]
                    : [getStillUrl(droid, style), getPixelUrl(droid)]
                let lastErr: unknown
                for (const url of [...new Set(candidates)]) {
                    try { return await loadImageWithFallback(url, blobUrls) } catch (err) { lastErr = err }
                }
                throw lastErr
            }
            const gridWidth = cellSize * cols
            const gridHeight = cellSize * rows
            const footerHeight = cellSize * 0.7
            const canvasWidth = gridWidth
            const canvasHeight = gridHeight + footerHeight

            // Map droids
            const droidMap = new Map(droids.map(d => [d.id, d]))
            const totalCells = cols * rows
            const usedIds = new Set<string>()
            const orderedDroids: (NFTItem | null)[] = []

            for (let i = 0; i < totalCells; i++) {
                const id = gridOrder[i]
                if (id && droidMap.has(id) && !usedIds.has(id)) {
                    orderedDroids.push(droidMap.get(id)!)
                    usedIds.add(id)
                } else {
                    orderedDroids.push(null)
                }
            }

            for (const droid of droids) {
                if (!usedIds.has(droid.id)) {
                    const emptyIndex = orderedDroids.findIndex(d => d === null)
                    if (emptyIndex !== -1) {
                        orderedDroids[emptyIndex] = droid
                        usedIds.add(droid.id)
                    }
                }
            }

            setStatusText("Loading assets...")
            // Лого подвала: партнёрский ряд грузим целиком, порядок — как в
            // FOOTER_LOGOS. Упавший файл просто выпадает из ряда, а не рушит
            // всю выгрузку.
            const logoImages = new Map<string, HTMLImageElement>()
            await Promise.all(FOOTER_LOGOS.map(async (logo) => {
                try {
                    logoImages.set(logo.src, await loadImage(logo.src, blobUrls))
                } catch (err) {
                    console.warn(`[grid] logo load failed: ${logo.src}`, err)
                }
            }))

            setStatusText("Loading images...")
            setProgress(10)

            type DroidFrames = { frames: (HTMLCanvasElement | HTMLImageElement)[]; delays: number[] }
            const droidFramesMap = new Map<string, DroidFrames>()
            const failedDroidIds = new Set<string>()

            for (let i = 0; i < orderedDroids.length; i++) {
                const droid = orderedDroids[i]
                if (!droid) continue

                setProgress(10 + Math.round((i / orderedDroids.length) * 40))

                const animUrl = getAnimatedUrl(droid, style)
                if (animUrl) {
                    let resolved = false
                    try {
                        const safeUrl = await fetchSafeBlobUrl(animUrl)
                        const framesData = await gifFrames({
                            url: safeUrl,
                            frames: 'all',
                            outputType: 'canvas',
                            cumulative: true
                        })

                        const frames: HTMLCanvasElement[] = []
                        const delays: number[] = []

                        for (let j = 0; j < Math.min(framesData.length, MAX_FRAMES); j++) {
                            frames.push(framesData[j].getImage() as HTMLCanvasElement)
                            delays.push(FRAME_DELAY)
                        }

                        if (frames.length > 0) {
                            droidFramesMap.set(droid.id, { frames, delays })
                            resolved = true
                        }
                        if (safeUrl.startsWith('blob:')) URL.revokeObjectURL(safeUrl)
                    } catch (err) {
                        console.warn(`[grid] gif extraction failed for ${droid.id}:`, err)
                    }

                    if (!resolved) {
                        try {
                            const img = await loadStill(droid)
                            droidFramesMap.set(droid.id, { frames: [img], delays: [FRAME_DELAY] })
                        } catch (err) {
                            console.warn(`[grid] static fallback failed for ${droid.id}:`, err)
                            failedDroidIds.add(droid.id)
                        }
                    }
                } else {
                    try {
                        const img = await loadStill(droid)
                        droidFramesMap.set(droid.id, { frames: [img], delays: [FRAME_DELAY] })
                    } catch (err) {
                        console.warn(`[grid] image load failed for ${droid.id}:`, err)
                        failedDroidIds.add(droid.id)
                    }
                }
            }

            // Render frame
            const renderFrame = async (frameIndex: number): Promise<HTMLCanvasElement> => {
                const canvas = document.createElement('canvas')
                canvas.width = canvasWidth
                canvas.height = canvasHeight
                const ctx = canvas.getContext('2d')!

                // Background - dynamic color based on super majority
                ctx.fillStyle = bgColor
                ctx.fillRect(0, 0, canvas.width, canvas.height)

                // Draw grid cells
                for (let i = 0; i < totalCells; i++) {
                    const row = Math.floor(i / cols)
                    const col = i % cols
                    const x = col * cellSize
                    const y = row * cellSize

                    const droid = orderedDroids[i]
                    if (droid) {
                        const droidData = droidFramesMap.get(droid.id)
                        if (droidData && droidData.frames.length > 0) {
                            const frame = droidData.frames[frameIndex % droidData.frames.length]
                            // Пиксель-арт масштабируем без сглаживания, бюст — с ним.
                            ctx.imageSmoothingEnabled = is3d(droid, style)
                            try {
                                ctx.drawImage(frame, x, y, cellSize, cellSize)
                            } catch (err) {
                                console.warn(`[grid] drawImage failed for ${droid.id}:`, err)
                                drawPlaceholderCell(ctx, x, y, cellSize, `#${droid.tokenId || droid.id}`)
                            }
                        } else {
                            drawPlaceholderCell(ctx, x, y, cellSize, `#${droid.tokenId || droid.id}`)
                        }
                    }
                }

                // Подвал: партнёрский ряд лого по центру. Раскладку считает
                // общий модуль — та же, что рисует превью на экране.
                const footerY = gridHeight
                const { items, gap, startX } = layoutFooterLogos(canvasWidth, footerHeight)

                let logoX = startX
                for (const logo of items) {
                    const img = logoImages.get(logo.src)
                    if (!img) continue
                    const logoY = footerY + (footerHeight - logo.height) / 2

                    // Лого приходят в разных цветах — перекрашиваем в белый по
                    // альфе, на отдельном холсте.
                    const tint = document.createElement('canvas')
                    tint.width = Math.max(1, Math.ceil(logo.width))
                    tint.height = Math.max(1, Math.ceil(logo.height))
                    const tintCtx = tint.getContext('2d')!
                    tintCtx.drawImage(img, 0, 0, logo.width, logo.height)
                    tintCtx.globalCompositeOperation = 'source-in'
                    tintCtx.fillStyle = '#ffffff'
                    tintCtx.fillRect(0, 0, logo.width, logo.height)

                    ctx.imageSmoothingEnabled = true
                    ctx.drawImage(tint, logoX, logoY, logo.width, logo.height)
                    logoX += logo.width + gap
                }

                return canvas
            }

            if (hasAnimations) {
                setStatusText("Creating GIF...")
                setProgress(60)

                const gif = new GIF({
                    workers: 2,
                    quality: 10,
                    width: canvasWidth,
                    height: canvasHeight,
                    workerScript: '/gif.worker.js',
                    background: bgColor
                })

                for (let f = 0; f < MAX_FRAMES; f++) {
                    setStatusText(`Frame ${f + 1}/${MAX_FRAMES}`)
                    setProgress(60 + Math.round((f / MAX_FRAMES) * 30))
                    const frameCanvas = await renderFrame(f)
                    gif.addFrame(frameCanvas, { delay: FRAME_DELAY, copy: true })
                }

                setStatusText("Encoding...")
                setProgress(95)

                const blobUrl = await new Promise<string>((resolve, reject) => {
                    const timer = setTimeout(() => {
                        try { gif.abort?.() } catch {}
                        reject(new Error('GIF encoding timed out after 90s'))
                    }, 90000)
                    gif.on('finished', (blob: Blob) => {
                        clearTimeout(timer)
                        if (!blob || blob.size === 0) {
                            reject(new Error('GIF encoder produced an empty blob'))
                            return
                        }
                        resolve(URL.createObjectURL(blob))
                    })
                    gif.on('abort', () => {
                        clearTimeout(timer)
                        reject(new Error('GIF encoding was aborted'))
                    })
                    gif.on('progress', (p: number) => {
                        setProgress(95 + Math.round(p * 4))
                    })
                    try {
                        gif.render()
                    } catch (err) {
                        clearTimeout(timer)
                        reject(err instanceof Error ? err : new Error(String(err)))
                    }
                })

                const a = document.createElement('a')
                a.href = blobUrl
                a.download = `ApeDroidz_Grid_${cols}x${rows}.gif`
                a.click()
                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)

                // Open Twitter share after download
                setTimeout(() => openTwitterShare(true), 500)
            } else {
                setStatusText("Rendering...")
                setProgress(80)

                const canvas = await renderFrame(0)
                let dataUrl: string
                try {
                    dataUrl = canvas.toDataURL('image/png')
                } catch (err) {
                    throw new Error(
                        'Canvas export blocked (likely a cross-origin image without CORS). ' +
                        (err instanceof Error ? err.message : String(err))
                    )
                }

                const a = document.createElement('a')
                a.href = dataUrl
                a.download = `ApeDroidz_Grid_${cols}x${rows}.png`
                a.click()

                // Open Twitter share after download
                setTimeout(() => openTwitterShare(false), 500)
            }

            setProgress(100)
            setStatusText("Done!")

        } catch (error) {
            console.error("Grid generation error:", error)
            const msg = error instanceof Error ? error.message : String(error)
            setStatusText(`Error: ${msg.slice(0, 60)}`)
        } finally {
            for (const url of blobUrls) URL.revokeObjectURL(url)
            setTimeout(() => {
                setIsGenerating(false)
                setProgress(0)
                setStatusText("")
            }, 2500)
        }
    }, [droids, gridOrder, cols, rows, bgColor, style])

    const isDisabled = droids.length < 2 || isGenerating

    return (
        <button
            onClick={generateGrid}
            disabled={isDisabled}
            className={`
        w-full h-12 rounded-full font-black uppercase tracking-widest text-xs transition-all shadow-lg flex items-center justify-center gap-2 flex-shrink-0
        ${isDisabled
                    ? "bg-white/10 border-2 border-white/20 text-white/40 cursor-not-allowed"
                    : "bg-white text-black border-2 border-white hover:bg-[#0069FF] hover:border-[#0069FF] hover:text-white hover:shadow-[0_0_20px_rgba(0,105,255,0.5)] cursor-pointer"
                }
      `}
        >
            {isGenerating ? (
                <div className="flex items-center gap-2">
                    <Loader2 className="animate-spin h-4 w-4" />
                    <span>{statusText}</span>
                </div>
            ) : (
                <>
                    <Download size={16} />
                    <span className="hidden sm:inline">Download & Flex Your Grid</span>
                    <span className="sm:hidden">Flex Your Grid</span>
                </>
            )}
        </button>
    )
}
