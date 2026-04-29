"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Music, Volume2, VolumeX } from "lucide-react"

/**
 * Two-icon audio control for /glitch_flight:
 *   • Music (looping bg track at /sounds/fx/bg_sound.wav)
 *   • SFX  (UI click/hover, cashout, wind, boom)
 *
 * Each icon: tap = toggle on/off. Hover OR click also reveals a thin volume
 * slider. State persisted in localStorage (on/off + volume per channel) so
 * preferences stick across reloads.
 *
 * SFX gating is global via the `gf_sfx_on` flag plus a `gf_sfx_volume`
 * multiplier — see isSfxMuted() / sfxVolume() below; playUiSound, wind and
 * boom read both.
 */

const LS_MUSIC      = 'gf_music_on'
const LS_MUSIC_VOL  = 'gf_music_volume'
const LS_SFX        = 'gf_sfx_on'
const LS_SFX_VOL    = 'gf_sfx_volume'
const BG_FILE       = '/sounds/fx/bg_sound.wav'
const DEFAULT_MUSIC_VOLUME = 0.35

// ── Public helpers used by SFX-playing modules. SSR-safe. ───────────────────
export function isSfxMuted(): boolean {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(LS_SFX) === '0'
}
export function sfxVolume(): number {
    if (typeof window === 'undefined') return 1
    const raw = window.localStorage.getItem(LS_SFX_VOL)
    if (raw == null) return 1
    const v = parseFloat(raw)
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
}
export function isMusicOn(): boolean {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(LS_MUSIC) !== '0'
}

export function FlightAudioToggles() {
    const audioRef = useRef<HTMLAudioElement | null>(null)

    const [musicOn,    setMusicOn]    = useState<boolean>(true)
    const [musicVol,   setMusicVol]   = useState<number>(DEFAULT_MUSIC_VOLUME)
    const [sfxOn,      setSfxOn]      = useState<boolean>(true)
    const [sfxVol,     setSfxVol]     = useState<number>(1.0)
    const [openPanel,  setOpenPanel]  = useState<'music' | 'sfx' | null>(null)
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Hydrate persisted state.
    useEffect(() => {
        try {
            const m  = localStorage.getItem(LS_MUSIC)
            const mv = localStorage.getItem(LS_MUSIC_VOL)
            const s  = localStorage.getItem(LS_SFX)
            const sv = localStorage.getItem(LS_SFX_VOL)
            if (m != null)  setMusicOn(m !== '0')
            if (s != null)  setSfxOn(s !== '0')
            if (mv != null) { const v = parseFloat(mv); if (Number.isFinite(v)) setMusicVol(Math.min(1, Math.max(0, v))) }
            if (sv != null) { const v = parseFloat(sv); if (Number.isFinite(v)) setSfxVol(Math.min(1, Math.max(0, v))) }
        } catch { /* private mode */ }
    }, [])

    // Persist + apply music on/off state.
    useEffect(() => {
        try { localStorage.setItem(LS_MUSIC, musicOn ? '1' : '0') } catch {}
        const a = audioRef.current
        if (!a) return
        if (musicOn) {
            a.volume = musicVol
            a.play().catch(() => {/* autoplay blocked → unlock listener handles it */})
        } else {
            a.pause()
        }
    }, [musicOn]) // eslint-disable-line react-hooks/exhaustive-deps

    // Live-update music volume without restarting playback.
    useEffect(() => {
        try { localStorage.setItem(LS_MUSIC_VOL, String(musicVol)) } catch {}
        const a = audioRef.current
        if (a) a.volume = musicVol
    }, [musicVol])

    // Browsers block autoplay until the user has interacted with the
    // document. Music can be ON in storage but blocked from playing; the
    // first pointer / key event in the page unlocks and starts it.
    useEffect(() => {
        if (!musicOn) return
        const a = audioRef.current
        if (!a) return
        if (!a.paused) return
        const unlock = () => {
            const el = audioRef.current
            if (!el) return
            el.volume = musicVol
            el.play().catch(() => {})
        }
        const opts = { once: true, capture: true, passive: true } as const
        window.addEventListener('pointerdown', unlock, opts)
        window.addEventListener('keydown',     unlock, opts)
        window.addEventListener('touchstart',  unlock, opts)
        return () => {
            window.removeEventListener('pointerdown', unlock, opts)
            window.removeEventListener('keydown',     unlock, opts)
            window.removeEventListener('touchstart',  unlock, opts)
        }
    }, [musicOn]) // eslint-disable-line react-hooks/exhaustive-deps

    // Persist SFX flags. (SFX players read straight from localStorage on
    // each play() call, so there's no element to update here.)
    useEffect(() => { try { localStorage.setItem(LS_SFX,     sfxOn ? '1' : '0') } catch {} }, [sfxOn])
    useEffect(() => { try { localStorage.setItem(LS_SFX_VOL, String(sfxVol))     } catch {} }, [sfxVol])

    const toggleMusic = useCallback(() => setMusicOn(v => !v), [])
    const toggleSfx   = useCallback(() => setSfxOn(v => !v), [])

    // Hover open with tiny grace period so jittering between the icon and
    // its slider doesn't flicker the panel. Click also opens.
    const open = (which: 'music' | 'sfx') => {
        if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
        setOpenPanel(which)
    }
    const scheduleClose = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current)
        closeTimer.current = setTimeout(() => setOpenPanel(null), 250)
    }

    const cls = (active: boolean) =>
        `p-2 rounded-xl backdrop-blur-md border transition-all ${
            active
                ? 'bg-white/10 border-white/25 text-white'
                : 'bg-white/[0.03] border-white/10 text-white/30'
        }`

    // Slider styling — kept consistent for both popovers.
    const sliderCls = 'w-24 accent-white cursor-pointer'

    return (
        <div className="absolute top-3 right-3 z-30 flex items-start gap-2 select-none">
            <audio ref={audioRef} src={BG_FILE} loop preload="auto" />

            {/* MUSIC — icon + hover-popover slider */}
            <div
                className="relative flex flex-col items-end"
                onMouseEnter={() => open('music')}
                onMouseLeave={scheduleClose}
            >
                <button
                    onClick={() => { toggleMusic(); open('music') }}
                    className={cls(musicOn)}
                    title={musicOn ? 'Music — tap to mute · hover for volume' : 'Music — off'}
                >
                    <Music size={14} />
                </button>
                {openPanel === 'music' && (
                    <div
                        className="absolute top-full mt-1.5 right-0 px-3 py-2 rounded-xl bg-black/80 backdrop-blur-md border border-white/15 flex items-center gap-2"
                        onMouseEnter={() => open('music')}
                        onMouseLeave={scheduleClose}
                    >
                        <Music size={11} className="text-white/40" />
                        <input
                            type="range" min={0} max={1} step={0.05}
                            value={musicVol}
                            onChange={e => { setMusicVol(parseFloat(e.target.value)); if (!musicOn) setMusicOn(true) }}
                            className={sliderCls}
                            title="Music volume"
                        />
                        <span className="text-[9px] font-mono text-white/40 w-7 text-right tabular-nums">
                            {Math.round(musicVol * 100)}%
                        </span>
                    </div>
                )}
            </div>

            {/* SFX — icon + hover-popover slider */}
            <div
                className="relative flex flex-col items-end"
                onMouseEnter={() => open('sfx')}
                onMouseLeave={scheduleClose}
            >
                <button
                    onClick={() => { toggleSfx(); open('sfx') }}
                    className={cls(sfxOn)}
                    title={sfxOn ? 'SFX — tap to mute · hover for volume' : 'SFX — off'}
                >
                    {sfxOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
                </button>
                {openPanel === 'sfx' && (
                    <div
                        className="absolute top-full mt-1.5 right-0 px-3 py-2 rounded-xl bg-black/80 backdrop-blur-md border border-white/15 flex items-center gap-2"
                        onMouseEnter={() => open('sfx')}
                        onMouseLeave={scheduleClose}
                    >
                        <Volume2 size={11} className="text-white/40" />
                        <input
                            type="range" min={0} max={1} step={0.05}
                            value={sfxVol}
                            onChange={e => { setSfxVol(parseFloat(e.target.value)); if (!sfxOn) setSfxOn(true) }}
                            className={sliderCls}
                            title="SFX volume"
                        />
                        <span className="text-[9px] font-mono text-white/40 w-7 text-right tabular-nums">
                            {Math.round(sfxVol * 100)}%
                        </span>
                    </div>
                )}
            </div>
        </div>
    )
}
