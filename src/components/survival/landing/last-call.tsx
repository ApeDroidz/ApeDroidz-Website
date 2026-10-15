'use client'

import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { ACCENT_BTN, Reveal } from '@/components/landing/ui'
import { ape, PlayLink, type Pool } from './shared'

const L = '/droidz_survival/landing/'

/**
 * The run cycles, from the game's frames (game/public/assets/img <set>_run_<n>.png = R2 v9), the
 * weapon overlay composited behind the body, cropped to the box the loop fills: run-*.png. Body at
 * 13 fps — the role's 10 × Player.RUN_ANIM_SCALE 1.3, as in a run. Gob at 0.8 again (Geez > Droid > Gob); in that order, the droid in the middle (04.10.2026).
 */
const RUNNERS = [
    { id: 'geez', src: `${L}run-geez.png`, fw: 68, fh: 94, n: 7, size: 1, lm: '20%', left: '33%' },
    { id: 'volt', src: `${L}run-volt.png`, fw: 72, fh: 76, n: 7, size: 1, lm: '40%', left: '44%' },
    { id: 'goblin', src: `${L}run-goblin.png`, fw: 74, fh: 84, n: 8, size: 0.8, lm: '60%', left: '54%' },
    // Grillz joins the run at the back (15.10.2026): grillz_run_<n>, no overlay (his jaws overlay is empty)
    { id: 'grillz', src: `${L}run-grillz.png`, fw: 54, fh: 66, n: 7, size: 1, lm: '80%', left: '64%' },
]

/**
 * The run's own sky and city, as GameScene draws them in the first act (systems/Parallax: no tint, full
 * opacity): bg5 stretched to the full height, bg4 and bg3 as a band whose floor line (0.778 of it,
 * GameScene fixedCenterY) stands on this floor. Their speed against the floor is the run's: bg4 1/6,
 * bg3 1/3 (config/tuning PARALLAX); bg5 barely moves. The art is 2200×1000.
 */
const ART_W = 2200
const ART_H = 1000
const FLOOR_LINE = 0.778
const PARALLAX = [
    { src: 'bg5.png', band: false, speed: 1 / 24 },
    { src: 'bg4.png', band: true, speed: 1 / 6 },
    { src: 'bg3_2.png', band: true, speed: 1 / 3 },
]
/** The floor's own drift (landing.tsx .ds-floor): one 1100 px × run-k tile per 7 s. */
const FLOOR_PX_PER_S = 1100 / 7

/**
 * The last call (owner, 04.10.2026: «блок с синим градиентом нравился — сделать интереснее в рамках
 * игры»; 04.10 later: «фон прям как в игре, без свечения и затемнения»): the run's sky and city drifting behind, and the heroes running along the game's own floor (ground_0) at
 * its foot — the floor scrolls, they run in place. CSS only; it moves only while the block is on
 * screen, and stands still for reduced motion.
 */
export function LastCall({ pool }: { pool: Pool | null | undefined }) {
    const box = useRef<HTMLDivElement>(null)
    const [playing, setPlaying] = useState(false)
    // The block's height and its run-k: the layers are sized and timed from them.
    const [size, setSize] = useState<{ h: number; k: number } | null>(null)
    useEffect(() => {
        const el = box.current
        if (!el) return
        const ro = new ResizeObserver(() => {
            const k = parseFloat(getComputedStyle(el).getPropertyValue('--run-k')) || 1
            setSize({ h: el.clientHeight, k })
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [])
    useEffect(() => {
        const el = box.current
        if (!el) return
        const io = new IntersectionObserver(([e]) => setPlaying(e.isIntersecting), { threshold: 0.15 })
        io.observe(el)
        return () => io.disconnect()
    }, [])

    return (
        <section id="last-call" className="px-4 pb-16 pt-4 md:px-[5vw] md:pb-24">
            <Reveal>
                <div
                    ref={box}
                    data-playing={playing ? '1' : '0'}
                    className="ds-run relative mx-auto flex max-w-[1280px] flex-col items-center overflow-hidden rounded-3xl border border-white/10 px-6 pt-12 text-center md:pt-16"
                    style={{ paddingBottom: 'calc(150px * var(--run-k) + 24px)', background: '#0a0f1e' }}
                >
                    {/* the run's sky and city behind them — the game's picture as it is, nothing laid over it */}
                    {size && PARALLAX.map((l) => {
                        // the floor's surface: 14 of its 34 art rows stand above the block's foot
                        const floorY = size.h - 14 * size.k
                        const h = l.band ? floorY / FLOOR_LINE : size.h
                        const w = (h * ART_W) / ART_H
                        return (
                            <span
                                key={l.src}
                                aria-hidden
                                className="ds-par pointer-events-none absolute inset-x-0 top-0"
                                style={{
                                    height: h,
                                    backgroundImage: `url(${L}${l.src})`,
                                    backgroundSize: `${w}px ${h}px`,
                                    backgroundRepeat: 'repeat-x',
                                    imageRendering: 'pixelated',
                                    ['--par-w' as string]: `${-w}px`,
                                    animationDuration: `${w / (FLOOR_PX_PER_S * size.k * l.speed)}s`,
                                }}
                            />
                        )
                    })}

                    <h2 className="relative text-3xl font-semibold tracking-tight md:text-5xl">Survive the waves.</h2>
                    <p className="relative mt-3 max-w-md text-white/55">
                        {pool ? <>The pool stands at <span className="font-semibold text-white">{ape(pool.poolApe)} APE</span>.</> : 'The pool fills as people play.'} Your first run is free.
                    </p>
                    <PlayLink testId="play-bottom" className={`${ACCENT_BTN} relative mt-8 !px-12 !py-5 !text-base`}>
                        <Play className="h-5 w-5" fill="currentColor" /> Play
                    </PlayLink>

                    {/* the floor, scrolling under them */}
                    <span
                        aria-hidden
                        className="ds-floor absolute inset-x-0 bottom-0"
                        style={{ height: 'calc(34px * var(--run-k))', backgroundImage: `url(${L}ground.png)`, backgroundSize: 'calc(1100px * var(--run-k)) 100%', backgroundRepeat: 'repeat-x', imageRendering: 'pixelated' }}
                    />
                    {RUNNERS.map((r) => (
                        <span
                            key={r.id}
                            aria-hidden
                            className="ds-runner absolute -translate-x-1/2"
                            style={{
                                ['--lm' as string]: r.lm,
                                ['--ld' as string]: r.left,
                                // feet on the floor's surface: 20 of its 34 art rows are under the grass line
                                bottom: 'calc(20px * var(--run-k))',
                                width: `calc(${r.fw}px * var(--run-k) * ${r.size})`,
                                height: `calc(${r.fh}px * var(--run-k) * ${r.size})`,
                            }}
                        >
                            <span
                                className="ds-sprite absolute inset-0"
                                style={{
                                    backgroundImage: `url(${r.src})`,
                                    backgroundSize: `${r.n * 100}% 100%`,
                                    ['--ds-end' as string]: `${(r.n / (r.n - 1)) * 100}%`,
                                    animationDuration: `${r.n / 13}s`,
                                    animationTimingFunction: `steps(${r.n}, end)`,
                                }}
                            />
                        </span>
                    ))}
                </div>
            </Reveal>
        </section>
    )
}
