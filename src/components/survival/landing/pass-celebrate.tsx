'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gift, Play, Sparkles, Trophy, X } from 'lucide-react'
import { GlitchText } from '@/components/glitch/glitch-text'
import { ACCENT_BTN, LABEL_CLASS } from '@/components/landing/ui'
import { CAT, PlayLink, POOL_SEASON } from './shared'
import { usePassTilt } from './pass-parts'

/**
 * The moment the pass is bought (owner, 17.10.2026: «когда покупаешь пропуск — крутая анимация в
 * нашем стиле, чтобы юзер почувствовал эмоции и радость от покупки, и звуком сопроводить, но не
 * переборщить»).
 *
 * About 2.5 s, all of it timed in CSS (.ds-cel* in landing.tsx LandingStyles):
 *   0.0  the screen darkens; the pass flies up from the depth spinning, its S1 back and its face
 *        flashing by — the game's «charge» (sfx_energy)
 *   0.9  it lands face-on with a punch: a glitch flash with the site's RGB split, gold pixels burst
 *        out, a square shockwave, pixel rays start turning behind it — the game's level-up sound
 *   1.1  PASS UNLOCKED in the site's glitch type, what it opens, three soft coin ticks
 *   1.8  PLAY and Close; a light rain of gold pixels falls twice and stops
 * The sounds are the game's own (media on R2), quiet. Reduced motion: the end state, no sound.
 */
const SFX = `${CAT.base.replace(/img\/$/, '')}audio/`
const GOLD = ['#FFFFFF', '#FFE7A4', '#FFCF4A', '#D89E00']
/** The rain: the site's whites and greys, a gold one now and then. */
const RAIN = ['#FFFFFF', '#C9CED6', '#8A93A5', '#FFFFFF', '#FFCF4A']

/**
 * What stands behind the card (owner, 17.10.2026: «без жёлтых лучей сзади — в игре ок, на лендинге
 * не очень; что-то другое на фоне»). Three ways, picked by the owner:
 *   grid    a dark field of dots; at the punch a wave of light runs out through it from the card
 *   spot    a soft white stage light falls on the card from above, its reflection on the floor
 *   glitch  scanlines; at the punch bands of the site's RGB split tear across the screen
 */
export type CelebrationBg = 'grid' | 'spot' | 'glitch'

export function PassCelebration({ onClose, bg = 'grid' }: { onClose: () => void; bg?: CelebrationBg }) {
    const closeRef = useRef<HTMLButtonElement>(null)
    const tilt = usePassTilt()
    const [flipped, setFlipped] = useState(false)
    const onCloseRef = useRef(onClose)
    useEffect(() => { onCloseRef.current = onClose }, [onClose])

    // The burst and the rain, laid out once per showing.
    const bits = useMemo(() => Array.from({ length: 44 }, (_, i) => {
        const a = (i / 44) * Math.PI * 2 + Math.random() * 0.3, d = 130 + Math.random() * 230
        return { dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d), s: [4, 6, 8][i % 3], c: GOLD[i % 4], delay: Math.random() * 0.08 }
    }), [])
    const rain = useMemo(() => Array.from({ length: 26 }, (_, i) => ({
        left: Math.random() * 100, s: [4, 6][i % 2], c: RAIN[i % RAIN.length], delay: 1.2 + Math.random() * 2.2, dur: 2.6 + Math.random() * 1.4,
    })), [])

    useEffect(() => {
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        closeRef.current?.focus({ preventScroll: true })
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
        document.addEventListener('keydown', onKey)
        const timers: ReturnType<typeof setTimeout>[] = []
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            // The page had the buyer's clicks, so it may play sound; a refusal is silence, never an error.
            const play = (file: string, volume: number) => {
                try { const a = new Audio(SFX + file); a.volume = volume; void a.play().catch(() => undefined) } catch { /* no audio */ }
            }
            play('sfx_energy.wav', 0.22)
            timers.push(setTimeout(() => play('sfx_level_up.wav', 0.42), 880))
            for (const t of [1150, 1300, 1450]) timers.push(setTimeout(() => play('sfx_coin_tally.wav', 0.12), t))
        }
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; timers.forEach(clearTimeout) }
    }, [])

    return createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="pass-cel-title" className="ds-cel fixed inset-0 z-[600] grid place-items-center overflow-hidden bg-black/90 backdrop-blur-sm">
            {bg === 'grid' && <><span aria-hidden className="ds-cel-grid" /><span aria-hidden className="ds-cel-grid ds-cel-wave" /></>}
            {bg === 'spot' && <><span aria-hidden className="ds-cel-spot" /><span aria-hidden className="ds-cel-floor" /></>}
            {bg === 'glitch' && <><span aria-hidden className="ds-cel-scan" />{[18, 37, 55, 71, 86].map((t, i) => <span key={t} aria-hidden className="ds-cel-tear" style={{ top: `${t}%`, animationDelay: `${0.9 + i * 0.05}s` }} />)}</>}
            <span aria-hidden className="ds-cel-flash" />
            {rain.map((r, i) => (
                <span key={i} aria-hidden className="ds-cel-rain" style={{ left: `${r.left}%`, width: r.s, height: r.s, background: r.c, animationDelay: `${r.delay}s`, animationDuration: `${r.dur}s` }} />
            ))}

            <button ref={closeRef} onClick={onClose} aria-label="Close" className="ds-cel-late absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 text-white transition-colors hover:bg-white hover:text-black md:right-6 md:top-6" style={{ animationDelay: '1.8s' }}>
                <X className="h-4 w-4" />
            </button>

            <div className="relative flex w-full max-w-xl flex-col items-center px-6 text-center">
                <div className="relative" style={{ width: 'clamp(140px, 20vw, 210px)', aspectRatio: '168 / 272' }}>
                    <span aria-hidden className="ds-cel-glow" />
                    <span aria-hidden className="ds-cel-ring" />
                    {bits.map((b, i) => (
                        <span
                            key={i}
                            aria-hidden
                            className="ds-cel-bit"
                            style={{ width: b.s, height: b.s, background: b.c, boxShadow: `0 0 6px ${b.c}`, ['--dx' as string]: `${b.dx}px`, ['--dy' as string]: `${b.dy}px`, animationDelay: `${0.9 + b.delay}s` }}
                        />
                    ))}
                    <div className="ds-cel-punch absolute inset-0">
                        {/* After its entrance the card is alive, as on the landing: it tilts to the mouse, the light follows, a click turns it over. */}
                        <button ref={tilt.ref} type="button" onPointerMove={tilt.move} onPointerLeave={tilt.leave} onClick={() => setFlipped((f) => !f)} aria-label="Turn the pass over" className="ds-cel-tilt absolute inset-0">
                            <div className="ds-cel-card absolute inset-0">
                                <span className={`ds-cel-flip absolute inset-0 ${flipped ? 'is-flipped' : ''}`}>
                                    <span className="ds-card-face">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src="/droidz_survival/landing/pass-s1.png" alt={`Season ${POOL_SEASON} pass`} width={336} height={544} draggable={false} />
                                        <span className="ds-card-holo" />
                                        <span className="ds-card-sweep" />
                                    </span>
                                    <span className="ds-card-face ds-card-back">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src="/droidz_survival/landing/pass-s1-back.png" alt="" width={336} height={544} draggable={false} />
                                        <span className="ds-card-holo" />
                                    </span>
                                </span>
                            </div>
                        </button>
                    </div>
                </div>

                <div className="ds-cel-up mt-10" style={{ animationDelay: '1.05s' }}>
                    <div className={`${LABEL_CLASS} text-[#FFCF4A]`}>Season {POOL_SEASON} pass</div>
                    <h2 id="pass-cel-title" className="mt-3 text-[2.6rem] font-black uppercase leading-[0.9] tracking-tighter text-white md:text-6xl" aria-label="Pass unlocked">
                        <GlitchText text="Pass unlocked" />
                    </h2>
                    <p className="mt-4 text-sm text-white/60 md:text-base">It&apos;s yours — and waiting in the game.</p>
                </div>

                <ul className="mt-6 flex flex-wrap justify-center gap-2">
                    {[
                        { icon: Trophy, t: 'In the prize pool' },
                        { icon: Gift, t: 'PASS rewards on all 20 tiers' },
                        { icon: Sparkles, t: '4 spark colours' },
                    ].map((c, i) => (
                        <li key={c.t} className="ds-cel-pop flex items-center gap-2 rounded-full border border-[#FFCF4A]/35 bg-[#FFCF4A]/[0.08] px-3.5 py-2 text-xs font-semibold text-white" style={{ animationDelay: `${1.35 + i * 0.12}s` }}>
                            <c.icon className="h-3.5 w-3.5 text-[#FFCF4A]" /> {c.t}
                        </li>
                    ))}
                </ul>

                <div className="ds-cel-late mt-8 flex flex-wrap justify-center gap-3" style={{ animationDelay: '1.8s' }}>
                    <PlayLink testId="play-after-pass" className={ACCENT_BTN}><Play className="h-4 w-4" fill="currentColor" /> Play now</PlayLink>
                    <button type="button" onClick={onClose} className="inline-flex items-center rounded-full border border-white/15 px-7 py-4 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black">
                        Close
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    )
}
