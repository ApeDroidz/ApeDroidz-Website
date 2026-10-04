'use client'

import { useEffect, useState } from 'react'
import { Crown, Gamepad2, Ticket } from 'lucide-react'
import { LABEL_CLASS, Reveal } from '@/components/landing/ui'
import {
    Ape, ape, BLUE, int, nextMilestone, POOL_MILESTONES, POOL_SEASON, POOL_SHARE, poolLevel, saleOn, Section, timeLeft,
    type LandingPrice, type Pool, type Tickets,
} from './shared'

/**
 * The prize pool — one compact block, one focus (owner, 04.10.2026: «свести в один блок: сумма + прогресс-бар;
 * вернуть анимацию, как 50% каждой оплаты летит в пул; пояснения — одной-двумя строками»).
 *
 *   the flow: a run, a lucky ticket, the pass → half of each flies into → the amount (big, blue);
 *   the bar to the pool's next level, the levels it passes marked on it (game config/season.ts
 *     milestones — the menu's bar and ui/poolDetails.ts show the same);
 *   one line on who takes it and when.
 *
 * Every amount is the live API's (/api/survival/pool) or the live catalog's; nothing is a guess.
 */
export function PoolSection({ pool, prices, tickets, now }: { pool: Pool | null | undefined; prices: LandingPrice[]; tickets: Tickets | null; now: number }) {
    return (
        <Section
            id="pool"
            tight
            label="Prize pool"
            title={<>Play for a real <Ape big dollar /> pool</>}
        >
            <Reveal>
                <PoolBlock pool={pool} prices={prices} tickets={tickets} now={now} />
            </Reveal>
        </Section>
    )
}

// The flow's rows: fixed height so the SVG joining them can be drawn to scale (no stretching).
const ROW_H = 52, ROW_GAP = 8
const ROW_Y = [0, 1, 2].map((i) => i * (ROW_H + ROW_GAP) + ROW_H / 2)
const FLOW_H = 3 * ROW_H + 2 * ROW_GAP
const FLOW_W = 132
const MID = { x: 62, y: FLOW_H / 2 }

function PoolBlock({ pool, prices, tickets, now }: { pool: Pool | null | undefined; prices: LandingPrice[]; tickets: Tickets | null; now: number }) {
    const [motion, setMotion] = useState(false)
    useEffect(() => {
        try { setMotion(!window.matchMedia('(prefers-reduced-motion: reduce)').matches) } catch { setMotion(true) }
    }, [])

    const cur = (p: { priceApe: number; fullPriceApe: number; salePct: number; saleUntil: string | null } | undefined | null) =>
        p ? (saleOn(p, now) ? p.priceApe : p.fullPriceApe) : null
    const run = prices.find((p) => p.sku === 'run') ?? prices.find((p) => p.kind === 'runs')
    const ticketP = tickets?.priceApe != null
        ? { priceApe: tickets.priceApe, fullPriceApe: tickets.fullPriceApe ?? tickets.priceApe, salePct: tickets.salePct, saleUntil: tickets.saleUntil }
        : prices.find((p) => p.sku === 'ticket') ?? null
    const pass = prices.find((p) => p.kind === 'season_pass')
    const sources: Array<{ icon: GameIconId; title: string; price: number | null; soon?: boolean }> = [
        { icon: 'run', title: 'A run', price: cur(run) },
        { icon: 'ticket', title: 'A lucky ticket', price: cur(ticketP) },
        { icon: 'pass', title: 'The season pass', price: pass ? pass.fullPriceApe : null, soon: true },
    ]

    const amount = pool?.poolApe ?? 0
    const lv = poolLevel(amount)
    const goal = nextMilestone(amount)
    const done = amount >= goal
    const pct = pool ? Math.min(100, (amount / goal) * 100) : 0
    // The levels passed on the way to this goal, marked on the bar.
    const ticks = POOL_MILESTONES.filter((m) => m < goal)
    // Their captions only where they fit: from the top one down, 10% apart, clear of both ends.
    const labelled = new Set<number>()
    let lastPos = 100
    for (const m of [...ticks].reverse()) {
        const pos = (m / goal) * 100
        if (pos <= 88 && pos >= 6 && lastPos - pos >= 10) { labelled.add(m); lastPos = pos }
    }
    const live = !!pool?.paysOut

    return (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-10">
            <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.1fr)] lg:gap-6">
                {/* where it comes from */}
                <div className="order-2 min-w-0 lg:order-1">
                    <div className={`${LABEL_CLASS} mb-3 text-white/40`}>Half of every payment</div>
                    <ul className="grid" style={{ gap: ROW_GAP }}>
                        {sources.map((s) => (
                            <li key={s.title} className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-black/40 px-4" style={{ height: ROW_H }}>
                                <span className="flex min-w-0 items-center gap-3 text-sm font-semibold">
                                    <GameIcon id={s.icon} />
                                    <span className="truncate">{s.title}</span>{s.soon && <span className="font-mono text-[10px] font-normal uppercase tracking-widest text-white/35">soon</span>}
                                </span>
                                <span className="shrink-0 text-right font-mono text-xs tabular-nums text-white/55">
                                    {s.price != null ? <>{ape(s.price)} <Ape /></> : '—'}
                                    {/* on a phone the half is written out; on a wide screen it flies */}
                                    {s.price != null && <span className="ml-2 font-semibold text-white lg:hidden">→ +{ape(s.price * POOL_SHARE)}</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* the join: three lines into «50%», then on into the pool; dots fly along them */}
                <div className="order-3 hidden lg:order-2 lg:block" aria-hidden>
                    <svg width={FLOW_W} height={FLOW_H} viewBox={`0 0 ${FLOW_W} ${FLOW_H}`} className="mt-7 overflow-visible">
                        {ROW_Y.map((y, i) => (
                            <path key={i} id={`ds-in-${i}`} d={`M0 ${y} C ${MID.x * 0.6} ${y}, ${MID.x * 0.5} ${MID.y}, ${MID.x} ${MID.y}`} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
                        ))}
                        <path id="ds-out" d={`M${MID.x} ${MID.y} L ${FLOW_W} ${MID.y}`} fill="none" stroke={BLUE} strokeWidth="1.5" />
                        {motion && ROW_Y.map((_, i) => (
                            <circle key={i} r="3.5" fill="#fff">
                                <animateMotion dur="1.8s" begin={`${i * 0.6}s`} repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.55;1" calcMode="linear">
                                    <mpath href={`#ds-in-${i}`} />
                                </animateMotion>
                                <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.56;1" dur="1.8s" begin={`${i * 0.6}s`} repeatCount="indefinite" />
                            </circle>
                        ))}
                        {motion && [0, 1, 2].map((i) => (
                            <circle key={i} r="3.5" fill={BLUE}>
                                <animateMotion dur="1.8s" begin={`${i * 0.6}s`} repeatCount="indefinite" keyPoints="0;0;1" keyTimes="0;0.55;1" calcMode="linear">
                                    <mpath href="#ds-out" />
                                </animateMotion>
                                <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.54;0.56;0.95;1" dur="1.8s" begin={`${i * 0.6}s`} repeatCount="indefinite" />
                            </circle>
                        ))}
                        <circle cx={MID.x} cy={MID.y} r="21" fill="#000" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
                        <text x={MID.x} y={MID.y + 4} textAnchor="middle" className="fill-white font-mono text-[11px] font-bold">50%</text>
                    </svg>
                </div>

                {/* the pool: the focus */}
                <div className="order-1 min-w-0 lg:order-3">
                    <div className={`${LABEL_CLASS} text-white/40`}>
                        {live ? pool!.seasonName : `Season ${POOL_SEASON}`} prize pool · live
                    </div>
                    <div data-testid="pool-ape" className="mt-3 flex flex-wrap items-baseline gap-x-3 font-semibold tabular-nums tracking-tight">
                        {/* White, «10.5 $APE» (owner, 04.10.2026) — the blue in this block is the bar. */}
                        <span className="text-7xl leading-none text-white md:text-8xl">{pool ? ape(pool.poolApe) : '—'}</span>
                        <span className="text-3xl font-bold leading-none text-white md:text-4xl">$APE</span>
                    </div>
                    <p className="mt-3 text-sm text-white/45">
                        {pool === undefined && 'Loading the pool…'}
                        {pool === null && 'The pool shows here when a season is live.'}
                        {pool && <>Level {lv} · {int(pool.players)} players · {int(pool.games)} runs{live && pool.endsAt ? <> · ends in {timeLeft(pool.endsAt - now)}</> : null}</>}
                    </p>
                </div>
            </div>

            {/* The bar to the next level, the levels on the way marked on it. */}
            <div className="mt-9">
                <div className="relative h-3 rounded-full bg-white/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={amount} aria-label="Prize pool toward the next level">
                    <div className="relative h-full overflow-hidden rounded-full" style={{ width: `${Math.max(pct, pool ? 2 : 0)}%`, background: BLUE }}>
                        <span aria-hidden className="ds-glint absolute inset-y-0 w-16" />
                    </div>
                    {ticks.map((m) => (
                        <span key={m} aria-hidden className="absolute top-1/2 h-5 w-px -translate-y-1/2 bg-white/70" style={{ left: `${(m / goal) * 100}%` }} />
                    ))}
                </div>
                <div className="relative mt-2 h-4 font-mono text-[10px] uppercase tracking-wider text-white/40">
                    <span className="absolute left-0">0</span>
                    {ticks.filter((m) => labelled.has(m)).map((m) => (
                        <span key={m} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(m / goal) * 100}%` }}>Lvl {poolLevel(m)} · {m}</span>
                    ))}
                    <span className="absolute right-0 whitespace-nowrap text-white/70">{done ? 'All levels' : <>Lvl {lv + 1} · {ape(goal)}</>}</span>
                </div>
                <p className="mt-4 text-sm text-white/60">
                    {pool && !done
                        ? <><span className="font-semibold text-white">{ape(goal - amount)}</span> <Ape /> to level {lv + 1} — every run moves it.</>
                        : ' '}
                </p>
            </div>

            {/* Who takes it and when, in two short lines. */}
            <p className="mt-6 border-t border-white/[0.07] pt-5 text-sm leading-relaxed text-white/50">
                Season-pass holders share it by best score{live ? ' when the season ends' : ` when Season ${POOL_SEASON} ends — the open beta is gathering it now`}.
                {pool ? <> {pool.reservePct}% is kept to start Season {POOL_SEASON + 1}.</> : null}
            </p>
            {pool && pool.prizes.length > 0 && (
                <p className="mt-2 text-sm text-white/50">Plus {pool.prizes.length} NFT prize{pool.prizes.length > 1 ? 's' : ''} on top of the <Ape />, opened by the pool&apos;s levels.</p>
            )}
        </div>
    )
}

type GameIconId = 'run' | 'ticket' | 'pass'

/**
 * Site icons, not game art (owner, 04.10.2026: the game's green run card read as a ticket and the
 * lucky ticket's card as a run): a gamepad for a run, a ticket for the lucky ticket, a crown for the pass.
 */
function GameIcon({ id }: { id: GameIconId }) {
    const Icon = id === 'run' ? Gamepad2 : id === 'ticket' ? Ticket : Crown
    return (
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center text-white">
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
    )
}
