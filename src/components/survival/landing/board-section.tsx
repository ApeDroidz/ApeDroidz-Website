'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, X } from 'lucide-react'
import { LABEL_CLASS, Reveal } from '@/components/landing/ui'
import { Avatar, CAT, int, playerName, type BoardRow, type Pool } from './shared'

const TOP = 10
/** Gold, silver, bronze for the first three — the game's own (ui/poolDetails.ts PLACE_COLOR); the only colour on the board. */
const PLACE_COLOR = ['#FFCF4A', '#D8E1F0', '#D99152']
/** Each pass row's light a little behind the one above: it runs down the board (as in the game's board). */
const shineDelay = (rank: number) => `${((rank * 0.25) % 4.2).toFixed(2)}s`
/** How long the best run lasted (active time, pauses out) — «4:14», «1:02:09»; the game's TIME column (LeaderboardScene runTime). */
function runTime(ms: number | null | undefined): string | null {
    if (!ms || ms <= 0) return null
    const t = Math.round(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
    const two = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}
const COLS = 'grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[2.25rem_minmax(0,1fr)_4.5rem_7.5rem_3rem_4rem_6.5rem]'

/**
 * The board (owner, 03.10.2026: «Beta Leaderboard; компактнее — плотная таблица ограниченной
 * ширины; топ-10 и Show more → поп-ап со всем лидербордом»). Rows from /api/survival/board — one per
 * wallet, rejected or void runs never there.
 */
export function BoardSection({ board: all, passBoard, passCount, pool }: {
    board: BoardRow[] | null | undefined; passBoard: BoardRow[] | null | undefined; passCount: number | null; pool: Pool | null | undefined
}) {
    const [open, setOpen] = useState(false)
    /**
     * Everyone, or only the pass holders ranked among themselves (owner, 17.10.2026: «переключатель —
     * отдельный лидерборд тех, у кого пропуск: именно они борются за призовой пул»).
     */
    const [only, setOnly] = useState<'all' | 'pass'>('all')
    const board = only === 'pass' ? passBoard : all
    const title = pool?.paysOut ? `${pool.seasonName} Leaderboard` : 'Beta Leaderboard'
    // Two columns on a wide screen (owner, 04.10.2026: «почему всё влево, а справа пустота»): the
    // heading, its line and «Show all» on the left; the table filling the right. Stacked on a phone.
    return (
        <section id="leaderboard" className="scroll-mt-24 px-4 pb-14 pt-14 md:px-[5vw] md:pb-20 md:pt-20">
            <div className="mx-auto grid max-w-[1280px] gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.6fr)] lg:gap-14">
                <Reveal className="lg:pt-2">
                    <div className={`${LABEL_CLASS} mb-4 text-white/40`}>Leaderboard</div>
                    <h2 className="text-3xl font-semibold leading-[1.02] tracking-tight md:text-5xl">{title}</h2>
                    <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/55 md:text-base">
                        {only === 'pass'
                            ? 'Pass holders only, ranked among themselves — the race for the prize pool.'
                            : 'Each player\'s best run of the season. Rejected or void runs never make it here.'}
                    </p>
                    <div role="tablist" aria-label="Which board" className="mt-6 inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
                        {([['all', 'All players', null], ['pass', 'Pass holders', passCount]] as const).map(([k, label, n]) => (
                            <button
                                key={k}
                                role="tab"
                                aria-selected={only === k}
                                data-testid={`board-${k}`}
                                onClick={() => setOnly(k)}
                                className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors ${only === k ? (k === 'pass' ? 'bg-[#FFCF4A] text-black' : 'bg-white text-black') : 'text-white/55 hover:text-white'}`}
                            >
                                {label}
                                {n != null && <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${only === k ? 'bg-black/15' : 'bg-white/10 text-white/70'}`}>{n}</span>}
                            </button>
                        ))}
                    </div>
                    {board && board.length > TOP && (
                        <button
                            data-testid="board-more"
                            onClick={() => setOpen(true)}
                            className="mt-7 hidden items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-black uppercase tracking-widest text-white transition-colors hover:border-transparent hover:bg-white hover:text-black lg:inline-flex"
                        >
                            Show all {board.length} players <ChevronRight className="h-4 w-4" />
                        </button>
                    )}
                </Reveal>
                <Reveal delay={0.05} className="min-w-0">
                    <div data-testid="board" className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
                        <BoardHead />
                        {board === undefined && <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-11 animate-pulse rounded-xl bg-white/[0.04]" />)}</div>}
                        {board === null && <p className="p-6 text-sm text-white/45">The board shows here when a season is live.</p>}
                        {board && board.length === 0 && <p className="p-6 text-sm text-white/45">{only === 'pass' ? 'No pass holder has a run on the board yet — the first one leads the race for the pool.' : 'No runs on the board yet — be the first.'}</p>}
                        {board && board.slice(0, TOP).map((r) => <BoardLine key={r.rank} r={r} />)}
                    </div>
                    {board && board.length > TOP && (
                        <button
                            data-testid="board-more-mobile"
                            onClick={() => setOpen(true)}
                            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-3.5 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black lg:hidden"
                        >
                            Show all {board.length} players <ChevronRight className="h-4 w-4" />
                        </button>
                    )}
                </Reveal>
            </div>
            {open && board && <BoardModal rows={board} title={title} onClose={() => setOpen(false)} />}
        </section>
    )
}

function BoardHead() {
    return (
        <div className={`hidden ${COLS} items-center gap-3 border-b border-white/10 px-5 py-3 md:grid ${LABEL_CLASS} text-white/35`}>
            <span>#</span><span>Player</span><span>Hero</span><span>Clan</span><span className="text-right">Wave</span><span className="text-right">Time</span><span className="text-right">Score</span>
        </div>
    )
}

function BoardLine({ r }: { r: BoardRow }) {
    const heroName = r.hero ? CAT.heroes[r.hero]?.name ?? r.hero : null
    const top = r.rank <= 3
    return (
        <div className={`grid ${COLS} items-center gap-3 border-b border-white/[0.06] px-4 py-2.5 last:border-0 md:px-5`}>
                <span className={`font-mono tabular-nums ${r.rank === 1 ? 'text-base font-black' : top ? 'text-sm font-bold' : 'text-sm text-white/35'}`} style={top ? { color: PLACE_COLOR[r.rank - 1] } : undefined}>{r.rank}</span>
                <span className="flex min-w-0 items-center gap-3">
                    <Avatar row={r} size={30} />
                    <span className="min-w-0">
                        <span className="flex items-center gap-2">
                            <span className={`truncate text-sm ${top ? 'font-semibold text-white' : 'font-medium text-white/85'}`}>{playerName(r)}</span>
                            {r.pass && <span className="ds-passtag rounded px-1 font-mono text-[9px] font-black tracking-[0.15em]" style={{ ['--ds-shine-delay' as string]: shineDelay(r.rank) }}>PASS</span>}
                        </span>
                        {/* On a phone the hero, the wave and the clan sit under the name. */}
                        <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-white/40 md:hidden">
                            {[heroName, `wave ${r.wave}`, runTime(r.timeMs), r.clan].filter(Boolean).join(' · ')}
                        </span>
                    </span>
                </span>
                <span className="hidden truncate text-sm text-white/60 md:block">{heroName ?? '—'}</span>
                <span className="hidden truncate text-sm text-white/45 md:block">{r.clan ?? '—'}</span>
                <span className="hidden text-right font-mono text-sm tabular-nums text-white/45 md:block">{r.wave}</span>
                <span className="hidden text-right font-mono text-sm tabular-nums text-white/45 md:block">{runTime(r.timeMs) ?? '—'}</span>
                <span className={`text-right font-mono tabular-nums ${r.rank === 1 ? 'text-base font-bold' : top ? 'text-sm font-semibold' : 'text-sm text-white/75'}`} style={top ? { color: PLACE_COLOR[r.rank - 1] } : undefined}>{int(r.score)}</span>
        </div>
    )
}

/**
 * The whole board in a window: closes on Esc, the cross or a click outside; Tab stays inside;
 * the page under it does not scroll; focus goes back to «Show all» after.
 */
function BoardModal({ rows, title, onClose }: { rows: BoardRow[]; title: string; onClose: () => void }) {
    const box = useRef<HTMLDivElement>(null)
    const close = useRef<HTMLButtonElement>(null)
    // The latest onClose without re-running the effect (the page re-renders every minute).
    const onCloseRef = useRef(onClose)
    useEffect(() => { onCloseRef.current = onClose }, [onClose])

    useEffect(() => {
        // Focus goes back to whichever «Show all» opened it.
        const opener = document.activeElement as HTMLElement | null
        close.current?.focus()
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return }
            if (e.key !== 'Tab' || !box.current) return
            const f = Array.from(box.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled'))
            if (f.length === 0) return
            const first = f[0], last = f[f.length - 1]
            const active = document.activeElement
            if (e.shiftKey && (active === first || !box.current.contains(active))) { e.preventDefault(); last.focus() }
            else if (!e.shiftKey && (active === last || !box.current.contains(active))) { e.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; opener?.focus?.() }
    }, [])

    // Into <body>: inside the page's z-10 layer the site header (z-50) would sit over it.
    return createPortal(
        <div className="fixed inset-0 z-[400] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
            <div
                ref={box}
                role="dialog"
                aria-modal="true"
                aria-labelledby="board-modal-title"
                className="flex max-h-[88svh] w-full max-w-[920px] flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0b0b0d] shadow-[0_40px_120px_rgba(0,0,0,0.6)] sm:rounded-3xl"
            >
                <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-6">
                    <div>
                        <div className={`${LABEL_CLASS} text-white/40`}>{rows.length} players</div>
                        <h3 id="board-modal-title" className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">{title}</h3>
                    </div>
                    <button ref={close} onClick={onClose} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-white transition-colors hover:bg-white hover:text-black">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <BoardHead />
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" tabIndex={0} aria-label="All players">
                    {rows.map((r) => <BoardLine key={r.rank} r={r} />)}
                </div>
            </div>
        </div>,
        document.body,
    )
}
