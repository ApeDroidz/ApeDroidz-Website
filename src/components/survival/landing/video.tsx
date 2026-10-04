'use client'

import { useEffect, useRef, useState } from 'react'
import { Maximize2, Play, Volume2, VolumeX } from 'lucide-react'

const VIDEO_SRC = 'https://assets.apedroidz.com/apedroidz/droidz-survival/media/beta-announce.mp4'
const GESTURES = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
const VIDEO_POSTER = 'https://assets.apedroidz.com/apedroidz/droidz-survival/media/beta-announce-poster.jpg'

/**
 * The gameplay video (the beta trailer on R2, H.264, moov first). On a desktop it plays at once,
 * muted and looped, and only while on screen. On a phone (or with reduced motion) it is the poster with a play
 * button — nothing is downloaded until the tap, and the tap plays it with sound.
 */
/** `scrim`: a dark fade on the left on a wide screen, for the hero's words laid over the video. */
export function GameplayVideo({ tapToPlay, scrim = false }: { tapToPlay: boolean; scrim?: boolean }) {
    const ref = useRef<HTMLVideoElement>(null)
    const box = useRef<HTMLDivElement>(null)
    const [muted, setMuted] = useState(true)
    const [started, setStarted] = useState(false)
    const [reduced, setReduced] = useState(false)
    const manual = tapToPlay || reduced

    useEffect(() => {
        try { setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches) } catch { /* old browser */ }
    }, [])

    // Desktop: plays at once, muted, looped, while at least a fifth of it is on screen; paused off
    // screen. A browser that refuses autoplay (Safari in Low Power mode, a strict setting) gets it
    // started on the first click, key or scroll anywhere on the page.
    useEffect(() => {
        const v = ref.current
        if (!v || manual) return
        let visible = false
        const kick = () => {
            if (!visible) return
            v.muted = true
            void v.play().then(() => setStarted(true)).catch(() => {
                const retry = () => { off(); if (visible) void v.play().then(() => setStarted(true)).catch(() => {}) }
                const off = () => { for (const ev of GESTURES) window.removeEventListener(ev, retry) }
                for (const ev of GESTURES) window.addEventListener(ev, retry, { once: true, passive: true })
            })
        }
        const io = new IntersectionObserver(([e]) => {
            visible = e.isIntersecting
            if (visible) kick()
            else v.pause()
        }, { threshold: 0.2 })
        io.observe(v)
        return () => io.disconnect()
    }, [manual])

    // Leaving the page (PLAY): the decoder and the buffer go at once, not whenever the browser
    // collects. The source is put back on (re)mount — React's dev double-mount runs this cleanup
    // once and never sets `src` again, which left the video with nothing to play (owner, 04.10:
    // «видео на фоне не воспроизводится»).
    useEffect(() => {
        const v = ref.current
        if (v && !v.getAttribute('src')) { v.setAttribute('src', VIDEO_SRC); v.load() }
        return () => {
            if (!v) return
            try { v.pause(); v.removeAttribute('src'); v.load() } catch { /* already gone */ }
        }
    }, [])

    const tapPlay = () => {
        const v = ref.current
        if (!v) return
        // Inside the tap: a phone lets a video with sound start only here.
        v.muted = false
        setMuted(false)
        void v.play().then(() => setStarted(true)).catch(() => { v.muted = true; setMuted(true); void v.play().then(() => setStarted(true)).catch(() => {}) })
    }
    const toggleSound = () => {
        const v = ref.current
        if (!v) return
        v.muted = !v.muted
        setMuted(v.muted)
        if (!v.muted && v.paused) void v.play()
    }
    const fullscreen = () => {
        const v = ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
        if (!v) return
        if (box.current?.requestFullscreen) void box.current.requestFullscreen().catch(() => v.webkitEnterFullscreen?.())
        else v.webkitEnterFullscreen?.()
    }

    return (
        <div ref={box} data-testid="gameplay-video" className="group relative overflow-hidden rounded-3xl border border-white/10 bg-black">
            <div className="relative aspect-[1920/974] w-full">
                <video
                    ref={ref}
                    src={VIDEO_SRC}
                    poster={VIDEO_POSTER}
                    muted
                    loop
                    playsInline
                    autoPlay={!manual}
                    preload={manual ? 'none' : 'auto'}
                    className="absolute inset-0 h-full w-full object-cover"
                    onClick={manual && !started ? tapPlay : toggleSound}
                />
            </div>
            {scrim && <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 32%, rgba(0,0,0,0) 62%), linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 40%)' }} />}
            {manual && !started ? (
                <button
                    onClick={tapPlay}
                    aria-label="Play the trailer"
                    data-testid="video-play"
                    className="absolute inset-0 grid place-items-center bg-black/25 transition-colors hover:bg-black/10"
                >
                    <span className="grid h-16 w-16 place-items-center rounded-full bg-white text-black shadow-[0_0_30px_rgba(255,255,255,0.35)]">
                        <Play className="ml-1 h-7 w-7" fill="currentColor" />
                    </span>
                </button>
            ) : (
                <div className="absolute bottom-3 right-3 flex items-center gap-2">
                    <button
                        onClick={toggleSound}
                        aria-label={muted ? 'Turn the sound on' : 'Mute'}
                        className="flex h-9 items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3 font-mono text-[10px] uppercase tracking-widest text-white backdrop-blur transition-colors hover:bg-white hover:text-black"
                    >
                        {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                        {muted ? 'Sound on' : 'Mute'}
                    </button>
                    <button
                        onClick={fullscreen}
                        aria-label="Fullscreen"
                        className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur transition-colors hover:bg-white hover:text-black"
                    >
                        <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}
        </div>
    )
}
