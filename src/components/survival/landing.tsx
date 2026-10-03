'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Lock, Maximize2, Play, Sparkles, Trophy, Volume2, VolumeX, Wallet, PenLine, Gamepad2, Gift } from 'lucide-react'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import { DigitalBackground } from '@/components/digital-background'
import { ProfileModal } from '@/components/profile-modal'
import { GlitchText } from '@/components/glitch/glitch-text'
import { InstallHint } from '@/components/survival/install-hint'
import { ACCENT_BTN, LABEL_CLASS, Reveal } from '@/components/landing/ui'
import { trackFunnel } from '@/lib/survivalFunnel'
import { inWalletBrowser, isIOSDevice, isMobileDevice } from '@/lib/survivalDevice'
import CATALOG from '@/lib/survivalGameCatalog.json'

/**
 * The Droidz Survival landing (owner, 03.10.2026): the site's look, not the game's. First screen —
 * the gameplay video, the name, the live prize pool, the season's state, the top 3 and PLAY; then
 * how to play, the heroes, the season and its pool, the pass, the full board, the FAQ, the footer.
 *
 * Every number on it comes from the live API (pool, board, tickets), the live catalog (prices, read
 * by page.tsx on the server) or the game's own config (the heroes below). Nothing is invented: a
 * number that is not there yet shows as a dash, not as a guess.
 *
 * Light on purpose: the video loads its metadata only and plays only while on screen; on a phone it
 * is the poster with a play button until tapped. PLAY is a full page load to /play, so nothing of
 * this page stays in memory under the game.
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

interface Pool {
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

interface BoardRow {
    rank: number
    wallet: string
    x?: string | null
    clan?: string | null
    hero?: string | null
    score: number
    wave: number
    kills: number
    runs: number
    pass?: boolean
    // The player profile (nickname + NFT avatar) — added to /api/survival/board alongside this page;
    // read under the names it may come by, and the wallet stays the fallback.
    nickname?: string | null
    nick?: string | null
    avatar?: string | null
    avatarUrl?: string | null
}

interface Tickets { priceApe: number | null; fullPriceApe: number | null; salePct: number; saleUntil: string | null }

const PLAY_HREF = '/droidz_survival/play'
const VIDEO_SRC = 'https://assets.apedroidz.com/apedroidz/droidz-survival/media/beta-announce.mp4'
const VIDEO_POSTER = 'https://assets.apedroidz.com/apedroidz/droidz-survival/media/beta-announce-poster.jpg'

// ── The game's own facts ─────────────────────────────────────────────────────────────────────────
// From the game's config as of 03.10.2026 (game/src/config/heroes.ts, weapons.ts, systems/Skills.ts,
// systems/Trial.ts, ui/howToPlay.ts, scenes/SeasonScene.ts). The pictures are the game's idle frames
// on R2, cropped by src/lib/survivalGameCatalog.json (exported from the same configs).

type Pic = { name: string; file: string | null; box?: number[] }
const CAT = CATALOG as unknown as { base: string; heroes: Record<string, Pic> }

const HEROES: Array<{ id: string; cls: string; hp: number; weapon: string; passive: string; superMove: string; skill: string; unlock: string }> = [
    { id: 'volt', cls: 'Blade', hp: 10, weapon: 'Volt Blade', passive: 'Combo: crits more, heals by staying in, and Storm Surge builds faster.', superMove: 'Storm Surge', skill: 'Thunder Blade', unlock: 'Free from the start' },
    { id: 'geez', cls: 'Tank', hp: 20, weapon: 'Knuckles', passive: 'Tank: takes less, throws harder. The roll is a shoulder charge; the slam is huge.', superMove: 'Seismic Slam', skill: 'Iron Hide', unlock: 'Unlock: 5,000 Ape Mini' },
    { id: 'goblin', cls: 'Mage', hp: 10, weapon: 'Hex Staff', passive: 'Mage: the staff casts bolts. Light step one, heavy step a fan of three.', superMove: 'Caustic Bloom', skill: 'Hex Fan', unlock: 'Unlock: 10,000 Ape Mini' },
]
/** game/src/systems/Trial.ts TRIAL_WAVES */
const TRIAL_WAVES = 3
/** game/src/config/season.ts poolShareOfEntry (and the cashier contract: half of every payment). */
const POOL_SHARE_PCT = 50

const PASS_PERKS: Array<{ icon: typeof Trophy; title: string; line: string }> = [
    { icon: Trophy, title: 'Prize pool', line: 'A share of the Season 1 APE pool, by your best score.' },
    { icon: Gift, title: 'Pass rewards', line: 'A second reward on every tier: gear, salvage, boosts.' },
    { icon: Sparkles, title: 'Spark colours', line: 'Four hit-spark colours only pass holders get.' },
]

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────

const ape = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const int = (n: number) => Math.round(n).toLocaleString('en-US')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')
/** «Oct 6, 17:00 UTC» — by hand: toLocaleString words it differently in Node and in Safari (a hydration mismatch). */
const utc = (iso: string) => { const d = new Date(iso); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC` }
const saleOn = (p: { salePct: number; saleUntil: string | null }, now: number) => p.salePct > 0 && !!p.saleUntil && new Date(p.saleUntil).getTime() > now

function playerName(r: BoardRow): string {
    return r.nickname || r.nick || r.x || r.wallet
}
function playerAvatar(r: BoardRow): string | null {
    const a = r.avatar || r.avatarUrl
    return a && /^https?:\/\//.test(a) ? a : null
}

function timeLeft(ms: number): string {
    const m = Math.max(0, Math.floor(ms / 60_000))
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
    if (d >= 1) return `${d}d ${h}h`
    if (h >= 1) return `${h}h ${mm}m`
    return `${mm}m`
}

/** PLAY: a full page load (nothing of the landing stays in memory under the game), counted first. */
function PlayLink({ className, children, testId }: { className: string; children: ReactNode; testId?: string }) {
    return (
        <a href={PLAY_HREF} data-testid={testId} onClick={() => trackFunnel('play_click', { again: true })} className={className}>
            {children}
        </a>
    )
}

/**
 * A hero from the game: its idle frame (324×164, the figure somewhere inside) cropped to the figure's
 * box and scaled up sharp. The droids are near-black silhouettes by design — they stand on the
 * game's fog, a light tile.
 */
function HeroSprite({ id, height, className = '' }: { id: string; height: number; className?: string }) {
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
function Avatar({ row, size }: { row: BoardRow; size: number }) {
    const url = playerAvatar(row)
    if (url) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={url} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-full border border-white/10 object-cover" style={{ width: size, height: size }} />
    }
    return (
        <span className="grid shrink-0 place-items-end justify-center overflow-hidden rounded-full border border-white/10 bg-gradient-to-b from-[#c3cad6] to-[#8a93a5]" style={{ width: size, height: size }}>
            {row.hero && CAT.heroes[row.hero] ? <HeroSprite id={row.hero} height={Math.round(size * 0.8)} /> : null}
        </span>
    )
}

function LiveDot() {
    return (
        <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
    )
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────

export function SurvivalLanding({ prices }: { prices: LandingPrice[] }) {
    const [isProfileOpen, setIsProfileOpen] = useState(false)
    const [pool, setPool] = useState<Pool | null | undefined>(undefined)
    const [board, setBoard] = useState<BoardRow[] | null | undefined>(undefined)
    const [tickets, setTickets] = useState<Tickets | null>(null)
    const [now, setNow] = useState(() => Date.now())
    /** Phone facts after mount: the video's mode, the background, the install hint. */
    const [device, setDevice] = useState<{ mobile: boolean; ios: boolean; inWallet: boolean } | null>(null)

    useEffect(() => {
        setDevice({ mobile: isMobileDevice(), ios: isIOSDevice(), inWallet: inWalletBrowser() })
        trackFunnel('landing_view')
    }, [])

    // The live numbers. The pool every minute while the tab is in front (its route is cached at the
    // edge for 30 s); the board and the ticket price once.
    useEffect(() => {
        let alive = true
        const getJson = async <T,>(url: string): Promise<T | null> => {
            try {
                const r = await fetch(url, { cache: 'no-store' })
                if (r.status !== 200) return null
                return (await r.json()) as T
            } catch { return null }
        }
        const loadPool = () => getJson<Pool>('/api/survival/pool').then((p) => { if (alive) setPool(p) })
        void loadPool()
        void getJson<{ rows: BoardRow[] }>('/api/survival/board').then((b) => { if (alive) setBoard(b?.rows ?? null) })
        void getJson<Tickets>('/api/survival/tickets').then((t) => { if (alive) setTickets(t) })
        const id = setInterval(() => { if (document.visibilityState === 'visible') { void loadPool(); setNow(Date.now()) } }, 60_000)
        return () => { alive = false; clearInterval(id) }
    }, [])

    const top3 = board?.slice(0, 3) ?? []
    const runs = prices.filter((p) => p.kind === 'runs')
    const pass = prices.find((p) => p.kind === 'season_pass')
    const seasonLive = !!pool?.paysOut && !!pool.endsAt

    return (
        <main className="relative w-full overflow-x-hidden bg-black font-sans text-white">
            {/* The site's running glyphs, as on the home page — not on a phone (battery, memory). */}
            {device && !device.mobile && (
                <div
                    className="pointer-events-none fixed inset-0 z-0 select-none opacity-60 mix-blend-screen"
                    style={{ maskImage: 'linear-gradient(to bottom, black 30%, transparent 75%)', WebkitMaskImage: 'linear-gradient(to bottom, black 30%, transparent 75%)' }}
                >
                    <DigitalBackground />
                </div>
            )}

            <Header onOpenProfile={() => setIsProfileOpen(true)} />

            <div className="relative z-10">
                {/* ── 1. First screen ─────────────────────────────────────────────────────────── */}
                <section className="px-4 pb-12 pt-24 md:px-[5vw] md:pb-20 md:pt-28 lg:min-h-[100svh]">
                    <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] lg:gap-8">
                        <div className="flex min-w-0 flex-col">
                            <div className="flex flex-wrap items-center gap-2">
                                <span data-testid="season-status" className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/[0.07] px-3 py-1.5 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                                    <LiveDot />
                                    {seasonLive ? `${pool!.seasonName} · Live` : 'Open beta · Live'}
                                </span>
                                <span className={`${LABEL_CLASS} rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-white/45`}>
                                    Pixel roguelite · ApeChain
                                </span>
                            </div>
                            <h1 className="mt-5 text-[2.6rem] font-black uppercase leading-[0.9] tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.25)] sm:text-6xl xl:text-7xl">
                                <GlitchText text="Droidz Survival" />
                            </h1>
                            <p className="mt-4 max-w-xl text-base leading-relaxed text-white/60 md:text-lg">
                                <span className="text-white">Pick a droid, survive the waves, climb the season board. </span>
                                Half of every payment fills a prize pool in APE.
                            </p>
                            {/* On a phone PLAY comes before the video — the first thing under the thumb. */}
                            <div className="mt-6 lg:hidden">
                                <PlayLink testId="play-hero-mobile" className={`${ACCENT_BTN} w-full !py-5 !text-base`}>
                                    <Play className="h-5 w-5" fill="currentColor" /> Play
                                </PlayLink>
                                <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-white/35">
                                    Free {TRIAL_WAVES}-wave trial · one free signature
                                </p>
                            </div>
                            <div className="mt-6 lg:mt-7 lg:flex-1">
                                <GameplayVideo tapToPlay={device?.mobile ?? true} />
                            </div>
                        </div>

                        {/* The live card: pool, season, top 3, PLAY. */}
                        <aside className="flex min-w-0 flex-col rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-md md:p-7">
                            <div className={`${LABEL_CLASS} text-white/35`}>Prize pool</div>
                            <div data-testid="pool-ape" className="mt-3 flex items-baseline gap-2 font-semibold tabular-nums tracking-tight">
                                <span className="text-5xl leading-none md:text-6xl">{pool ? ape(pool.poolApe) : '—'}</span>
                                <span className="text-xl text-white/35 md:text-2xl">APE</span>
                            </div>
                            <p className="mt-3 text-sm leading-relaxed text-white/45">
                                {pool
                                    ? <>{int(pool.players)} players · {int(pool.games)} runs this season. {pool.paysOut ? 'Paid out at the end of the season.' : 'Paid out in Season 1.'}</>
                                    : pool === null ? 'The pool shows here when a season is live.' : 'Loading the pool…'}
                            </p>

                            <div className="mt-5 border-t border-white/10 pt-5">
                                <div className={`${LABEL_CLASS} text-white/35`}>Season</div>
                                {seasonLive ? (
                                    <p className="mt-2 text-lg font-semibold tracking-tight">
                                        {pool!.seasonName} <span className="text-white/40">· ends in</span> <span className="tabular-nums">{timeLeft(pool!.endsAt! - now)}</span>
                                    </p>
                                ) : (
                                    <p className="mt-2 flex items-center gap-2 text-lg font-semibold tracking-tight">
                                        <LiveDot /> Open beta <span className="text-white/40">· live now</span>
                                    </p>
                                )}
                                <p className="mt-1 text-sm text-white/40">
                                    {seasonLive ? 'Pass holders share the pool by best score.' : 'Season 1 starts after the beta.'}
                                </p>
                            </div>

                            <div className="mt-5 flex-1 border-t border-white/10 pt-5">
                                <div className="flex items-center justify-between">
                                    <span className={`${LABEL_CLASS} text-white/35`}>Top 3</span>
                                    <a href="#leaderboard" className={`${LABEL_CLASS} text-white/35 transition-colors hover:text-white`}>Full board</a>
                                </div>
                                <ol data-testid="top3" className="mt-3 space-y-2">
                                    {board === undefined && [0, 1, 2].map((i) => <li key={i} className="h-11 animate-pulse rounded-xl bg-white/[0.04]" />)}
                                    {board !== undefined && top3.length === 0 && <li className="text-sm text-white/40">No runs on the board yet — be the first.</li>}
                                    {top3.map((r) => (
                                        <li key={r.rank} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2">
                                            <span className={`w-5 font-mono text-sm font-black tabular-nums ${r.rank === 1 ? 'text-[#F2C94C]' : 'text-white/50'}`}>{r.rank}</span>
                                            <Avatar row={r} size={28} />
                                            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{playerName(r)}</span>
                                            <span className="font-mono text-sm tabular-nums text-white/80">{int(r.score)}</span>
                                        </li>
                                    ))}
                                </ol>
                            </div>

                            <div className="mt-6 hidden lg:block">
                                <PlayLink testId="play-hero" className={`${ACCENT_BTN} w-full !py-5 !text-base`}>
                                    <Play className="h-5 w-5" fill="currentColor" /> Play
                                </PlayLink>
                                <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-white/35">
                                    Free {TRIAL_WAVES}-wave trial · one free signature
                                </p>
                            </div>
                        </aside>
                    </div>
                    <a href="#how" aria-label="Scroll down" className="mx-auto mt-8 hidden w-fit text-white opacity-30 transition-opacity hover:opacity-80 lg:block">
                        <ChevronDown className="h-6 w-6 animate-bounce" />
                    </a>
                </section>

                {/* ── 2. How to play ──────────────────────────────────────────────────────────── */}
                <Section id="how" label="How to play" title="Three steps to the first wave">
                    <div className="grid gap-4 md:grid-cols-3 md:gap-5">
                        {[
                            { n: '01', icon: Wallet, title: 'Connect a wallet', text: 'MetaMask, Coinbase Wallet or Rainbow. On a phone the wallet app opens to approve.' },
                            { n: '02', icon: PenLine, title: 'Sign once', text: 'One message proves the wallet is yours. Free: no transaction, no gas, nothing leaves your wallet.' },
                            { n: '03', icon: Gamepad2, title: 'Play', text: `Pick a hero and survive the waves. Your first run is a free ${TRIAL_WAVES}-wave trial; your best score goes on the board.` },
                        ].map((s, i) => (
                            <Reveal key={s.n} delay={i * 0.06}>
                                <div className="h-full rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md md:p-7">
                                    <div className="flex items-center justify-between">
                                        <span className={`${LABEL_CLASS} text-white/25`}>{s.n}</span>
                                        <s.icon className="h-5 w-5 text-white icon-dim-50" />
                                    </div>
                                    <h3 className="mt-8 text-xl font-semibold tracking-tight md:text-2xl">{s.title}</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-white/50">{s.text}</p>
                                </div>
                            </Reveal>
                        ))}
                    </div>
                    <Reveal className="mt-8 flex justify-center">
                        <PlayLink testId="play-how" className={ACCENT_BTN}><Play className="h-4 w-4" fill="currentColor" /> Play now</PlayLink>
                    </Reveal>
                </Section>

                {/* ── 3. Heroes ───────────────────────────────────────────────────────────────── */}
                <Section id="heroes" label="Heroes" title="Three heroes, three ways to fight" description="The weapon follows the class. Droid is yours from the start; Geez and Gob unlock with Ape Mini, the coin runs pay.">
                    <div className="grid gap-4 md:grid-cols-3 md:gap-5">
                        {HEROES.map((h, i) => (
                            <Reveal key={h.id} delay={i * 0.06}>
                                <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md">
                                    <div className="relative flex h-52 items-end justify-center bg-gradient-to-b from-[#cfd5df] via-[#a9b1c0] to-[#7e8798] md:h-60">
                                        <span className="absolute inset-x-0 bottom-0 h-6 bg-[#2a2f3a]" aria-hidden />
                                        <HeroSprite id={h.id} height={168} className="relative mb-5" />
                                        <span className="absolute left-4 top-4 rounded-full bg-black/80 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white">{h.cls}</span>
                                    </div>
                                    <div className="flex flex-1 flex-col p-6">
                                        <h3 className="text-2xl font-semibold tracking-tight">{CAT.heroes[h.id]?.name ?? h.id}</h3>
                                        <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-white/40">{h.hp} HP · {h.weapon}</p>
                                        <p className="mt-4 text-sm leading-relaxed text-white/60">{h.passive}</p>
                                        <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-sm">
                                            <div><dt className={`${LABEL_CLASS} text-white/30`}>Super</dt><dd className="mt-1 font-semibold">{h.superMove}</dd></div>
                                            <div><dt className={`${LABEL_CLASS} text-white/30`}>Skill</dt><dd className="mt-1 font-semibold">{h.skill}</dd></div>
                                        </dl>
                                        <p className="mt-auto pt-5 font-mono text-[11px] uppercase tracking-widest text-white/45">{h.unlock}</p>
                                    </div>
                                </article>
                            </Reveal>
                        ))}
                    </div>
                </Section>

                {/* ── 4. Season and prize pool ────────────────────────────────────────────────── */}
                <Section id="season" label="Season & prize pool" title="Play for a real APE pool">
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                        <Reveal>
                            <div className="flex h-full flex-col justify-between rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md md:p-8">
                                <div>
                                    <div className={`${LABEL_CLASS} text-white/35`}>{pool?.paysOut ? pool.seasonName : 'Open beta'} pool · live</div>
                                    <div className="mt-4 flex items-baseline gap-3 font-semibold tabular-nums tracking-tight">
                                        <span className="text-6xl leading-none md:text-7xl">{pool ? ape(pool.poolApe) : '—'}</span>
                                        <span className="text-2xl text-white/35">APE</span>
                                    </div>
                                    <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/45">
                                        Summed live from every payment booked this season. {pool?.paysOut ? 'Paid out when the season ends.' : 'The open beta pool is paid out in Season 1.'}
                                    </p>
                                </div>
                                <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-white/10 pt-5">
                                    <Stat label="Players" value={pool ? int(pool.players) : '—'} />
                                    <Stat label="Runs" value={pool ? int(pool.games) : '—'} />
                                    <Stat label="To pay out" value={pool ? `${ape(pool.payoutApe)} APE` : '—'} />
                                </dl>
                            </div>
                        </Reveal>
                        <Reveal delay={0.06}>
                            <ul className="grid h-full gap-3">
                                <Fact big={`${POOL_SHARE_PCT}%`} text="of every payment in the game — runs, tickets, the pass — goes into the prize pool." />
                                <Fact big="Pass" text="holders share the pool, by their best score of the season." />
                                <Fact big={pool ? `${pool.reservePct}%` : '—'} text="of the pool is kept back to start the next season." />
                                <Fact big="S1" text="Season 1 starts after the open beta and pays out what the beta's pool gathers. A season lasts two weeks." />
                            </ul>
                        </Reveal>
                    </div>
                    {pool && pool.prizes.length > 0 && (
                        <Reveal className="mt-5">
                            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md md:p-8">
                                <div className={`${LABEL_CLASS} text-white/35`}>NFT prizes on top of the APE</div>
                                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                                    {pool.prizes.map((p, i) => (
                                        <div key={i} className="rounded-2xl border border-white/10 bg-black/40 p-3">
                                            {p.imageUrl
                                                // eslint-disable-next-line @next/next/no-img-element
                                                ? <img src={p.imageUrl} alt="" loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                                                : <div className="aspect-square w-full rounded-xl bg-white/[0.04]" />}
                                            <p className="mt-2 truncate text-sm font-semibold">{p.name ?? 'NFT prize'}</p>
                                            <p className="font-mono text-[10px] uppercase tracking-widest text-white/40">
                                                Place {p.place}{p.awarded ? ' · awarded' : p.unlockLevel ? ` · opens at level ${p.unlockLevel}` : ''}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </Reveal>
                    )}
                </Section>

                {/* ── 5. Season pass ──────────────────────────────────────────────────────────── */}
                <Section id="pass" label="Season pass" title="The pass">
                    <Reveal>
                        <div className="grid gap-8 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md md:p-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
                            <div>
                                <span className="inline-flex items-center gap-2 rounded-full border border-[#F2C94C]/30 bg-[#F2C94C]/10 px-3 py-1.5 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-[#F2C94C]">
                                    Soon
                                </span>
                                <h3 className="mt-5 text-3xl font-semibold tracking-tight md:text-4xl">Season 1 pass</h3>
                                <p className="mt-3 max-w-md text-base leading-relaxed text-white/55">
                                    Paid in APE; it opens with Season 1. Only pass holders share the prize pool — and they are marked PASS on the board.
                                </p>
                                {pass && pass.holderDiscountPct > 0 && (
                                    <p className="mt-3 text-sm text-white/45">ApeDroidz holders get {pass.holderDiscountPct}% off.</p>
                                )}
                                <span className="mt-7 inline-flex cursor-not-allowed select-none items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-6 py-4 text-sm font-black uppercase tracking-widest text-[#5f5f5f]">
                                    {/* a solid colour, not opacity: the lock's shackle overlaps its body */}
                                    <Lock size={15} className="text-[#5f5f5f]" /> Pass sale · Soon
                                </span>
                            </div>
                            <ul className="grid gap-3">
                                {PASS_PERKS.map((p) => (
                                    <li key={p.title} className="flex items-start gap-4 rounded-2xl border border-white/[0.08] bg-black/30 p-5">
                                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#F2C94C]/25 bg-[#F2C94C]/10">
                                            <p.icon className="h-5 w-5 text-[#F2C94C]" />
                                        </span>
                                        <div>
                                            <p className="font-semibold tracking-tight">{p.title}</p>
                                            <p className="mt-1 text-sm leading-relaxed text-white/50">{p.line}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </Reveal>
                </Section>

                {/* ── 6. Leaderboard ──────────────────────────────────────────────────────────── */}
                <Section id="leaderboard" label="Leaderboard" title={pool?.paysOut ? `${pool.seasonName} board` : 'Open beta board'} description="Each player's best run of the season. Rejected or void runs never make it here.">
                    <Reveal>
                        <div data-testid="board" className="overflow-hidden rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md">
                            <div className={`hidden grid-cols-[3rem_minmax(0,1fr)_7rem_9rem_4.5rem_8rem] items-center gap-4 border-b border-white/10 px-6 py-4 md:grid ${LABEL_CLASS} text-white/30`}>
                                <span>#</span><span>Player</span><span>Hero</span><span>Clan</span><span className="text-right">Wave</span><span className="text-right">Score</span>
                            </div>
                            {board === undefined && <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-white/[0.04]" />)}</div>}
                            {board === null && <p className="p-6 text-sm text-white/45">The board shows here when a season is live.</p>}
                            {board && board.length === 0 && <p className="p-6 text-sm text-white/45">No runs on the board yet — be the first.</p>}
                            {board && board.slice(0, 20).map((r) => (
                                <div key={r.rank} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-0 md:grid-cols-[3rem_minmax(0,1fr)_7rem_9rem_4.5rem_8rem] md:gap-4 md:px-6">
                                    <span className={`font-mono text-sm font-black tabular-nums ${r.rank <= 3 ? 'text-[#F2C94C]' : 'text-white/40'}`}>{r.rank}</span>
                                    <span className="flex min-w-0 items-center gap-3">
                                        <Avatar row={r} size={32} />
                                        <span className="min-w-0">
                                            <span className="flex items-center gap-2">
                                                <span className="truncate text-sm font-semibold">{playerName(r)}</span>
                                                {r.pass && <span className="font-mono text-[10px] font-black tracking-[0.2em] text-[#F2C94C]">PASS</span>}
                                            </span>
                                            {/* On a phone the clan and the wave sit under the name. */}
                                            <span className="block truncate font-mono text-[10px] uppercase tracking-widest text-white/35 md:hidden">
                                                {[r.clan, `wave ${r.wave}`].filter(Boolean).join(' · ')}
                                            </span>
                                        </span>
                                    </span>
                                    <span className="hidden truncate text-sm text-white/60 md:block">{r.hero ? CAT.heroes[r.hero]?.name ?? r.hero : '—'}</span>
                                    <span className="hidden truncate text-sm text-white/60 md:block">{r.clan ?? '—'}</span>
                                    <span className="hidden text-right font-mono text-sm tabular-nums text-white/60 md:block">{r.wave}</span>
                                    <span className="text-right font-mono text-sm font-semibold tabular-nums">{int(r.score)}</span>
                                </div>
                            ))}
                        </div>
                    </Reveal>
                </Section>

                {/* ── 7. FAQ ──────────────────────────────────────────────────────────────────── */}
                <Section id="faq" label="FAQ" title="Questions">
                    <div className="mx-auto max-w-3xl space-y-3">
                        <Faq q="Which wallet do I need?">
                            Any of MetaMask, Coinbase Wallet or Rainbow. On a phone the wallet app opens to approve the
                            connection; if it never comes back, open the play page in your wallet&apos;s own browser — the
                            play page has a button for that.
                        </Faq>
                        <Faq q="Is the signature free?">
                            Yes. Signing a message only proves the wallet is yours: there is no transaction, no gas, and
                            nothing leaves your wallet. You sign once and stay signed in.
                        </Faq>
                        <Faq q="Why ApeChain?">
                            Droidz Survival lives on ApeChain: runs, lucky tickets and the prize pool are in APE. If your
                            wallet app does not have ApeChain yet, the play page adds it with one tap. Ape Mini, the
                            game&apos;s own coin, is not APE: it cannot be withdrawn, sold or swapped.
                        </Faq>
                        <Faq q="How much does a run cost?" open>
                            <span className="block">Your first run is a free {TRIAL_WAVES}-wave trial. After that runs are bought in the game, in APE:</span>
                            {runs.length > 0 ? (
                                <span className="mt-3 block space-y-1.5">
                                    {runs.map((p) => <PriceLine key={p.sku} title={p.title} p={p} now={now} />)}
                                    {tickets?.priceApe != null && (
                                        <PriceLine title="Lucky ticket" p={{ priceApe: tickets.priceApe, fullPriceApe: tickets.fullPriceApe ?? tickets.priceApe, salePct: tickets.salePct, saleUntil: tickets.saleUntil }} now={now} />
                                    )}
                                </span>
                            ) : (
                                <span className="mt-2 block">The live price list is in the game&apos;s shop.</span>
                            )}
                            <span className="mt-3 block">Half of every payment goes into the prize pool.</span>
                        </Faq>
                        <Faq q="Can I play on my phone?">
                            <span className="block">
                                Yes — iPhone and Android, held sideways. Add it to your Home Screen and it opens full screen,
                                without the browser&apos;s bars: on iPhone, Safari → Share → Add to Home Screen; on Android,
                                the browser menu → Install app (or Add to Home screen). Sign in once inside the app.
                            </span>
                            {device?.mobile && !device.inWallet && <InstallHint ios={device.ios} className="mt-4" />}
                        </Faq>
                        <Faq q="Who gets the prize pool?">
                            Season-pass holders, by their best score of the season. The open beta&apos;s pool is paid out in
                            Season 1. The pass is not on sale yet — it opens with Season 1.
                        </Faq>
                    </div>
                </Section>

                {/* ── Last call ──────────────────────────────────────────────────────────────── */}
                <section className="px-4 pb-16 pt-4 md:px-[5vw] md:pb-24">
                    <Reveal>
                        <div className="flex flex-col items-center rounded-3xl border border-white/10 bg-white/5 px-6 py-12 text-center backdrop-blur-md md:py-16">
                            <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">Survive the waves.</h2>
                            <p className="mt-3 max-w-md text-white/50">
                                {pool ? <>The pool stands at <span className="text-white">{ape(pool.poolApe)} APE</span>.</> : 'The pool fills as people play.'} Your first run is free.
                            </p>
                            <PlayLink testId="play-bottom" className={`${ACCENT_BTN} mt-8 !px-12 !py-5 !text-base`}>
                                <Play className="h-5 w-5" fill="currentColor" /> Play
                            </PlayLink>
                        </div>
                    </Reveal>
                </section>

                <Footer />
            </div>

            <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
        </main>
    )
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────

function Section({ id, label, title, description, children }: { id: string; label: string; title: string; description?: string; children: ReactNode }) {
    return (
        <section id={id} className="scroll-mt-24 px-4 py-14 md:px-[5vw] md:py-20">
            <Reveal className="mb-8 md:mb-12">
                <div className={`${LABEL_CLASS} mb-4 text-white/35`}>{label}</div>
                <h2 className="text-3xl font-semibold leading-none tracking-tight md:text-5xl">{title}</h2>
                {description && <p className="mt-4 max-w-2xl font-mono text-sm leading-relaxed text-white/55">{description}</p>}
            </Reveal>
            {children}
        </section>
    )
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <dt className={`${LABEL_CLASS} text-white/30`}>{label}</dt>
            <dd className="mt-1.5 truncate text-lg font-semibold tabular-nums tracking-tight md:text-xl">{value}</dd>
        </div>
    )
}

function Fact({ big, text }: { big: string; text: string }) {
    return (
        <li className="flex items-center gap-5 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md">
            <span className="w-16 shrink-0 text-2xl font-semibold tabular-nums tracking-tight text-[#F2C94C] md:w-20 md:text-3xl">{big}</span>
            <span className="text-sm leading-relaxed text-white/60">{text}</span>
        </li>
    )
}

function Faq({ q, children, open = false }: { q: string; children: ReactNode; open?: boolean }) {
    return (
        <details open={open} className="group rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md open:bg-white/[0.07]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-base font-semibold tracking-tight md:px-6 md:py-5 [&::-webkit-details-marker]:hidden">
                {q}
                <ChevronDown className="h-4 w-4 shrink-0 text-white icon-dim-50 transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 text-sm leading-relaxed text-white/55 md:px-6">{children}</div>
        </details>
    )
}

function PriceLine({ title, p, now }: { title: string; p: { priceApe: number; fullPriceApe: number; salePct: number; saleUntil: string | null }; now: number }) {
    const sale = saleOn(p, now)
    return (
        <span className="flex flex-wrap items-baseline gap-x-2 text-white/75">
            <span className="font-semibold text-white">{title}</span>
            <span>—</span>
            <span className="font-mono tabular-nums text-white">{ape(sale ? p.priceApe : p.fullPriceApe)} APE</span>
            {sale && (
                <>
                    <span className="font-mono tabular-nums text-white/35 line-through">{ape(p.fullPriceApe)}</span>
                    <span className="rounded-full bg-[#0069FF]/20 px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-widest text-[#6aa5ff]">-{p.salePct}% until {utc(p.saleUntil!)}</span>
                </>
            )}
        </span>
    )
}

/**
 * The gameplay video (the beta trailer on R2, H.264). Light: metadata only until it plays, and it
 * plays only while on screen. On a phone (or with reduced motion) it is the poster with a play
 * button — nothing is downloaded until the tap, and the tap plays it with sound.
 */
function GameplayVideo({ tapToPlay }: { tapToPlay: boolean }) {
    const ref = useRef<HTMLVideoElement>(null)
    const box = useRef<HTMLDivElement>(null)
    const [muted, setMuted] = useState(true)
    const [started, setStarted] = useState(false)
    const [reduced, setReduced] = useState(false)
    const manual = tapToPlay || reduced

    useEffect(() => {
        try { setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches) } catch { /* old browser */ }
    }, [])

    // Desktop: plays muted while at least a third of it is on screen, pauses otherwise.
    useEffect(() => {
        const v = ref.current
        if (!v || manual) return
        const io = new IntersectionObserver(([e]) => {
            if (e.isIntersecting) { v.muted = true; void v.play().then(() => setStarted(true)).catch(() => {}) }
            else v.pause()
        }, { threshold: 0.33 })
        io.observe(v)
        return () => io.disconnect()
    }, [manual])

    // Leaving the page (PLAY): the decoder and the buffer go at once, not whenever the browser collects.
    useEffect(() => {
        const v = ref.current
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
        <div ref={box} data-testid="gameplay-video" className="group relative h-full overflow-hidden rounded-3xl border border-white/10 bg-black">
            <div className="relative aspect-[1920/974] h-full w-full lg:aspect-auto lg:min-h-[300px]">
                <video
                    ref={ref}
                    src={VIDEO_SRC}
                    poster={VIDEO_POSTER}
                    muted
                    loop
                    playsInline
                    preload={manual ? 'none' : 'metadata'}
                    className="absolute inset-0 h-full w-full object-cover"
                    onClick={manual && !started ? tapPlay : toggleSound}
                />
            </div>
            <span className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/15 bg-black/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white/75 backdrop-blur">
                Gameplay · beta trailer
            </span>
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
                        className="flex h-9 items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3 font-mono text-[10px] uppercase tracking-widest text-white/80 backdrop-blur transition-colors hover:bg-white hover:text-black"
                    >
                        {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                        {muted ? 'Sound on' : 'Mute'}
                    </button>
                    <button
                        onClick={fullscreen}
                        aria-label="Fullscreen"
                        className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-black/50 text-white/80 backdrop-blur transition-colors hover:bg-white hover:text-black"
                    >
                        <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}
        </div>
    )
}
