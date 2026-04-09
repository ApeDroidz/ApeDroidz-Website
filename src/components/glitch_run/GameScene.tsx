'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ─── Seeded RNG ───────────────────────────────────────────────────────────────
function seededRand(seed: number) {
    let s = seed
    return () => {
        s = (s * 1664525 + 1013904223) & 0xffffffff
        return (s >>> 0) / 0xffffffff
    }
}

// ─── Cloud config ─────────────────────────────────────────────────────────────
interface CloudConfig {
    id: number
    svgNum: number
    baseDuration: number
    delay: number
    yStartPct: number
    xStartPct: number
    zFront: boolean
    scale: number
    opacity: number
}

const CLOUDS: CloudConfig[] = Array.from({ length: 16 }, (_, i) => {
    const r = seededRand(i * 137 + 42)
    return {
        id: i,
        svgNum: (i % 9) + 1,
        baseDuration: 7 + r() * 12,
        delay: -(r() * 20),
        yStartPct: 5 + r() * 75,
        xStartPct: 95 + r() * 25,
        zFront: r() > 0.55,
        scale: 0.35 + r() * 0.9,
        opacity: 0.5 + r() * 0.5,
    }
})

// ─── Smooth speed factor — 1× at m=1, ~6× at m=25+ ─────────────────────────
function speedFactor(m: number): number {
    if (!isFinite(m) || m < 1) return 1
    return Math.min(1 + (m - 1) * 0.22, 6)
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const FLIGHT_STYLES = `
@keyframes cloudSlide {
    from { transform: translate(0px, 0px) rotate(-24deg); }
    to   { transform: translate(-145vw, 64vh) rotate(-24deg); }
}
@keyframes fillProgress {
    from { clip-path: inset(0 100% 0 0); }
    to   { clip-path: inset(0 0% 0 0); }
}
@keyframes landEnter {
    from { transform: translateY(100%); }
    to   { transform: translateY(0%); }
}
@keyframes landExit {
    from { transform: translateY(0%); }
    to   { transform: translateY(110%); }
}
@keyframes coinTravel {
    from { transform: translate(0px, 0px) rotate(-24deg); }
    to   { transform: translate(-145vw, 64vh) rotate(-24deg); }
}
@keyframes coinSpin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
}
@keyframes coinBurst0 { from { transform: translate(0,0) scale(1); opacity:1; } to { transform: translate(-320px,-520px) scale(0.9); opacity:1; } }
@keyframes coinBurst1 { from { transform: translate(0,0) scale(1); opacity:1; } to { transform: translate(80px,-560px) scale(0.9); opacity:1; } }
@keyframes coinBurst2 { from { transform: translate(0,0) scale(1); opacity:1; } to { transform: translate(460px,-300px) scale(0.9); opacity:1; } }
@keyframes coinBurst3 { from { transform: translate(0,0) scale(1); opacity:1; } to { transform: translate(520px,120px) scale(0.9); opacity:1; } }
@keyframes coinBurst4 { from { transform: translate(0,0) scale(1); opacity:1; } to { transform: translate(290px,490px) scale(0.9); opacity:1; } }
@keyframes coinBurst5 { from { transform: translate(0,0) scale(1); opacity:1; } to { transform: translate(-340px,460px) scale(0.9); opacity:1; } }
@keyframes cashoutFlash {
    0%   { opacity: 0; }
    15%  { opacity: 0.55; }
    45%  { opacity: 0.35; }
    100% { opacity: 0; }
}
@keyframes crashTextGlitch {
    0%   { transform: translate(0,0) skewX(0deg);    opacity: 1; clip-path: inset(0 0 0 0); }
    15%  { transform: translate(-6px,0) skewX(-4deg); opacity: 1; clip-path: inset(20% 0 30% 0); }
    30%  { transform: translate(6px,0)  skewX(4deg);  opacity: 1; clip-path: inset(60% 0 5% 0); }
    45%  { transform: translate(-4px,0) skewX(-2deg); opacity: 0.8; clip-path: inset(10% 0 70% 0); }
    60%  { transform: translate(8px,0)  skewX(3deg);  opacity: 0.6; clip-path: inset(40% 0 20% 0); }
    75%  { transform: translate(-8px,0) skewX(-5deg); opacity: 0.4; clip-path: inset(70% 0 10% 0); }
    90%  { transform: translate(4px,0)  skewX(2deg);  opacity: 0.2; clip-path: inset(5% 0 80% 0); }
    100% { transform: translate(0,0) skewX(0deg);    opacity: 0;   clip-path: inset(50% 0 50% 0); }
}
@keyframes graphicSway {
    0%   { transform: translate(0px,  0px); }
    20%  { transform: translate(5px,  -8px); }
    45%  { transform: translate(-4px, -12px); }
    70%  { transform: translate(6px,  -5px); }
    100% { transform: translate(0px,  0px); }
}

/* ── Glitch layers ── */
@keyframes glitch-anim-1 {
    0%  { clip-path: inset(50% 0 30% 0); transform: translate(-5px, 0); }
    5%  { clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); }
    10% { clip-path: inset(80% 0 5%  0); transform: translate(-5px, 0); }
    15% { clip-path: inset(30% 0 60% 0); transform: translate(5px, 0); }
    20% { clip-path: inset(60% 0 20% 0); transform: translate(-5px, 0); }
    25% { clip-path: inset(10% 0 85% 0); transform: translate(5px, 0); }
    30% { clip-path: inset(40% 0 40% 0); transform: translate(-5px, 0); }
    35% { clip-path: inset(80% 0 10% 0); transform: translate(5px, 0); }
    40% { clip-path: inset(20% 0 50% 0); transform: translate(-5px, 0); }
    45% { clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); }
    50% { clip-path: inset(10% 0 80% 0); transform: translate(-5px, 0); }
    55% { clip-path: inset(70% 0 20% 0); transform: translate(5px, 0); }
    60% { clip-path: inset(30% 0 60% 0); transform: translate(-5px, 0); }
    65% { clip-path: inset(90% 0 5%  0); transform: translate(5px, 0); }
    70% { clip-path: inset(15% 0 80% 0); transform: translate(-5px, 0); }
    75% { clip-path: inset(55% 0 10% 0); transform: translate(5px, 0); }
    80% { clip-path: inset(25% 0 50% 0); transform: translate(-5px, 0); }
    85% { clip-path: inset(75% 0 15% 0); transform: translate(5px, 0); }
    90% { clip-path: inset(10% 0 85% 0); transform: translate(-5px, 0); }
    95% { clip-path: inset(45% 0 45% 0); transform: translate(5px, 0); }
    100%{ clip-path: inset(50% 0 30% 0); transform: translate(-5px, 0); }
}
@keyframes glitch-anim-2 {
    0%  { clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); }
    5%  { clip-path: inset(80% 0 10% 0); transform: translate(-5px, 0); }
    10% { clip-path: inset(30% 0 60% 0); transform: translate(5px, 0); }
    15% { clip-path: inset(70% 0 20% 0); transform: translate(-5px, 0); }
    20% { clip-path: inset(10% 0 40% 0); transform: translate(5px, 0); }
    25% { clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); }
    30% { clip-path: inset(20% 0 70% 0); transform: translate(5px, 0); }
    35% { clip-path: inset(90% 0 5%  0); transform: translate(-5px, 0); }
    40% { clip-path: inset(30% 0 50% 0); transform: translate(5px, 0); }
    45% { clip-path: inset(60% 0 20% 0); transform: translate(-5px, 0); }
    50% { clip-path: inset(10% 0 85% 0); transform: translate(5px, 0); }
    55% { clip-path: inset(80% 0 10% 0); transform: translate(-5px, 0); }
    60% { clip-path: inset(40% 0 40% 0); transform: translate(5px, 0); }
    65% { clip-path: inset(20% 0 70% 0); transform: translate(-5px, 0); }
    70% { clip-path: inset(70% 0 15% 0); transform: translate(5px, 0); }
    75% { clip-path: inset(10% 0 80% 0); transform: translate(-5px, 0); }
    80% { clip-path: inset(50% 0 30% 0); transform: translate(5px, 0); }
    85% { clip-path: inset(25% 0 60% 0); transform: translate(-5px, 0); }
    90% { clip-path: inset(85% 0 5%  0); transform: translate(5px, 0); }
    95% { clip-path: inset(35% 0 50% 0); transform: translate(-5px, 0); }
    100%{ clip-path: inset(10% 0 80% 0); transform: translate(5px, 0); }
}

.flight-glitch-wrap {
    position: relative; width: 100%; height: 100%;
    isolation: isolate;
}
.flight-glitch-layer {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background-color: transparent; pointer-events: none;
    z-index: 20;
}
.fg-i0 .fg-l1, .fg-i0 .fg-l2 { opacity: 0; animation: none !important; }
.fg-i1 .fg-l1 { animation: glitch-anim-1 4s infinite step-end alternate-reverse; opacity: 0.25; }
.fg-i1 .fg-l2 { animation: glitch-anim-2 4s infinite step-end alternate-reverse; opacity: 0.25; }
.fg-i2 .fg-l1 { animation: glitch-anim-1 1.5s infinite step-end alternate-reverse; opacity: 0.6; }
.fg-i2 .fg-l2 { animation: glitch-anim-2 1.5s infinite step-end alternate-reverse; opacity: 0.6; }
.fg-i3 .fg-l1 { animation: glitch-anim-1 0.12s infinite step-end alternate-reverse; opacity: 0.9; }
.fg-i3 .fg-l2 { animation: glitch-anim-2 0.12s infinite step-end alternate-reverse; opacity: 0.9; }
`

// ─── Flying coins config ──────────────────────────────────────────────────────
interface CoinConfig {
    id: number
    svgNum: number
    baseDuration: number
    delay: number
    yStartPct: number
    xStartPct: number
    size: number
    spinDuration: number  // seconds for one full rotation
}

const COINS: CoinConfig[] = Array.from({ length: 4 }, (_, i) => {
    const r = seededRand(i * 251 + 77)
    return {
        id: i,
        svgNum: (i % 3) + 1,
        baseDuration: 5 + r() * 8,
        delay: -(r() * 18),
        yStartPct: 20 + r() * 55,
        xStartPct: 96 + r() * 22,
        size: 26 + r() * 16,        // 26–42px
        spinDuration: 1.4 + r() * 2, // 1.4–3.4s per rotation — each coin unique
    }
})

// ─── Glitch intensity from multiplier ────────────────────────────────────────
function glitchIntensity(multiplier: number): 0 | 1 | 2 | 3 {
    if (multiplier < 2)   return 0
    if (multiplier < 5)   return 1
    if (multiplier < 10)  return 2
    return 3
}

// ─── Cloud component ──────────────────────────────────────────────────────────
function Cloud({ cfg, duration }: { cfg: CloudConfig; duration: number }) {
    return (
        <img
            src={`/flight/cloud_${cfg.svgNum}.svg`}
            alt=""
            draggable={false}
            style={{
                position: 'absolute',
                top: `${cfg.yStartPct}%`,
                left: `${cfg.xStartPct}%`,
                width: `${cfg.scale * 208}px`,
                opacity: cfg.opacity,
                zIndex: cfg.zFront ? 20 : 8,
                animation: `cloudSlide ${duration}s linear ${cfg.delay}s infinite`,
                pointerEvents: 'none',
                userSelect: 'none',
                willChange: 'transform',
                transformOrigin: 'center center',
            }}
        />
    )
}

// ─── Graphic SVG ──────────────────────────────────────────────────────────────
function multiplierColor(multiplier: number): string {
    if (multiplier < 2)  return '#00FF94'
    if (multiplier < 5)  return '#fde047'
    return '#fb923c'
}

function GraphicSVG({ color }: { color: string }) {
    return (
        <svg
            width="1562" height="550" viewBox="0 0 1562 550" fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: '100%', display: 'block', filter: `drop-shadow(0 0 9.7px ${color})`, transition: 'filter 0.4s ease-out' }}
        >
            <defs>
                <linearGradient id="gc-grad" x1="774.5" y1="12.2031" x2="774.5" y2="564.203" gradientUnits="userSpaceOnUse">
                    <stop style={{ stopColor: color, stopOpacity: 0.81, transition: 'stop-color 0.4s ease-out' }} />
                    <stop offset="0.9" style={{ stopColor: color, stopOpacity: 0, transition: 'stop-color 0.4s ease-out' }} />
                </linearGradient>
            </defs>
            <path d="M33 450.203C661.8 447.403 1305.67 157.036 1549 12.2031V549.703H0L33 450.203Z" fill="url(#gc-grad)" />
            <path
                d="M1549 12.2031C1305.67 157.036 661.8 447.403 33 450.203"
                stroke={color}
                strokeWidth="5"
                strokeLinecap="round"
                style={{ transition: 'stroke 0.4s ease-out' }}
            />
        </svg>
    )
}

// ─── Logo preloader ───────────────────────────────────────────────────────────
function LogoPreloader({ fillKey, total, countdown, sf }: { fillKey: number; total: number; countdown: number; sf: number }) {
    const lw = Math.round(144 * Math.max(0.55, sf))
    const lh = Math.round(151 * Math.max(0.55, sf))
    const fs = Math.round(45 * Math.max(0.6, sf))
    return (
        <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: Math.round(16 * Math.max(0.6, sf)),
        }}>
            <div style={{ fontFamily: 'monospace', fontSize: fs, fontWeight: 900, color: 'white', lineHeight: 1, margin: 0 }}>
                {countdown}
            </div>

            <div style={{ position: 'relative', width: lw, height: lh, flexShrink: 0 }}>
                <img src="/flight/flight_logo.svg" alt="" draggable={false}
                    style={{ position: 'absolute', inset: 0, width: lw, height: lh, opacity: 0.18, display: 'block' }}
                />
                <img key={fillKey} src="/flight/flight_logo.svg" alt="" draggable={false}
                    style={{ position: 'absolute', inset: 0, width: lw, height: lh, display: 'block', animation: `fillProgress ${total}s linear forwards` }}
                />
            </div>

            <p style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,1)', letterSpacing: '0.22em', textTransform: 'uppercase', margin: 0 }}>
                Preparing launch
            </p>
        </div>
    )
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface GameSceneProps {
    crashed: boolean
    multiplier: number
    elapsed: number
    phase: 'waiting' | 'running' | 'crashed'
    countdown: number
    cashedOut?: boolean
}

// ─── Main scene ───────────────────────────────────────────────────────────────
export function GameScene({ multiplier, phase, countdown, cashedOut }: GameSceneProps) {
    const [enterKey, setEnterKey] = useState(0)
    const [fillKey, setFillKey] = useState(0)
    const [boomKey, setBoomKey] = useState(0)
    const [cloudsVisible, setCloudsVisible] = useState(false)
    const [showGraphic, setShowGraphic] = useState(false)
    const [landEnterKey, setLandEnterKey] = useState(0)
    const [showLandExit, setShowLandExit] = useState(false)
    const [coinBurstKey, setCoinBurstKey] = useState(0)
    const [showCoinBurst, setShowCoinBurst] = useState(false)
    const [flashKey, setFlashKey] = useState(0)
    const [showFlash, setShowFlash] = useState(false)
    const [showCrashText, setShowCrashText] = useState(false)
    const [crashTextExit, setCrashTextExit] = useState(false)
    const prevCashedOut = useRef(cashedOut)
    const prevPhase = useRef(phase)
    const cloudContainerRef = useRef<HTMLDivElement>(null)
    const coinContainerRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [canvasW, setCanvasW] = useState(800)
    const TOTAL_COUNTDOWN = 5

    // Measure canvas width for responsive scaling
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        setCanvasW(el.clientWidth)
        const ro = new ResizeObserver(([e]) => setCanvasW(e.contentRect.width))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // Scale factor: 1.0 at 800px design width
    const sf = Math.min(1, canvasW / 800)
    const droidW = Math.round(281 * Math.max(0.45, sf))
    const boomW  = Math.round(468 * Math.max(0.45, sf))

    useEffect(() => {
        const prev = prevPhase.current
        if (prev !== 'crashed' && phase === 'crashed') {
            setBoomKey(k => k + 1)
            setCloudsVisible(false)
            setCrashTextExit(false)
            // Graphic: flash red 200ms then disappear
            const t1 = setTimeout(() => setShowGraphic(false), 200)
            // Crash text: appear after boom (400ms), glitch-exit after 1.6s more
            const t2 = setTimeout(() => setShowCrashText(true), 400)
            const t3 = setTimeout(() => setCrashTextExit(true), 2000)
            const t4 = setTimeout(() => setShowCrashText(false), 2500)
            return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
        }
        if (prev === 'crashed' && phase === 'waiting') {
            setShowCrashText(false)
            setCrashTextExit(false)
            setFillKey(k => k + 1)
            setLandEnterKey(k => k + 1)
            // Reset playback speed on all travel animations
            ;[cloudContainerRef, coinContainerRef].forEach(ref => {
                ref.current?.getAnimations({ subtree: true }).forEach(a => {
                    const name = (a as Animation & { animationName?: string }).animationName ?? ''
                    if (name === 'cloudSlide' || name === 'coinTravel') {
                        a.playbackRate = 1
                    }
                })
            })
        }
        if (prev === 'waiting' && phase === 'running') {
            setEnterKey(k => k + 1)
            setCloudsVisible(true)
            setShowGraphic(true)
            setShowLandExit(true)
            const t = setTimeout(() => setShowLandExit(false), 800)
            return () => clearTimeout(t)
        }
        prevPhase.current = phase
    }, [phase])

    // Smooth speed — update playbackRate on every multiplier tick (no remount)
    useEffect(() => {
        if (phase !== 'running') return
        const speed = speedFactor(multiplier)
        ;[cloudContainerRef, coinContainerRef].forEach(ref => {
            ref.current?.getAnimations({ subtree: true }).forEach(a => {
                // Only speed up travel animations, not spin
                const name = (a as Animation & { animationName?: string }).animationName ?? ''
                if (name === 'cloudSlide' || name === 'coinTravel') {
                    a.playbackRate = speed
                }
            })
        })
    }, [multiplier, phase])

    // Coin burst + blue flash on cashout
    useEffect(() => {
        if (cashedOut && !prevCashedOut.current) {
            setCoinBurstKey(k => k + 1)
            setShowCoinBurst(true)
            setFlashKey(k => k + 1)
            setShowFlash(true)
            const t1 = setTimeout(() => setShowCoinBurst(false), 2200)
            const t2 = setTimeout(() => setShowFlash(false), 700)
            return () => { clearTimeout(t1); clearTimeout(t2) }
        }
        prevCashedOut.current = cashedOut
    }, [cashedOut])

    const intensity = phase === 'running' ? glitchIntensity(multiplier) : 0

    const glitchContent = (
        <div className="absolute inset-0 overflow-hidden" style={{ background: '#060b14' }}>
            <img src="/flight/flight_bg.png" alt="" draggable={false}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ zIndex: 0, pointerEvents: 'none' }}
            />
        </div>
    )

    const graphicColor = phase === 'crashed' ? '#f87171' : multiplierColor(multiplier)

    return (
        <>
            <style suppressHydrationWarning dangerouslySetInnerHTML={{ __html: FLIGHT_STYLES }} />

            <div ref={containerRef} className="relative w-full h-full overflow-hidden select-none" style={{ background: '#060b14' }}>
                {/* ── Glitch wrapper: bg only (rendered 3×) ── */}
                <div className={`flight-glitch-wrap fg-i${intensity} absolute inset-0`} style={{ zIndex: 1 }}>
                    <div className="relative z-10 w-full h-full">{glitchContent}</div>
                    <div className="flight-glitch-layer fg-l1" aria-hidden="true">{glitchContent}</div>
                    <div className="flight-glitch-layer fg-l2" aria-hidden="true">{glitchContent}</div>
                </div>

                {/* ── Clouds — playbackRate controlled via ref ── */}
                <div
                    ref={cloudContainerRef}
                    style={{
                        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
                        opacity: cloudsVisible ? 1 : 0,
                        transition: cloudsVisible ? 'opacity 0.9s ease-in' : 'opacity 2.8s ease-out',
                    }}
                >
                    {CLOUDS.filter(c => !c.zFront).map(cfg => (
                        <Cloud key={cfg.id} cfg={cfg} duration={cfg.baseDuration} />
                    ))}
                    {CLOUDS.filter(c => c.zFront).map(cfg => (
                        <Cloud key={cfg.id} cfg={cfg} duration={cfg.baseDuration} />
                    ))}
                </div>

                {/* ── Flying coins — travel + spin, playbackRate on travel via ref ── */}
                {phase === 'running' && (
                    <div ref={coinContainerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
                        {COINS.map(cfg => (
                            <div
                                key={cfg.id}
                                style={{
                                    position: 'absolute',
                                    top: `${cfg.yStartPct}%`,
                                    left: `${cfg.xStartPct}%`,
                                    width: cfg.size,
                                    height: cfg.size,
                                    animation: `coinTravel ${cfg.baseDuration}s linear ${cfg.delay}s infinite`,
                                    willChange: 'transform',
                                }}
                            >
                                <img
                                    src={`/flight/coin${cfg.svgNum}.svg`}
                                    alt=""
                                    draggable={false}
                                    style={{
                                        width: '100%', height: '100%',
                                        objectFit: 'contain', display: 'block',
                                        animation: `coinSpin ${cfg.spinDuration}s linear infinite`,
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                )}

                {/* ── Graphic — top-right tip anchored to droid's orange flame ── */}
                <AnimatePresence>
                    {showGraphic && (
                        <motion.div
                            key={`graphic-${enterKey}`}
                            initial={{ x: '-40vw', y: '28vh', opacity: 0 }}
                            animate={{ x: 0, y: 0, opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1], opacity: { duration: phase === 'crashed' ? 0.15 : 0.5 } }}
                            style={{
                                position: 'absolute',
                                width: '62%',
                                right: '50%',
                                top: `calc(30% + ${Math.round(60 * sf)}px)`,
                                zIndex: 2,  // behind droid (z:3)
                                pointerEvents: 'none',
                            }}
                        >
                            <div style={{ animation: 'graphicSway 3.2s ease-in-out 1.5s infinite' }}>
                                <GraphicSVG color={graphicColor} />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ── Droid / boom ── */}
                <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 25, pointerEvents: 'none',
                }}>
                    <AnimatePresence mode="wait">
                        {phase === 'running' && (
                            <motion.div
                                key="droid"
                                initial={{ x: '-38vw', y: '30vh', opacity: 0 }}
                                animate={{ x: 0, y: 0, opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], opacity: { duration: 0.3 } }}
                                style={{ rotate: -22 }}
                            >
                                <img
                                    key={`gif-${enterKey}`}
                                    src={`/flight/drd_flight.gif?r=${enterKey}`}
                                    alt="droid"
                                    draggable={false}
                                    style={{ width: droidW, height: 'auto', display: 'block' }}
                                />
                            </motion.div>
                        )}
                        {phase === 'crashed' && (
                            <motion.div
                                key={`boom-${boomKey}`}
                                initial={{ opacity: 0, scale: 0.65 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 1.3 }}
                                transition={{ duration: 0.15 }}
                            >
                                <img src={`/flight/boom.gif?r=${boomKey}`} alt="boom" draggable={false}
                                    style={{ width: boomW, height: boomW, objectFit: 'contain', display: 'block' }} />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* ── Crashed text — scales in after boom, glitch-exits ── */}
                <AnimatePresence>
                    {showCrashText && (
                        <motion.div
                            key="crash-text"
                            initial={{ scale: 0.2, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 1.05, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 380, damping: 22, opacity: { duration: 0.15 } }}
                            style={{
                                position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            <img
                                src="/flight/crashed.png"
                                alt="crashed"
                                draggable={false}
                                style={{
                                    width: `${Math.round(450 * Math.max(0.45, sf))}px`,
                                    maxWidth: '80%',
                                    display: 'block',
                                    animation: crashTextExit ? 'crashTextGlitch 0.5s steps(1) forwards' : 'none',
                                }}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ── Blue flash on cashout ── */}
                {showFlash && (
                    <div
                        key={flashKey}
                        style={{
                            position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none',
                            background: 'radial-gradient(ellipse at center, rgba(0,180,255,0.7) 0%, rgba(0,100,200,0.45) 50%, transparent 80%)',
                            animation: 'cashoutFlash 0.7s ease-out forwards',
                        }}
                    />
                )}

                {/* ── Coin burst on cashout — 22px, 2s, fly off screen ── */}
                {showCoinBurst && (
                    <div
                        key={coinBurstKey}
                        style={{
                            position: 'absolute', inset: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            zIndex: 51, pointerEvents: 'none',
                        }}
                    >
                        {[0,1,2,3,4,5].map(i => (
                            <img
                                key={i}
                                src={`/flight/coin${(i % 3) + 1}.svg`}
                                alt=""
                                draggable={false}
                                style={{
                                    position: 'absolute',
                                    width: 22, height: 22,
                                    animation: `coinBurst${i} 2s cubic-bezier(0.22,1,0.36,1) forwards`,
                                }}
                            />
                        ))}
                    </div>
                )}

                {/* ── Speed lines ── */}
                {phase === 'running' && multiplier > 3 && (
                    <div className="absolute inset-0 pointer-events-none"
                        style={{ zIndex: 4, opacity: Math.min((multiplier - 3) * 0.04, 0.35) }}>
                        {Array.from({ length: 10 }, (_, i) => (
                            <div key={i} style={{
                                position: 'absolute',
                                top: `${10 + i * 8}%`, right: 0,
                                width: `${30 + (i % 3) * 20}%`, height: '1px',
                                background: 'linear-gradient(to left, transparent, rgba(255,255,255,0.4), transparent)',
                                transform: 'rotate(-24deg)', transformOrigin: 'right center',
                            }} />
                        ))}
                    </div>
                )}

                {/* ── Land enter ── */}
                {phase === 'waiting' && (
                    <div
                        key={landEnterKey}
                        style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            zIndex: 1, pointerEvents: 'none',
                            animation: 'landEnter 0.55s cubic-bezier(0.22,1,0.36,1) forwards',
                        }}
                    >
                        <img src="/flight/land.png" alt="" draggable={false} style={{ width: '100%', display: 'block' }} />
                    </div>
                )}

                {/* ── Land exit ── */}
                {showLandExit && (
                    <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        zIndex: 1, pointerEvents: 'none',
                        animation: 'landExit 0.7s cubic-bezier(0.55,0,1,0.45) forwards',
                    }}>
                        <img src="/flight/land.png" alt="" draggable={false} style={{ width: '100%', display: 'block' }} />
                    </div>
                )}

                {/* ── Preloader ── */}
                <AnimatePresence>
                    {phase === 'waiting' && (
                        <motion.div
                            key="preloader"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            style={{ position: 'absolute', inset: 0, zIndex: 100, pointerEvents: 'none' }}
                        >
                            <LogoPreloader fillKey={fillKey} total={TOTAL_COUNTDOWN} countdown={countdown} sf={sf} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </>
    )
}
