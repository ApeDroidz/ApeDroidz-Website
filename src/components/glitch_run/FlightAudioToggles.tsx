"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Music, Volume2, VolumeX } from "lucide-react"

/**
 * Two-icon audio control for /glitch_flight:
 *   • Music (looping bg track at /sounds/bg_sound.wav)
 *   • SFX  (UI click/hover, cashout, wind, boom)
 *
 * Each icon: tap = toggle on/off. State persisted in localStorage so the
 * preference sticks across reloads. Music tries to autoplay on mount; if
 * the browser blocks (no-interaction), the first SFX click on the page
 * also unblocks the bg track.
 *
 * SFX gating is global via the `gf_sfx_muted` flag — see isSfxMuted()
 * helper below; existing playUiSound / wind / boom call sites read it.
 */

const LS_MUSIC = 'gf_music_on'
const LS_SFX   = 'gf_sfx_on'
const BG_FILE  = '/sounds/fx/bg_sound.wav'
const MUSIC_VOLUME = 0.35

// Used by other modules (GameUI playUiSound, glitch_flight page wind/boom).
// Always returns false on the server (no localStorage) so SSR doesn't trip.
export function isSfxMuted(): boolean {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(LS_SFX) === '0'
}
export function isMusicOn(): boolean {
    if (typeof window === 'undefined') return false
    // Default ON — user hasn't toggled means they want sound.
    return window.localStorage.getItem(LS_MUSIC) !== '0'
}

export function FlightAudioToggles() {
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [musicOn, setMusicOn] = useState<boolean>(true)
    const [sfxOn, setSfxOn]     = useState<boolean>(true)

    // Hydrate persisted state.
    useEffect(() => {
        try {
            const m = localStorage.getItem(LS_MUSIC)
            const s = localStorage.getItem(LS_SFX)
            if (m != null) setMusicOn(m !== '0')
            if (s != null) setSfxOn(s !== '0')
        } catch { /* private mode */ }
    }, [])

    // Persist + apply music state.
    useEffect(() => {
        try { localStorage.setItem(LS_MUSIC, musicOn ? '1' : '0') } catch {}
        const a = audioRef.current
        if (!a) return
        if (musicOn) {
            a.volume = MUSIC_VOLUME
            a.play().catch(() => {/* autoplay blocked → wait for any click */})
        } else {
            a.pause()
        }
    }, [musicOn])

    // Persist SFX state.
    useEffect(() => {
        try { localStorage.setItem(LS_SFX, sfxOn ? '1' : '0') } catch {}
    }, [sfxOn])

    const toggleMusic = useCallback(() => setMusicOn(v => !v), [])
    const toggleSfx   = useCallback(() => setSfxOn(v => !v), [])

    const cls = (active: boolean) =>
        `p-2 rounded-xl backdrop-blur-md border transition-all ${
            active
                ? 'bg-[#00FF94]/10 border-[#00FF94]/30 text-[#00FF94]'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`

    return (
        <div className="absolute top-3 right-3 z-30 flex items-center gap-2 select-none">
            <audio ref={audioRef} src={BG_FILE} loop preload="auto" />

            <button
                onClick={toggleMusic}
                className={cls(musicOn)}
                title={musicOn ? 'Music — on (tap to mute)' : 'Music — off'}
            >
                <Music size={14} />
            </button>

            <button
                onClick={toggleSfx}
                className={cls(sfxOn)}
                title={sfxOn ? 'SFX — on (tap to mute)' : 'SFX — off'}
            >
                {sfxOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
        </div>
    )
}
