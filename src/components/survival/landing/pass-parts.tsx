'use client'

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { CAT } from './shared'

/**
 * The season pass's pieces, shared by the landing's pass block and its window (owner, 17.10.2026:
 * «акцент на пропуск, как он переливается; картинка с дроидом, S1; прогресс пропуска показать как
 * прогресс — призы едут вместе с прогрессом, не все; сколько Ape Mini — не надо; Spark colours в
 * конце»).
 */

// ── The card ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The card under a mouse: it tilts toward the pointer and the light (--mx/--my, .ds-card-holo)
 * follows it; let go, it settles. Touch is left alone (a tap turns the card over). Shared by the
 * landing's card and the one in the purchase celebration (owner, 17.10.2026: «чтобы когда водишь
 * по нему — интерактивный, как на лендосике»).
 */
export function usePassTilt() {
    const ref = useRef<HTMLButtonElement>(null)
    const move = (e: PointerEvent<HTMLButtonElement>) => {
        if (e.pointerType !== 'mouse' || !ref.current) return
        const r = ref.current.getBoundingClientRect()
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
        const st = ref.current.style
        st.setProperty('--rx', `${((0.5 - y) * 18).toFixed(2)}deg`)
        st.setProperty('--ry', `${((x - 0.5) * 22).toFixed(2)}deg`)
        st.setProperty('--mx', `${(x * 100).toFixed(1)}%`)
        st.setProperty('--my', `${(y * 100).toFixed(1)}%`)
        ref.current.classList.add('is-tilt')
    }
    const leave = () => {
        const el = ref.current
        if (!el) return
        for (const k of ['--rx', '--ry', '--mx', '--my']) el.style.removeProperty(k)
        el.classList.remove('is-tilt')
    }
    return { ref, move, leave }
}

/**
 * The game's Season 1 pass (ui/seasonTeaser.ts seasonFace: SEASON 1, the fighter with his blade
 * swung out, PASS; its back the lattice and S1), drawn 1:1 to PNG at 2× (public/droidz_survival/
 * landing/pass-s1*.png). It floats and breathes; under the pointer it tilts toward it and the light
 * follows; a tap turns it over. Styles: .ds-card* in landing.tsx LandingStyles.
 */
export function PassCard({ width, hint = false }: { width: string; hint?: boolean }) {
    const { ref, move, leave } = usePassTilt()
    const [flipped, setFlipped] = useState(false)
    return (
        <div className="flex flex-col items-center">
            <div className="ds-card-stage" style={{ width }}>
                <span aria-hidden className="ds-card-glow" />
                {GLINTS.map((g, i) => <span key={i} aria-hidden className="ds-glint" style={g} />)}
                <button
                    ref={ref}
                    type="button"
                    onPointerMove={move}
                    onPointerLeave={leave}
                    onClick={() => setFlipped((f) => !f)}
                    aria-label={flipped ? 'Season 1 pass, back — turn it over' : 'Season 1 pass — turn it over'}
                    className="ds-card"
                >
                    <span className={`ds-card-inner ${flipped ? 'is-flipped' : ''}`}>
                        <span className="ds-card-face">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/droidz_survival/landing/pass-s1.png" alt="" width={336} height={544} draggable={false} />
                            <span className="ds-card-holo" />
                            <span className="ds-card-sweep" />
                        </span>
                        <span className="ds-card-face ds-card-back">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/droidz_survival/landing/pass-s1-back.png" alt="" width={336} height={544} draggable={false} />
                            <span className="ds-card-holo" />
                        </span>
                    </span>
                </button>
            </div>
            {hint && <span className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">Tap the pass to turn it</span>}
        </div>
    )
}

/** Pixel glints around the card — where and when each one blinks. */
const GLINTS: CSSProperties[] = [
    { left: '-14%', top: '18%', animationDelay: '0s' },
    { right: '-12%', top: '8%', animationDelay: '0.9s' },
    { right: '-18%', top: '58%', animationDelay: '1.7s' },
    { left: '-20%', top: '70%', animationDelay: '2.4s' },
    { left: '46%', top: '-9%', animationDelay: '3.1s' },
    { right: '6%', bottom: '-8%', animationDelay: '1.3s' },
]

// ── The PASS rewards ─────────────────────────────────────────────────────────────────────────────

export type Reward =
    | { kind: 'coins' }
    | { kind: 'boost'; min: number }
    | { kind: 'res'; ids: string[] }
    | { kind: 'item'; item: string; rarity: 'epic' | 'legendary' }
    | { kind: 'spark'; id: string }

/** game/src/config/season.ts SEASON_TIERS — the PASS rail, tier 1 → 20 (the amounts left out on purpose). */
export const PASS_RAIL: Reward[] = [
    { kind: 'coins' }, { kind: 'boost', min: 30 }, { kind: 'res', ids: ['scrap', 'circuit'] }, { kind: 'item', item: 'servo', rarity: 'epic' },
    { kind: 'spark', id: 'cyan' }, { kind: 'coins' }, { kind: 'res', ids: ['cell', 'core'] }, { kind: 'boost', min: 60 },
    { kind: 'item', item: 'coil', rarity: 'epic' }, { kind: 'item', item: 'treads', rarity: 'legendary' }, { kind: 'coins' }, { kind: 'res', ids: ['core', 'cell'] },
    { kind: 'spark', id: 'lime' }, { kind: 'item', item: 'capacitor', rarity: 'epic' }, { kind: 'boost', min: 120 }, { kind: 'spark', id: 'violet' },
    { kind: 'coins' }, { kind: 'item', item: 'servo', rarity: 'legendary' }, { kind: 'spark', id: 'gold' }, { kind: 'item', item: 'plating', rarity: 'legendary' },
]
/** game/src/config/season.ts COSMETIC_COLOR / ui/kit/theme.ts RARITY_COLORS. */
export const SPARK: Record<string, string> = { cyan: '#6FD6FF', lime: '#B4FF1F', violet: '#C6B8FF', gold: '#FFCF4A' }
const RARITY: Record<string, string> = { epic: '#B98CFF', legendary: '#FFCF4A' }
const COIN = `${CAT.base}energy_0.png`
const CATX = CAT as unknown as { items: Record<string, { name: string; file: string }>; resources: Record<string, { name: string; file: string }> }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

export function Pix({ src, size = 28 }: { src: string; size?: number }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} loading="lazy" draggable={false} className="shrink-0" style={{ width: size, height: size, imageRendering: 'pixelated' }} />
}

/** What a piece of gear does — game/src/config/items.ts, without the rarity's number. */
const GEAR_DOES: Record<string, string> = {
    plating: 'more max HP', servo: 'more damage', treads: 'faster movement', coil: 'faster attacks', capacitor: 'your super charges faster', magnet: 'longer pickup reach',
}

/** A reward's picture, its short name (no amounts), what it is for, and the colour of its edge. */
export function rewardLook(r: Reward, icon = 28): { icon: ReactNode; name: string; detail: string; edge: string | null } {
    switch (r.kind) {
        case 'coins': return { icon: <Pix src={COIN} size={icon} />, name: 'Ape Mini', detail: 'The game\'s own coin — heroes are unlocked with it.', edge: null }
        case 'boost': {
            const t = r.min >= 60 ? `${r.min / 60}h` : `${r.min}m`
            return {
                icon: <span className="relative"><Pix src={COIN} size={icon} /><span className="absolute -bottom-1 -right-2 rounded bg-white px-0.5 font-mono text-[9px] font-black leading-tight text-black">×2</span></span>,
                name: `×2 for ${t}`, detail: `Every Ape Mini you earn counts twice for ${r.min >= 60 ? `${r.min / 60} ${r.min === 60 ? 'hour' : 'hours'}` : `${r.min} minutes`}.`, edge: null,
            }
        }
        case 'res': return { icon: <Pix src={`${CAT.base}${CATX.resources[r.ids[0]]?.file ?? ''}`} size={icon} />, name: r.ids.map((id) => `${cap(CATX.resources[id]?.name ?? id)}s`).join(' & '), detail: 'Salvage for your heroes\' upgrade trees.', edge: null }
        case 'item': return { icon: <Pix src={`${CAT.base}${CATX.items[r.item]?.file ?? ''}`} size={icon} />, name: `${cap(r.rarity)} ${cap(CATX.items[r.item]?.name ?? r.item)}`, detail: `${cap(r.rarity)} gear for the bag: ${GEAR_DOES[r.item] ?? 'a stronger droid'}.`, edge: RARITY[r.rarity] }
        case 'spark': return { icon: <SparkBurst color={SPARK[r.id]} size={icon + 8} />, name: `${cap(r.id)} sparks`, detail: `Your hits throw ${r.id} sparks — only pass holders have them.`, edge: SPARK[r.id] }
    }
}

/**
 * The pass's ladder as a moving track: one tier a beat, the reached one lit, the ones behind it
 * ticked, the bar under them filling. At tier 20 it rests, fades and starts over from 1 (owner,
 * 17.10.2026: «крутится гличово — пофиксить; при ховере останавливать, чтобы посмотреть детали
 * приза»). A pointer on a tier (a tap on a phone) stops it there and the line under the bar tells
 * what that reward is; while it rides, the line tells the tier being reached. Still at tier 10 for
 * reduced motion.
 *
 * One timer per beat, armed by an effect — never from inside a state updater: React may run an
 * updater twice (Strict Mode), and each run armed another timer, so the beats multiplied and the
 * count ran away from the track.
 */
export function PassTrack({ cell = 92 }: { cell?: number }) {
    const [tier, setTier] = useState(1)
    /** The tier under the pointer (or tapped): the track waits while it is set. */
    const [focus, setFocus] = useState<number | null>(null)
    /** The lap's end: the track fades out, jumps to tier 1 unseen, fades back in. */
    const [fade, setFade] = useState(false)
    const [still, setStill] = useState(false)
    const tapTimer = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setStill(true); setTier(10) }
        return () => clearTimeout(tapTimer.current)
    }, [])
    useEffect(() => {
        if (still || focus !== null || fade) return
        const id = setTimeout(() => {
            if (document.visibilityState !== 'visible') { setTier((n) => n); return }
            if (tier >= 20) setFade(true)
            else setTier(tier + 1)
        }, tier >= 20 ? 2600 : 1300)
        return () => clearTimeout(id)
    }, [tier, focus, fade, still])
    useEffect(() => {
        if (!fade) return
        let raf = 0
        const id = setTimeout(() => { setTier(1); raf = requestAnimationFrame(() => requestAnimationFrame(() => setFade(false))) }, 380)
        return () => { clearTimeout(id); cancelAnimationFrame(raf) }
    }, [fade])

    const tap = (n: number) => {
        setFocus(n)
        clearTimeout(tapTimer.current)
        tapTimer.current = setTimeout(() => setFocus(null), 5000)
    }
    const gap = 8, step = cell + gap
    const shown = focus ?? tier
    const info = rewardLook(PASS_RAIL[shown - 1], 30)
    const motion = fade ? 'none' : undefined
    return (
        <div>
            <div className="ds-track relative h-[112px] overflow-hidden" onPointerLeave={(e) => { if (e.pointerType === 'mouse') setFocus(null) }}>
                <ol
                    className="absolute left-[22%] top-1/2 flex transition-[transform,opacity] duration-700 ease-[cubic-bezier(.3,.7,.2,1)]"
                    style={{ gap, transform: `translate(${-(tier - 0.5) * step}px, -50%)`, opacity: fade ? 0 : 1, transitionProperty: fade ? 'opacity' : undefined, transitionDuration: fade ? '350ms' : undefined }}
                    aria-label="Pass rewards, tier by tier"
                >
                    {PASS_RAIL.map((r, i) => {
                        const n = i + 1, look = rewardLook(r, 30), state = n < tier ? 'past' : n === tier ? 'now' : 'next', picked = focus === n
                        return (
                            <li key={n} className="shrink-0">
                                <button
                                    type="button"
                                    onPointerEnter={(e) => { if (e.pointerType === 'mouse') setFocus(n) }}
                                    onClick={() => tap(n)}
                                    onFocus={() => setFocus(n)}
                                    onBlur={() => setFocus(null)}
                                    aria-label={`Tier ${n}: ${look.name}`}
                                    className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border px-1 text-center outline-none transition-[opacity,transform,background-color,border-color,box-shadow] duration-500 ${state === 'now' ? 'bg-[#FFCF4A]/[0.08]' : 'bg-white/[0.03]'}`}
                                    style={{
                                        width: cell, height: 96,
                                        borderColor: picked ? '#FFFFFF' : state === 'now' ? '#FFCF4A' : look.edge ? `${look.edge}66` : 'rgba(255,255,255,0.08)',
                                        opacity: state === 'past' && !picked ? 0.4 : 1,
                                        transform: state === 'now' || picked ? 'scale(1.06)' : undefined,
                                        boxShadow: state === 'now' ? '0 0 24px rgba(255,207,74,0.25)' : undefined,
                                        transitionDuration: motion,
                                    }}
                                >
                                    <span className="absolute left-2 top-1.5 font-mono text-[9px] font-bold text-white/35">{n}</span>
                                    {state === 'past' && <Check className="absolute right-1.5 top-1.5 h-3 w-3 text-[#FFCF4A]" />}
                                    <span className="grid h-9 place-items-center">{look.icon}</span>
                                    <span className="text-[11px] font-medium leading-tight text-white/80">{look.name}</span>
                                </button>
                            </li>
                        )
                    })}
                </ol>
            </div>
            <div className="mt-3 flex items-center gap-3">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Tier <span className="tabular-nums text-white">{String(tier).padStart(2, '0')}</span>/20</span>
                <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#D89E00] to-[#FFE7A4] transition-[width] duration-700" style={{ width: `${(tier / 20) * 100}%`, transitionDuration: fade ? '0ms' : undefined }} />
                </span>
            </div>
            {/* What the tier is — the one reached, or the one under the pointer (the track waits then). */}
            <p aria-live="polite" className="mt-2.5 truncate text-xs text-white/50">
                <span className="font-semibold text-white">Tier {shown} · {info.name}</span> — {info.detail}
                {focus !== null && <span className="ml-2 font-mono text-[9px] uppercase tracking-wider text-white/30">paused</span>}
            </p>
        </div>
    )
}

/** A few pixel sparks flying out — the hit's look (game systems/Fx.ts), in the pass colour. */
export function SparkBurst({ color, size = 40 }: { color: string; size?: number }) {
    const k = size / 40
    const bits = [[-9, -6], [8, -8], [10, 5], [-7, 8], [0, -11], [-11, 1], [3, 10]]
    return (
        <span aria-hidden className="ds-spark relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
            <span style={{ width: 8 * k, height: 8 * k, background: '#fff', boxShadow: `0 0 10px ${color}` }} />
            {bits.map(([x, y], i) => (
                <span key={i} className="absolute" style={{ width: 3, height: 3, background: color, left: `calc(50% + ${x * k}px)`, top: `calc(50% + ${y * k}px)`, animationDelay: `${i * 0.11}s` }} />
            ))}
        </span>
    )
}

/**
 * How the pool is cut, drawn rather than said: the paid places' shares on the harmonic curve the
 * server pays by (lib/survivalForecast.ts, s = 1: 1st takes twice 2nd, three times 3rd).
 */
export function Podium({ places = 6, className = '' }: { places?: number; className?: string }) {
    return (
        <div className={`flex items-end gap-1.5 ${className}`} aria-hidden>
            {Array.from({ length: places }, (_, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
                    <span
                        className="ds-podium w-3.5 rounded-t-[3px] sm:w-5 md:w-6"
                        style={{ height: Math.round(56 / (i + 1)) + 4, background: i === 0 ? 'linear-gradient(#FFE7A4, #D89E00)' : `rgba(255,207,74,${0.55 - i * 0.07})`, animationDelay: `${i * 0.07}s` }}
                    />
                    <span className={`font-mono text-[9px] font-bold ${i === 0 ? 'text-[#FFCF4A]' : 'text-white/35'}`}>{i + 1}</span>
                </div>
            ))}
        </div>
    )
}
