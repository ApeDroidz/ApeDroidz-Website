'use client'

import type { ReactNode } from 'react'
import { LABEL_CLASS, Reveal } from '@/components/landing/ui'
import { trackFunnel } from '@/lib/survivalFunnel'
import CATALOG from '@/lib/survivalGameCatalog.json'

/**
 * What the landing's blocks share: the live data's shapes, the number formats, the accent colours,
 * the section frame, PLAY, the player's avatar.
 */

export interface LandingPrice {
    sku: string
    kind: string
    title: string
    priceApe: number
    fullPriceApe: number
    salePct: number
    saleUntil: string | null
    holderDiscountPct: number
}

export interface Pool {
    seasonId: string
    seasonName: string
    endsAt: number | null
    paysOut: boolean
    poolApe: number
    players: number
    games: number
    reservePct: number
    reserveApe: number
    payoutApe: number
    prizes: Array<{ place: number; unlockLevel: number | null; name: string | null; imageUrl: string | null; awarded: boolean }>
}

export interface BoardRow {
    rank: number
    wallet: string
    x?: string | null
    clan?: string | null
    hero?: string | null
    score: number
    wave: number
    kills: number
    runs: number
    /** The best run's active time, ms (api/survival/board). */
    timeMs?: number | null
    pass?: boolean
    // The player profile (nickname + NFT avatar) — read under the names it may come by; the wallet
    // stays the fallback.
    nickname?: string | null
    nick?: string | null
    avatar?: string | null
    avatarUrl?: string | null
}

export interface Tickets { priceApe: number | null; fullPriceApe: number | null; salePct: number; saleUntil: string | null }

export const PLAY_HREF = '/droidz_survival/play'

// ── Colour (owner, 04.10.2026: «наполнить акцентами и фокусом, а не разукрасить») ──────────────
// Black, white and greys, and ONE accent: the site's blue — the PLAY button's — and every APE is
// that blue («APE всегда синим»). Focus comes from size, weight and contrast, one blue detail a block.
// The game's own pixel pictures (the trailer, the heroes, the pass card) keep their colours.
export const BLUE = '#0069FF'
/**
 * «APE» (owner, 04.10.2026, corrected: «не надо выделять APE синим везде»): in running text and small
 * captions it takes the colour of the words around it; only the display uses — the pool's heading
 * («$APE», the token) — are blue. Blue on the page is the CTAs, the pool's amount and its bar.
 */
export function Ape({ className = '', big = false, dollar = false }: { className?: string; big?: boolean; dollar?: boolean }) {
    return <span className={className} style={big ? { color: BLUE } : undefined}>{dollar ? '$APE' : 'APE'}</span>
}

// ── The game's own facts ─────────────────────────────────────────────────────────────────────────
/** game/src/systems/Trial.ts TRIAL_WAVES */
export const TRIAL_WAVES = 3
/** game/src/config/season.ts poolShareOfEntry (and the cashier contract: half of every payment). */
export const POOL_SHARE = 0.5
/** game/src/config/season.ts SEASON.poolSeason — the beta's pool is paid in Season 1. */
export const POOL_SEASON = 1
/**
 * game/src/config/season.ts SEASON.milestones — the goals the pool bar fills toward, in APE. The
 * pool's LEVEL is 1 + the goals it has passed; it only ever goes up (owner, 25.09.2026).
 */
export const POOL_MILESTONES = [10, 30, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000] as const
export const poolLevel = (pool: number) => 1 + POOL_MILESTONES.filter((m) => m <= pool).length
export const nextMilestone = (pool: number) => POOL_MILESTONES.find((m) => m > pool) ?? POOL_MILESTONES[POOL_MILESTONES.length - 1]
/** Where a level starts, in APE: LVL 1 at 0, then the milestones (game ui/poolDetails.ts levelAt). */
export const levelAt = (L: number) => (L <= 1 ? 0 : POOL_MILESTONES[L - 2] ?? Number.POSITIVE_INFINITY)
export const MAX_LEVEL = POOL_MILESTONES.length + 1

type Pic = { name: string; file: string | null; box?: number[] }
export const CAT = CATALOG as unknown as { base: string; heroes: Record<string, Pic> }

// ── Formats ──────────────────────────────────────────────────────────────────────────────────────

export const ape = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
export const int = (n: number) => Math.round(n).toLocaleString('en-US')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')
/** «Oct 6, 17:00 UTC» — by hand: toLocaleString words it differently in Node and in Safari (a hydration mismatch). */
export const utc = (iso: string) => { const d = new Date(iso); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC` }
export const saleOn = (p: { salePct: number; saleUntil: string | null }, now: number) => p.salePct > 0 && !!p.saleUntil && new Date(p.saleUntil).getTime() > now

export function playerName(r: BoardRow): string {
    return r.nickname || r.nick || r.x || r.wallet
}
function playerAvatar(r: BoardRow): string | null {
    const a = r.avatar || r.avatarUrl
    return a && /^https?:\/\//.test(a) ? a : null
}

export function timeLeft(ms: number): string {
    const m = Math.max(0, Math.floor(ms / 60_000))
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
    if (d >= 1) return `${d}d ${h}h`
    if (h >= 1) return `${h}h ${mm}m`
    return `${mm}m`
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────

/** PLAY: a full page load (nothing of the landing stays in memory under the game), counted first. */
export function PlayLink({ className, children, testId }: { className: string; children: ReactNode; testId?: string }) {
    return (
        <a href={PLAY_HREF} data-testid={testId} onClick={() => trackFunnel('play_click', { again: true })} className={className}>
            {children}
        </a>
    )
}

/**
 * A hero's still idle frame from the game (324×164, the figure somewhere inside), cropped to the
 * figure's box and scaled up sharp — the board's fallback avatar.
 */
export function HeroStill({ id, height, className = '' }: { id: string; height: number; className?: string }) {
    const pic = CAT.heroes[id]
    if (!pic?.file || !pic.box) return <span className={`inline-block rounded-md bg-white/10 ${className}`} style={{ width: height, height }} />
    const [x0, y0, x1, y1, w, h] = pic.box
    const k = height / (y1 - y0)
    const width = Math.round((x1 - x0) * k)
    return (
        <span
            aria-hidden
            className={`inline-block ${className}`}
            style={{
                width, height, imageRendering: 'pixelated',
                backgroundImage: `url(${CAT.base}${pic.file})`, backgroundRepeat: 'no-repeat',
                backgroundSize: `${w * k}px ${h * k}px`, backgroundPosition: `${-x0 * k}px ${-y0 * k}px`,
            }}
        />
    )
}

/** The player's picture on the board: their NFT avatar when the API has one, else their hero on fog. */
export function Avatar({ row, size }: { row: BoardRow; size: number }) {
    // A pass holder's picture in a gold hairline a scan of light runs round now and then (owner,
    // 17.10.2026: «футуристичнее, минималистичнее») — the game's board does the same.
    if (row.pass) {
        return (
            <span className="ds-passring shrink-0" style={{ ['--ds-shine-delay' as string]: `${((row.rank * 0.25) % 4.2).toFixed(2)}s` }}>
                <PlainAvatar row={row} size={size - 6} framed />
            </span>
        )
    }
    return <PlainAvatar row={row} size={size} />
}

function PlainAvatar({ row, size, framed = false }: { row: BoardRow; size: number; framed?: boolean }) {
    const edge = framed ? 'border border-black/60' : 'border border-white/10'
    const url = playerAvatar(row)
    if (url) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={url} alt="" width={size} height={size} loading="lazy" className={`shrink-0 rounded-full ${edge} object-cover`} style={{ width: size, height: size }} />
    }
    return (
        <span className={`grid shrink-0 place-items-end justify-center overflow-hidden rounded-full ${edge} bg-gradient-to-b from-[#c3cad6] to-[#8a93a5]`} style={{ width: size, height: size }}>
            {row.hero && CAT.heroes[row.hero] ? <HeroStill id={row.hero} height={Math.round(size * 0.8)} /> : null}
        </span>
    )
}

export function LiveDot({ color = '#ffffff' }: { color?: string }) {
    return (
        <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
        </span>
    )
}

/** A block of the page: a quiet label, the heading, a line under it. */
export function Section({ id, label, title, description, children, tight = false, action }: {
    id: string; label: string; title: ReactNode; description?: ReactNode; children: ReactNode
    /** Beside the heading on a wide screen (How to play: «Play now» — owner, 04.10.2026), under it on a phone. */
    action?: ReactNode
    /** Less room above — the block right under the hero, so it peeks into the first screen. */
    tight?: boolean
}) {
    return (
        <section id={id} className={`scroll-mt-24 px-4 pb-14 md:px-[5vw] md:pb-20 ${tight ? 'pt-6 md:pt-6' : 'pt-14 md:pt-20'}`}>
            <div className="mx-auto max-w-[1280px]">
                {/* The block under the hero shows its heading at once — it is what peeks into the first screen. */}
                <Head tight={tight}>
                    <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                        <div className="min-w-0">
                            <div className={`${LABEL_CLASS} mb-4 text-white/40`}>{label}</div>
                            <h2 className="text-3xl font-semibold leading-[1.02] tracking-tight md:text-5xl">{title}</h2>
                            {description && <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/55 md:text-base">{description}</p>}
                        </div>
                        {action && <div className="shrink-0">{action}</div>}
                    </div>
                </Head>
                {children}
            </div>
        </section>
    )
}

function Head({ tight, children }: { tight: boolean; children: ReactNode }) {
    return tight ? <div className="mb-8 md:mb-12">{children}</div> : <Reveal className="mb-8 md:mb-12">{children}</Reveal>
}
