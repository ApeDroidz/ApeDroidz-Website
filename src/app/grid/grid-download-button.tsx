"use client"

import { useState, useCallback, useMemo } from "react"
import { NFTItem } from "@/app/upgrade_module/page"
import { resolveImageUrl } from "@/lib/utils"
import { droidAnimatedUrl, honoraryAnimatedUrl } from "@/lib/media"
import { Loader2, Download, Share2 } from "lucide-react"

interface GridDownloadButtonProps {
    droids: NFTItem[]
    gridOrder: string[]
}

const CANVAS_SIZE = 1200
const FRAME_DELAY = 190
const BLUE_BG = '#0247AF'
const ORANGE_BG = '#FF6C00'

// Check if droid is super
const isSuper = (item: NFTItem): boolean => {
    return (item.batteryType === 'Super') || !!item.metadata?.attributes?.some((a: any) =>
        (a.trait_type === "upgrade level" && a.value?.toLowerCase().includes("super")) ||
        (a.trait_type === "background" && a.value === "apechain_orange")
    )
}

const getAnimatedUrl = (item: NFTItem): string | null => {
    const tokenId = item.tokenId || item.id

    // Honorary is a separate collection with its own art: it has no levels, and
    // only the tokens that actually have a gif can animate.
    if (item.isHonorary) {
        return item.metadata?.has_gif ? honoraryAnimatedUrl(tokenId) : null
    }

    const level = item.level || 1
    if (level < 2) return null
    return droidAnimatedUrl(tokenId, isSuper(item))
}

// Calculate optimal grid dimensions (minimum 2)
const calculateGridDimensions = (count: number): { cols: number; rows: number } => {
    if (count < 2) return { cols: 2, rows: 1 }
    if (count === 2) return { cols: 2, rows: 1 }
    if (count === 3) return { cols: 3, rows: 1 }
    if (count === 4) return { cols: 2, rows: 2 }
    if (count === 5) return { cols: 3, rows: 2 }
    if (count === 6) return { cols: 3, rows: 2 }
    if (count <= 9) return { cols: 3, rows: 3 }
    if (count <= 12) return { cols: 4, rows: 3 }
    if (count <= 16) return { cols: 4, rows: 4 }
    if (count <= 20) return { cols: 5, rows: 4 }
    if (count <= 25) return { cols: 5, rows: 5 }

    const cols = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / cols)
    return { cols, rows }
}

const loadImage = (src: string, timeoutMs = 20000): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        const timer = setTimeout(() => {
            img.src = ''
            reject(new Error(`Image load timeout: ${src}`))
        }, timeoutMs)
        img.onload = () => {
            clearTimeout(timer)
            resolve(img)
        }
        img.onerror = () => {
            clearTimeout(timer)
            reject(new Error(`Image load failed: ${src}`))
        }
        img.src = src
    })
}

// Storage stores some art as .png and some as .webp (honorary = png only).
// Try the given URL, then the other extension, so a single naming mismatch
// never drops a cell from the canvas/GIF.
const loadImageWithFallback = async (src: string, timeoutMs = 20000): Promise<HTMLImageElement> => {
    try {
        return await loadImage(src, timeoutMs)
    } catch (err) {
        if (src.includes('.webp')) {
            return await loadImage(src.replace('.webp', '.png'), timeoutMs)
        }
        if (src.includes('.png')) {
            return await loadImage(src.replace('.png', '.webp'), timeoutMs)
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

export function GridDownloadButton({ droids, gridOrder }: GridDownloadButtonProps) {
    const [isGenerating, setIsGenerating] = useState(false)
    const [progress, setProgress] = useState(0)
    const [statusText, setStatusText] = useState("")

    const { cols, rows } = useMemo(() => calculateGridDimensions(droids.length), [droids.length])

    // Check if majority are super (>50%)
    const isSuperMajority = useMemo(() => {
        if (droids.length === 0) return false
        const superCount = droids.filter(d => isSuper(d)).length
        return superCount > droids.length / 2
    }, [droids])

    const bgColor = isSuperMajority ? ORANGE_BG : BLUE_BG

    // Check if there are any animated (level 2+) droids
    const hasAnimatedDroids = useMemo(() => {
        return droids.some(d => getAnimatedUrl(d) !== null)
    }, [droids])

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

        try {
            // Dynamic imports — browser-only libs that break SSR
            // @ts-ignore
            const { default: GIF } = await import('gif.js');
            // @ts-ignore
            const { default: gifFrames } = await import('gif-frames');
            const animatedDroids = droids.filter(d => getAnimatedUrl(d) !== null)
            const hasAnimations = animatedDroids.length > 0
            const MAX_FRAMES = 4

            // Calculate cell size
            const cellSize = CANVAS_SIZE / Math.max(cols, rows)
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
            const [logo1Img, logo2Img] = await Promise.all([
                loadImage('/Apechain.svg'),
                loadImage('/full-logo.svg')
            ])

            setStatusText("Loading images...")
            setProgress(10)

            type DroidFrames = { frames: (HTMLCanvasElement | HTMLImageElement)[]; delays: number[] }
            const droidFramesMap = new Map<string, DroidFrames>()
            const failedDroidIds = new Set<string>()

            for (let i = 0; i < orderedDroids.length; i++) {
                const droid = orderedDroids[i]
                if (!droid) continue

                setProgress(10 + Math.round((i / orderedDroids.length) * 40))

                const animUrl = getAnimatedUrl(droid)
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
                            const img = await loadImageWithFallback(resolveImageUrl(droid.image))
                            droidFramesMap.set(droid.id, { frames: [img], delays: [FRAME_DELAY] })
                        } catch (err) {
                            console.warn(`[grid] static fallback failed for ${droid.id}:`, err)
                            failedDroidIds.add(droid.id)
                        }
                    }
                } else {
                    try {
                        const img = await loadImageWithFallback(resolveImageUrl(droid.image))
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
                            ctx.imageSmoothingEnabled = false
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

                // Footer - only logos, centered
                const footerY = gridHeight

                // Logo sizing
                const baseLogoHeight = footerHeight * 0.28
                const maxLogoHeight = 50
                const logoHeight = Math.min(baseLogoHeight, maxLogoHeight)
                const logoGap = Math.min(cellSize * 0.08, 30)

                const logo1Width = (logo1Img.width / logo1Img.height) * logoHeight
                const logo2HeightAdj = logoHeight * 1.15
                const logo2Width = (logo2Img.width / logo2Img.height) * logo2HeightAdj
                const totalLogosWidth = logo1Width + logoGap + logo2Width
                const logosX = (canvasWidth - totalLogosWidth) / 2

                // Invert logos to white
                const tempCanvas1 = document.createElement('canvas')
                tempCanvas1.width = Math.ceil(logo1Width)
                tempCanvas1.height = Math.ceil(logoHeight)
                const tempCtx1 = tempCanvas1.getContext('2d')!
                tempCtx1.drawImage(logo1Img, 0, 0, logo1Width, logoHeight)
                tempCtx1.globalCompositeOperation = 'source-in'
                tempCtx1.fillStyle = '#ffffff'
                tempCtx1.fillRect(0, 0, logo1Width, logoHeight)

                const tempCanvas2 = document.createElement('canvas')
                tempCanvas2.width = Math.ceil(logo2Width)
                tempCanvas2.height = Math.ceil(logo2HeightAdj)
                const tempCtx2 = tempCanvas2.getContext('2d')!
                tempCtx2.drawImage(logo2Img, 0, 0, logo2Width, logo2HeightAdj)
                tempCtx2.globalCompositeOperation = 'source-in'
                tempCtx2.fillStyle = '#ffffff'
                tempCtx2.fillRect(0, 0, logo2Width, logo2HeightAdj)

                const logoY = footerY + (footerHeight - logoHeight) / 2
                ctx.drawImage(tempCanvas1, logosX, logoY)
                ctx.drawImage(tempCanvas2, logosX + logo1Width + logoGap, logoY - logo2HeightAdj * 0.05)

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
            setTimeout(() => {
                setIsGenerating(false)
                setProgress(0)
                setStatusText("")
            }, 2500)
        }
    }, [droids, gridOrder, cols, rows, bgColor])

    const isDisabled = droids.length < 2 || isGenerating

    return (
        <button
            onClick={generateGrid}
            disabled={isDisabled}
            className={`
        w-full h-12 rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg flex items-center justify-center gap-2 flex-shrink-0
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
