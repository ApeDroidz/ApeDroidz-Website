'use client'

import { useEffect, useRef, useState } from 'react'
import { Reveal } from '@/components/landing/ui'
import { CAT, Section } from './shared'

/**
 * The heroes, alive (owner, 03.10.2026): their idle loop from the game, and sized by character —
 * Geez the tank the biggest, Droid the swordsman in the middle, Gob the mage the smallest; Grillz
 * the biter (15.10.2026) at the game's own scale.
 *
 * The strips are the game's idle frames (game/public/assets/img/<set>_idle_<n>.png = R2 v9),
 * cropped to the box the figure and its weapon fill across the loop and laid side by side:
 * public/droidz_survival/landing/hero-*.png. Played as the game plays them (config/authoredAssets.ts):
 * the body at 6 fps; Droid's sword is its own overlay at the blade's 12.5 fps, behind the body;
 * Gob's staff runs on his body's clock. Geez's fists are drawn on his body (the overlay is empty).
 *
 * In the game Droid and Gob stand the same height (66 px); here Gob is drawn at 0.8 of the shared
 * scale so the three read as the owner sees them: Geez > Droid > Gob.
 *
 * CSS steps over a strip — no canvas, no JS per frame; paused while the block is off screen and
 * for reduced motion.
 */

interface Layer { src: string; fps: number }
interface HeroDef {
    id: string
    /** heroes.ts cls */
    cls: 'blade' | 'mage' | 'tank' | 'biter'
    /** The hero's own X account (owner, 15.10.2026). */
    x: string
    /** heroes.ts name, for a hero the panel catalog does not list yet. */
    name?: string
    /** One frame of the strip, in art pixels, and the frame count. */
    fw: number; fh: number; n: number
    /** On top of the shared scale (Gob is drawn smaller — see above). */
    size: number
    /** Back to front. */
    layers: Layer[]
}

// ── From the game, word for word (owner, 04.10.2026: «ничего не придумывать, брать из игры») ─────
// game/src/scenes/HeroSelectScene.ts CLASS_LABEL / CLASS_COLOUR / CLASS_ROLE — the hero screen's
// class tag, its colour and the line under the name.
const CLASS_LABEL = { blade: 'BLADE', mage: 'MAGE', tank: 'TANK', biter: 'BITER' } as const
const CLASS_COLOUR = { blade: '#FF8A5A', mage: '#B98CFF', tank: '#6FD6FF', biter: '#FF6F9A' } as const
const CLASS_ROLE = {
    blade: 'Fast combos. Storm Surge builds quickest.',
    mage: 'Bolts from a staff. Grows into a fan of shots.',
    tank: 'Takes less, hits hardest. The roll is a charge.',
    biter: 'Bites in close. Every second bite springs. Hunger heals.',
} as const

const L = '/droidz_survival/landing/'
// Under each hero only its name, its class and the class's line (owner, 04.10.2026: «под героем
// слишком много — оставить имя, тип и короткое описание из игры»). Geez, Droid, Gob (owner, 04.10.2026: «Гиз, дроид, гоб» — the droid in the middle),
// then Grillz, the biter (15.10.2026). Each with its X account next to the name (owner, 15.10.2026).
const HEROES: HeroDef[] = [
    {
        id: 'geez', cls: 'tank', x: 'https://x.com/GeezOnApe',
        fw: 56, fh: 96, n: 7, size: 1,
        layers: [{ src: `${L}hero-geez.png`, fps: 6 }],
    },
    {
        id: 'volt', cls: 'blade', x: 'https://x.com/ApeDroidz',
        fw: 68, fh: 70, n: 7, size: 1,
        layers: [{ src: `${L}hero-volt-sword.png`, fps: 6 }, { src: `${L}hero-volt.png`, fps: 6 }], // the blade at the body's rate (04.10.2026)
    },
    {
        id: 'goblin', cls: 'mage', x: 'https://x.com/GobsOnApe',
        fw: 44, fh: 70, n: 7, size: 0.8,
        layers: [{ src: `${L}hero-goblin-staff.png`, fps: 6 }, { src: `${L}hero-goblin.png`, fps: 6 }],
    },
    {
        // grillz_idle_<n> at the body's 6 fps; his jaws overlay is empty (the teeth are on the body).
        id: 'grillz', cls: 'biter', x: 'https://x.com/GrillzGang', name: 'Grillz',
        fw: 54, fh: 60, n: 7, size: 1,
        layers: [{ src: `${L}hero-grillz.png`, fps: 6 }],
    },
]

/**
 * `costs` (hero id → unlock price in Ape Mini, page.tsx from lib/survivalEconomy.json) is still passed
 * in, but the cards no longer show a price (owner, 04.10.2026) — kept so the wiring stays for later.
 */
export function HeroesSection({ costs = {} }: { costs?: Record<string, number> }) {
    void costs
    const grid = useRef<HTMLDivElement>(null)
    const [playing, setPlaying] = useState(false)
    useEffect(() => {
        const el = grid.current
        if (!el) return
        const io = new IntersectionObserver(([e]) => setPlaying(e.isIntersecting), { threshold: 0.1 })
        io.observe(el)
        return () => io.disconnect()
    }, [])

    return (
        <Section
            id="heroes"
            label="Heroes"
            title="Four heroes, four ways to fight"
            description="The weapon follows the class. Droid is yours from the start; Gob, Geez and Grillz unlock with Ape Mini, the coin runs pay."
        >
            <div ref={grid} data-playing={playing ? '1' : '0'} className="ds-heroes grid gap-4 sm:grid-cols-2 md:gap-5 xl:grid-cols-4">
                {HEROES.map((h, i) => {
                    // The class colour, used as the hero screen uses it: the panel's edge, the class
                    // tag's text and frame, the line the hero stands on — never a fill.
                    const c = CLASS_COLOUR[h.cls]
                    return (
                        <Reveal key={h.id} delay={i * 0.06}>
                            <article className="flex h-full flex-col overflow-hidden rounded-3xl border bg-white/[0.03]" style={{ borderColor: `${c}40` }}>
                                {/* The game's fog and its ground strip (ground_0, the run's floor) under the hero. */}
                                <div className="relative flex h-60 items-end justify-center overflow-hidden bg-gradient-to-b from-[#cfd5df] via-[#a9b1c0] to-[#7e8798] md:h-72 lg:h-[320px]">
                                    <span
                                        aria-hidden
                                        className="absolute inset-x-0 bottom-0"
                                        style={{ height: 'calc(34px * var(--hero-k))', backgroundImage: `url(${L}ground.png)`, backgroundSize: 'calc(1100px * var(--hero-k)) 100%', backgroundRepeat: 'repeat-x', backgroundPosition: `${-i * 140}px 0`, imageRendering: 'pixelated' }}
                                    />
                                    <HeroAnim h={h} />
                                </div>
                                <div className="flex flex-1 flex-col p-6">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex min-w-0 items-center gap-2.5">
                                            <h3 className="text-2xl font-semibold tracking-tight">{h.name ?? CAT.heroes[h.id]?.name ?? h.id}</h3>
                                            <XLink href={h.x} name={h.name ?? CAT.heroes[h.id]?.name ?? h.id} />
                                        </div>
                                        <span className="rounded-md border bg-black/40 px-2.5 py-1 font-mono text-[11px] font-black tracking-[0.2em]" style={{ borderColor: c, color: c }}>{CLASS_LABEL[h.cls]}</span>
                                    </div>
                                    <p className="mt-1.5 text-sm text-white/55">{CLASS_ROLE[h.cls]}</p>
                                </div>
                            </article>
                        </Reveal>
                    )
                })}
            </div>
        </Section>
    )
}

/** The hero's X account, a small round button next to the name. */
function XLink({ href, name }: { href: string; name: string }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${name} on X`}
            title={`${name} on X`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white/70 transition hover:border-white/40 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
        </a>
    )
}

/** The idle loop: each layer a strip stepped through by CSS (see .ds-sprite in the landing's styles). */
function HeroAnim({ h }: { h: HeroDef }) {
    const scale = `var(--hero-k) * ${h.size}`
    return (
        <span
            aria-hidden
            className="relative block"
            // Feet on the ground strip's surface: 14 of its 34 art rows are grass above the line.
            style={{ width: `calc(${h.fw}px * ${scale})`, height: `calc(${h.fh}px * ${scale})`, marginBottom: 'calc(20px * var(--hero-k))' }}
        >
            {h.layers.map((l) => (
                <span
                    key={l.src}
                    className="ds-sprite absolute inset-0"
                    style={{
                        backgroundImage: `url(${l.src})`,
                        backgroundSize: `${h.n * 100}% 100%`,
                        ['--ds-end' as string]: `${(h.n / (h.n - 1)) * 100}%`,
                        animationDuration: `${h.n / l.fps}s`,
                        animationTimingFunction: `steps(${h.n}, end)`,
                    }}
                />
            ))}
        </span>
    )
}
