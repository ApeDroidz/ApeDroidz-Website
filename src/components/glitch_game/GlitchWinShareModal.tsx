"use client"

import { motion, AnimatePresence } from "framer-motion"
import { X, Loader2, Zap } from "lucide-react"
import { useState, useEffect } from "react"

/* ─── Supabase storage base ─── */
const STORAGE_BASE = "https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public"

function resolveCardImageUrl(raw: string | null | undefined): string {
    if (!raw) return ""
    if (raw.startsWith("http")) return raw
    return `${STORAGE_BASE}${raw}`
}

interface WonPrize {
    id: string
    type: string
    name: string
    imageUrl: string
    amount: number
    nftTokenId: string | null
}

interface GlitchWinShareModalProps {
    wonPrize: WonPrize | null
    xpGained: number
    shardsGained: number
    currentXp: number
    xpBefore: { level: number; progress: number; nextMilestone: number }
    xpAfter: { level: number; progress: number; nextMilestone: number }
    isOpen: boolean
    onClose: () => void
}

const CANVAS_W = 1200
const CANVAS_H = 1200

export function GlitchWinShareModal({
    wonPrize,
    xpGained,
    shardsGained,
    currentXp,
    xpBefore,
    xpAfter,
    isOpen,
    onClose,
}: GlitchWinShareModalProps) {
    const [isGenerating, setIsGenerating] = useState(false)
    const [statusText, setStatusText] = useState("")

    useEffect(() => {
        if (isOpen) {
            setIsGenerating(false)
            setStatusText("")
        }
    }, [isOpen])

    if (!wonPrize) return null

    const prizeImageUrl = resolveCardImageUrl(wonPrize.imageUrl)

    /* ─── Tweet text ─── */
    const buildTweetText = () => {
        const parts = [`Just won ${wonPrize.name}`]
        if (xpGained > 0) parts.push(`+ ${xpGained} XP`)
        if (shardsGained > 0 && wonPrize.type !== "shard") parts.push(`+ ${shardsGained} Shards`)
        return encodeURIComponent(
            parts.join(" ") + " in @ApeDroidz Glitch Game! 🎮⚡\n\nLet's Play on ApeDroidz.com"
        )
    }

    /* ─── Helpers ─── */
    const loadImage = (src: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
            const img = new Image()
            img.crossOrigin = "anonymous"
            img.onload = () => resolve(img)
            img.onerror = reject
            img.src = src
        })

    const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
        ctx.beginPath()
        ctx.moveTo(x + r, y)
        ctx.lineTo(x + w - r, y)
        ctx.quadraticCurveTo(x + w, y, x + w, y + r)
        ctx.lineTo(x + w, y + h - r)
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
        ctx.lineTo(x + r, y + h)
        ctx.quadraticCurveTo(x, y + h, x, y + h - r)
        ctx.lineTo(x, y + r)
        ctx.quadraticCurveTo(x, y, x + r, y)
        ctx.closePath()
    }

    /* ─── Render card onto canvas → PNG ─── */
    const generateCard = async (): Promise<string | null> => {
        setIsGenerating(true)
        setStatusText("Loading assets...")

        try {
            // Load all assets
            const [logo1Img, logo2Img, prizeImg] = await Promise.all([
                loadImage("/Apechain.svg"),
                loadImage("/full-logo.svg"),
                loadImage(prizeImageUrl),
            ])

            setStatusText("Rendering card...")

            const canvas = document.createElement("canvas")
            canvas.width = CANVAS_W
            canvas.height = CANVAS_H
            const ctx = canvas.getContext("2d")!

            const ACCENT = "#0069FF"
            const pad = 60

            // 1. Background
            ctx.fillStyle = "#090909"
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

            // Top glow
            const glow = ctx.createRadialGradient(CANVAS_W / 2, 0, 0, CANVAS_W / 2, 0, CANVAS_W * 0.7)
            glow.addColorStop(0, "rgba(0,105,255,0.20)")
            glow.addColorStop(1, "rgba(0,105,255,0)")
            ctx.fillStyle = glow
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H * 0.45)

            // 2. Outer border
            ctx.save()
            roundRect(ctx, 16, 16, CANVAS_W - 32, CANVAS_H - 32, 40)
            ctx.strokeStyle = "rgba(255,255,255,0.10)"
            ctx.lineWidth = 2
            ctx.stroke()
            ctx.restore()

            // 3. Top accent line
            const topGrad = ctx.createLinearGradient(0, 0, CANVAS_W, 0)
            topGrad.addColorStop(0, "transparent")
            topGrad.addColorStop(0.3, `${ACCENT}44`)
            topGrad.addColorStop(0.7, `${ACCENT}44`)
            topGrad.addColorStop(1, "transparent")
            ctx.fillStyle = topGrad
            ctx.fillRect(pad, 16, CANVAS_W - pad * 2, 3)

            // === TEXT ===
            ctx.textAlign = "center"
            ctx.textBaseline = "top"

            // "CONGRATS"
            let yPos = 55
            ctx.font = "700 42px Inter, Arial, sans-serif"
            ctx.fillStyle = "rgba(255,255,255,0.35)"
                ; (ctx as any).letterSpacing = "10px"
            ctx.fillText("CONGRATS", CANVAS_W / 2, yPos)
                ; (ctx as any).letterSpacing = "0px"

            // "YOU WON"
            yPos += 60
            ctx.font = "italic 900 96px Inter, Arial, sans-serif"
            ctx.fillStyle = "#ffffff"
                ; (ctx as any).letterSpacing = "-3px"
            ctx.fillText("YOU WON", CANVAS_W / 2, yPos)

            // Prize name
            yPos += 105
            ctx.font = "italic 900 78px Inter, Arial, sans-serif"
            ctx.fillStyle = ACCENT

            let prizeName = wonPrize.name.toUpperCase()
            const maxNameWidth = CANVAS_W - pad * 2
            while (ctx.measureText(prizeName).width > maxNameWidth && prizeName.length > 10) {
                prizeName = prizeName.slice(0, -4) + "..."
            }
            ctx.fillText(prizeName, CANVAS_W / 2, yPos)
                ; (ctx as any).letterSpacing = "0px"

            // === PRIZE IMAGE ===
            const imgSize = 620
            const imgX = (CANVAS_W - imgSize) / 2
            const imgY = yPos + 100

            // Glow behind image
            ctx.save()
            const imgGlow = ctx.createRadialGradient(
                CANVAS_W / 2, imgY + imgSize / 2, imgSize * 0.15,
                CANVAS_W / 2, imgY + imgSize / 2, imgSize * 0.6
            )
            imgGlow.addColorStop(0, "rgba(0,105,255,0.25)")
            imgGlow.addColorStop(1, "rgba(0,105,255,0)")
            ctx.fillStyle = imgGlow
            ctx.fillRect(imgX - 80, imgY - 80, imgSize + 160, imgSize + 160)
            ctx.restore()

            // Image with rounded corners
            ctx.save()
            roundRect(ctx, imgX, imgY, imgSize, imgSize, 28)
            ctx.clip()
            ctx.fillStyle = "#111111"
            ctx.fillRect(imgX, imgY, imgSize, imgSize)
            ctx.drawImage(prizeImg, imgX, imgY, imgSize, imgSize)
            ctx.restore()

            // Image border
            ctx.save()
            roundRect(ctx, imgX, imgY, imgSize, imgSize, 28)
            ctx.strokeStyle = "rgba(255,255,255,0.08)"
            ctx.lineWidth = 2
            ctx.stroke()
            ctx.restore()

            // === TOKEN ID ===
            let currentY = imgY + imgSize + 24
            if (wonPrize.type === "nft" && wonPrize.nftTokenId) {
                ctx.font = "600 22px 'Courier New', monospace"
                ctx.fillStyle = "rgba(255,255,255,0.25)"
                ctx.textAlign = "center"
                    ; (ctx as any).letterSpacing = "4px"
                ctx.fillText(`TOKEN #${wonPrize.nftTokenId}`, CANVAS_W / 2, currentY)
                    ; (ctx as any).letterSpacing = "0px"
                currentY += 36
            }

            // === XP PROGRESS BAR ===
            if (xpGained > 0) {
                currentY += 6
                const barX = pad + 20
                const barW = CANVAS_W - (pad + 20) * 2
                const barH = 22

                ctx.font = "900 24px Inter, Arial, sans-serif"
                ctx.textAlign = "left"
                ctx.fillStyle = ACCENT
                ctx.fillText(`⚡ +${xpGained} XP`, barX, currentY)

                ctx.font = "700 20px Inter, Arial, sans-serif"
                ctx.textAlign = "right"
                ctx.fillStyle = "rgba(255,255,255,0.25)"
                let levelText = `Lv.${xpBefore.level}`
                if (xpAfter.level > xpBefore.level) levelText += ` → Lv.${xpAfter.level}`
                ctx.fillText(levelText, barX + barW, currentY + 2)

                currentY += 34

                // Track
                ctx.save()
                roundRect(ctx, barX, currentY, barW, barH, barH / 2)
                ctx.fillStyle = "rgba(255,255,255,0.04)"
                ctx.fill()
                ctx.strokeStyle = "rgba(255,255,255,0.08)"
                ctx.lineWidth = 1.5
                ctx.stroke()
                ctx.restore()

                // Fill
                const fillW = Math.max(barH, (xpAfter.progress / 100) * barW)
                ctx.save()
                roundRect(ctx, barX, currentY, fillW, barH, barH / 2)
                ctx.clip()
                const barGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0)
                barGrad.addColorStop(0, "#0069FF")
                barGrad.addColorStop(1, "#00C2FF")
                ctx.fillStyle = barGrad
                ctx.fillRect(barX, currentY, fillW, barH)
                ctx.fillStyle = "rgba(255,255,255,0.15)"
                ctx.fillRect(barX, currentY, fillW, barH / 2)
                ctx.restore()

                currentY += barH + 10
                ctx.font = "700 18px Inter, Arial, sans-serif"
                ctx.textAlign = "left"
                ctx.fillStyle = "rgba(255,255,255,0.15)"
                ctx.fillText(`${currentXp.toLocaleString()} XP`, barX, currentY)
                ctx.textAlign = "right"
                ctx.fillText(`${xpAfter.nextMilestone.toLocaleString()} XP`, barX + barW, currentY)

                currentY += 30
            } else {
                currentY += 12
            }

            // === SHARDS ===
            if (shardsGained > 0) {
                ctx.font = "700 22px Inter, Arial, sans-serif"
                ctx.textAlign = "center"
                ctx.fillStyle = "rgba(255,255,255,0.3)"
                ctx.fillText(`+${shardsGained} Shards`, CANVAS_W / 2, currentY)
                currentY += 32
            }

            // === LOGOS ===
            const logoY = currentY + 16
            const logoHeight = 38
            const logoGap = 32

            const logo1Width = (logo1Img.width / logo1Img.height) * logoHeight
            const logo2HeightAdj = logoHeight * 1.1
            const logo2Width = (logo2Img.width / logo2Img.height) * logo2HeightAdj
            const totalLogosWidth = logo1Width + logoGap + logo2Width
            const logo1X = (CANVAS_W - totalLogosWidth) / 2

            // Invert to white
            const tempCanvas1 = document.createElement("canvas")
            tempCanvas1.width = Math.ceil(logo1Width)
            tempCanvas1.height = Math.ceil(logoHeight)
            const tempCtx1 = tempCanvas1.getContext("2d")!
            tempCtx1.drawImage(logo1Img, 0, 0, logo1Width, logoHeight)
            tempCtx1.globalCompositeOperation = "source-in"
            tempCtx1.fillStyle = "#ffffff"
            tempCtx1.fillRect(0, 0, logo1Width, logoHeight)

            ctx.globalAlpha = 0.5
            ctx.drawImage(tempCanvas1, logo1X, logoY)

            const logo2X = logo1X + logo1Width + logoGap
            const tempCanvas2 = document.createElement("canvas")
            tempCanvas2.width = Math.ceil(logo2Width)
            tempCanvas2.height = Math.ceil(logo2HeightAdj)
            const tempCtx2 = tempCanvas2.getContext("2d")!
            tempCtx2.drawImage(logo2Img, 0, 0, logo2Width, logo2HeightAdj)
            tempCtx2.globalCompositeOperation = "source-in"
            tempCtx2.fillStyle = "#ffffff"
            tempCtx2.fillRect(0, 0, logo2Width, logo2HeightAdj)

            ctx.drawImage(tempCanvas2, logo2X, logoY - (logo2HeightAdj - logoHeight) / 2)
            ctx.globalAlpha = 1.0

            setIsGenerating(false)
            return canvas.toDataURL("image/png")
        } catch (err) {
            console.error("Card render error:", err)
            setIsGenerating(false)
            return null
        }
    }

    /* ─── Main action ─── */
    const handleDownloadAndShare = async () => {
        const dataUrl = await generateCard()
        const filename = `ApeDroidz_Win_${wonPrize.name.replace(/\s+/g, "_")}.png`

        if (dataUrl) {
            const a = document.createElement("a")
            a.href = dataUrl
            a.download = filename
            a.click()

            setTimeout(() => {
                window.open(`https://x.com/intent/tweet?text=${buildTweetText()}`, "_blank")
            }, 1500)
        }
    }

    /* ─── CSS Preview Card ─── */
    const PreviewCard = () => (
        <div className="relative w-full h-full bg-[#090909] flex flex-col items-center overflow-hidden font-sans" style={{ containerType: "size" }}>
            {/* Top glow */}
            <div className="absolute top-0 inset-x-0 h-[35%] bg-[#0069FF]/15 blur-[80px] pointer-events-none" />

            {/* Border */}
            <div className="absolute inset-2 rounded-[28px] border border-white/10 pointer-events-none" />

            {/* Header */}
            <div className="relative z-10 flex flex-col items-center mt-[4.5cqw] w-full px-[5cqw]">
                <h2 className="text-[3.5cqw] font-bold text-white/35 uppercase tracking-[0.4em] leading-none mb-[1cqw]">
                    CONGRATS
                </h2>
                <p className="text-[8cqw] font-black italic text-white uppercase tracking-tight leading-[0.95] text-center">
                    YOU WON
                </p>
                <p className="text-[6.5cqw] font-black italic text-[#0069FF] uppercase tracking-tight leading-[0.95] text-center mt-[0.5cqw]">
                    {wonPrize.name}
                </p>
            </div>

            {/* Prize image */}
            <div className="relative z-10 mt-[3cqw] w-[52cqw] aspect-square">
                <div className="absolute inset-0 bg-[#0069FF] blur-[40px] opacity-22 rounded-full scale-130" />
                <div className="relative w-full h-full rounded-2xl border border-white/8 bg-[#111] overflow-hidden shadow-2xl">
                    <img src={prizeImageUrl} alt="" className="w-full h-full object-cover" />
                </div>
            </div>

            {/* Token ID */}
            {wonPrize.type === "nft" && wonPrize.nftTokenId && (
                <p className="relative z-10 font-mono text-[1.8cqw] text-white/25 uppercase tracking-[0.3em] mt-[1.5cqw]">
                    Token #{wonPrize.nftTokenId}
                </p>
            )}

            {/* XP Bar */}
            {xpGained > 0 && (
                <div className="relative z-10 w-[82%] mt-[1.5cqw]">
                    <div className="flex items-center justify-between mb-[0.6cqw]">
                        <div className="flex items-center gap-[0.5cqw]">
                            <Zap size={14} className="text-[#0069FF]" fill="currentColor" />
                            <span className="text-[2cqw] font-black text-white">+{xpGained} XP</span>
                        </div>
                        <span className="text-[1.6cqw] font-bold text-white/25">
                            Lv.{xpBefore.level}{xpAfter.level > xpBefore.level ? ` → Lv.${xpAfter.level}` : ""}
                        </span>
                    </div>
                    <div className="w-full h-[1.6cqw] rounded-full bg-white/5 border border-white/8 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-[#0069FF] to-[#00C2FF]"
                            style={{ width: `${xpAfter.progress}%` }}
                        />
                    </div>
                    <div className="flex justify-between mt-[0.3cqw]">
                        <span className="text-[1.4cqw] font-bold text-white/15">{currentXp.toLocaleString()} XP</span>
                        <span className="text-[1.4cqw] font-bold text-white/15">{xpAfter.nextMilestone.toLocaleString()} XP</span>
                    </div>
                </div>
            )}

            {/* Shards */}
            {shardsGained > 0 && (
                <p className="relative z-10 text-[1.8cqw] font-bold text-white/30 mt-[1cqw]">
                    +{shardsGained} Shards
                </p>
            )}

            {/* Logos */}
            <div className="relative z-10 mt-[2cqw] flex items-center gap-[3cqw] opacity-50">
                <img src="/Apechain.svg" alt="" className="h-[3cqw]" style={{ filter: "grayscale(100%) brightness(1000%)" }} />
                <img src="/full-logo.svg" alt="" className="h-[3.3cqw] brightness-0 invert" />
            </div>
        </div>
    )

    /* ─── RENDER ─── */
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={!isGenerating ? onClose : undefined}
                        className="absolute inset-0 bg-black/90 backdrop-blur-md"
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="relative w-full max-w-md flex flex-col items-center"
                    >
                        {/* Close */}
                        <button
                            onClick={!isGenerating ? onClose : undefined}
                            className={`absolute -top-12 right-0 p-2 text-white/50 hover:text-white transition-colors cursor-pointer ${isGenerating ? "opacity-0 pointer-events-none" : ""}`}
                        >
                            <X size={24} />
                        </button>

                        {/* Preview */}
                        <div
                            className="relative w-full rounded-2xl overflow-hidden border border-white/20 shadow-2xl mb-6 bg-[#090909]"
                            style={{ containerType: "size", aspectRatio: "1 / 1" }}
                        >
                            <PreviewCard />
                        </div>

                        {/* Download & Share Button */}
                        <div className="w-full">
                            <button
                                onClick={handleDownloadAndShare}
                                disabled={isGenerating}
                                className={`
                                    relative w-full h-14 rounded-xl font-black uppercase tracking-widest text-sm transition-all shadow-lg flex items-center justify-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed
                                    ${isGenerating
                                        ? "bg-[#0069FF] border-2 border-[#0069FF] text-white"
                                        : "bg-white text-black border-2 border-white hover:bg-[#0069FF] hover:border-[#0069FF] hover:text-white hover:shadow-[0_0_20px_rgba(0,105,255,0.6)] cursor-pointer"
                                    }
                                `}
                            >
                                {isGenerating ? (
                                    <div className="flex items-center gap-3">
                                        <Loader2 className="animate-spin h-5 w-5" />
                                        <span>{statusText || "Rendering..."}</span>
                                    </div>
                                ) : (
                                    <>
                                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                        </svg>
                                        Download & Flex on X
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}
