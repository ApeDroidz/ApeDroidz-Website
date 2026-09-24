'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Ban, Check, Clock, Loader2, Plus, RefreshCcw, ShieldCheck, Trash2, Users } from 'lucide-react'
import { ACCESS_DURATIONS, DEFAULT_ACCESS_DURATION } from '@/lib/survivalDurations'
import { CopyWallet, SurvivalPlayers } from './survival-players'

/**
 * Droidz Survival — the game's own tab in the panel (the owner, 18.09.2026): what is
 * happening (players, runs, the season board), what broke (the journal's warnings and
 * errors), what looks wrong (rejected runs with their reason), who was caught (wallets
 * with rejected runs, with a ban switch), the beta list (add / revoke), and the clans
 * (add from an OpenSea slug / remove). Everything is read from /api/admin/survival and
 * written through its actions; nothing here is computed on the client.
 */

type Payload = {
    generatedAt: string
    season: { id: string; name: string; status: string; starts_at: string; ends_at: string } | null
    stats: {
        online: number; playing: number; players: number; players24: number; banned: number; runsAll: number; runs24: number; runs7: number; finished: number; rejected: number; voided: number; started: number
        rejectRate: number; cheatWallets: number; avgScore: number; avgWave: number; avgKills: number
        playtimeMs: number; longestRunMs: number; avgRunMs: number
        payments: { count: number; ape: number; confirmed: number; confirmedApe: number }
    }
    board: Array<{ rank: number; wallet_short: string; display_name: string | null; score: number; wave: number; kills: number; runs_count: number; achieved_at: string }>
    events: Array<{ id: number; at: string; wallet: string | null; source: string; level: string; kind: string; message: string; data: Record<string, unknown>; run_id: string | null; client_version: string | null }>
    suspicious: Array<{ id: string; wallet: string; status: string; reject_reason: string | null; flags: string[]; score: number; wave: number; kills: number; started_at: string; server_duration_ms: number | null; client_duration_ms: number | null; client_version: string | null; hero: string | null }>
    cheaters: Array<{ wallet: string; rejected: number; last: string; reasons: string[]; banned: boolean; ban_reason: string | null }>
    allowlist: Array<{ wallet: string; status: 'active' | 'expired' | 'revoked'; note: string | null; added_by: string | null; added_at: string; revoked_at: string | null; expires_at: string | null }>
    recentRuns: Array<{ id: string; wallet: string; status: string; reject_reason: string | null; score: number; wave: number; kills: number; started_at: string; hero: string | null; client_version: string | null; server_duration_ms: number | null; client_duration_ms: number | null }>
    profiles: Array<{ wallet: string; coins: number; runs: number; best_score: number; selected_hero: string | null; updated_at: string }>
    feedback: Array<{ wallet: string; rating: number; comment: string | null; runs_at_submit: number; coins_awarded: number; client_version: string | null; created_at: string; updated_at: string; edited_count: number }>
    feedbackStats: { count: number; avgRating: number; histogram: number[]; withComment: number; coinsPaid: number }
    problems: string[]
}
type Clan = { slug: string; name: string; opensea_slug: string | null; chain: string | null; contract: string | null; image_url: string | null; active: boolean }

const short = (w: string | null | undefined) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : '—')

/**
 * Кошелёк с именем из беты-листа: «0x46…4c1f (Sasha)».
 *
 * Имя — это `note`, которое владелец пишет при выдаче доступа. Сверять хвосты
 * адресов между таблицами руками невозможно, поэтому подпись идёт рядом с
 * КАЖДЫМ адресом в панели, а не только в самом списке доступа. Ключей в карте
 * два — полный адрес и его короткая форма — потому что доска почёта приходит с
 * сервера уже обрезанной (survival_board.wallet_short) и полного адреса там нет.
 */
function buildNames(rows: Array<{ wallet: string; note: string | null }>): Map<string, string> {
    const m = new Map<string, string>()
    for (const r of rows) {
        const n = (r.note ?? '').trim()
        if (!n) continue
        m.set(r.wallet.toLowerCase(), n)
        m.set(short(r.wallet.toLowerCase()), n)
    }
    return m
}
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—')
const ape = (n: number) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })} APE`
const secs = (ms: number | null | undefined) => (ms == null ? '—' : `${Math.round(ms / 1000)}s`)
/** Длительность по-человечески: 42s · 7m 30s · 4h 20m. */
const dur = (ms: number | null | undefined) => {
    if (!ms) return '—'
    const t = Math.round(ms / 1000)
    if (t < 60) return `${t}s`
    if (t < 3600) return `${Math.floor(t / 60)}m ${t % 60}s`
    return `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`
}
const stars = (n: number) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - n))

/** Адрес + имя из беты-листа. `full={false}` — когда адрес уже обрезан сервером. */
function W({ w, names, full = true, className = '' }: { w: string | null | undefined; names: Map<string, string>; full?: boolean; className?: string }) {
    const key = (w ?? '').toLowerCase()
    const name = names.get(key) ?? null
    return (
        <span className={className} title={w ?? undefined}>
            <span className="font-mono">{full ? short(w) : (w ?? '—')}</span>
            {name ? <span className="text-white/40"> ({name})</span> : null}
        </span>
    )
}

async function api(url: string, init?: RequestInit) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...init })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
    return data
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
    return (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-[9px] font-black uppercase tracking-widest text-white/35">{label}</div>
            <div className={`mt-1 text-xl font-black ${accent || 'text-white'}`}>{value}</div>
        </div>
    )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3 mb-3">
                <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40">{title}</h3>
                {hint && <span className="text-[10px] text-white/30 font-mono">{hint}</span>}
            </div>
            {children}
        </div>
    )
}

const LEVEL: Record<string, string> = { error: 'text-red-400', warn: 'text-orange-400', info: 'text-white/60', debug: 'text-white/30' }
const LEVEL_FILTERS: Array<{ id: 'all' | 'problems' | 'errors'; label: string; keep: (level: string) => boolean }> = [
    { id: 'all', label: 'All', keep: () => true },
    { id: 'problems', label: 'Warn + error', keep: (l) => l === 'warn' || l === 'error' },
    { id: 'errors', label: 'Errors', keep: (l) => l === 'error' },
]

/** Two views: the game at a glance, and every player in full (owner, 24.09.2026). */
export function SurvivalTab() {
    const [view, setView] = useState<'overview' | 'players'>('overview')
    return (
        <div className="space-y-5">
            <div className="flex gap-1">
                {(['overview', 'players'] as const).map((v) => (
                    <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${view === v ? 'bg-[#3b82f6] text-white' : 'text-white/40 hover:text-white bg-white/5'}`}>{v}</button>
                ))}
            </div>
            {view === 'overview' ? <SurvivalOverview /> : <SurvivalPlayers />}
        </div>
    )
}

function SurvivalOverview() {
    const [data, setData] = useState<Payload | null>(null)
    const [clans, setClans] = useState<Clan[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState<string | null>(null)
    const [wallet, setWallet] = useState('')
    const [note, setNote] = useState('')
    const [duration, setDuration] = useState(DEFAULT_ACCESS_DURATION)
    const [clanSlug, setClanSlug] = useState('')
    const [clanName, setClanName] = useState('')
    const [clanChain, setClanChain] = useState('ape_chain')
    const [openEvent, setOpenEvent] = useState<number | null>(null)
    const [levelFilter, setLevelFilter] = useState<'all' | 'problems' | 'errors'>('all')
    const [accessQ, setAccessQ] = useState('')
    // Сколько ApeDroidz на каждом кошельке беты. Грузится фоном отдельным
    // запросом (десятки вызовов к индексеру), поэтому список появляется сразу,
    // а значки холдеров догоняют. null у адреса — индексер не ответил.
    const [holders, setHolders] = useState<Record<string, number | null>>({})

    // Имена из беты-листа — подпись рядом с каждым кошельком в панели.
    const names = useMemo(() => buildNames(data?.allowlist ?? []), [data?.allowlist])

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const [d, c] = await Promise.all([api('/api/admin/survival'), api('/api/admin/survival/clans')])
            setData(d); setClans(c.clans ?? [])
            void api('/api/admin/survival/holders')
                .then((h) => setHolders(h.counts ?? {}))
                .catch(() => { /* значки холдеров — приятное дополнение, без них панель работает */ })
        } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
    }, [])
    useEffect(() => { void load() }, [load])

    const act = async (key: string, fn: () => Promise<unknown>) => {
        setBusy(key)
        try { await fn(); await load() } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
    }

    if (loading && !data) return <div className="flex items-center gap-2 text-white/40 text-sm py-10"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
    if (!data) return <div className="text-red-400 text-sm py-10">{error ?? 'No data'}</div>
    const s = data.stats
    // Панель может смотреть на пейлоад, снятый до миграции отзывов — тогда блок просто пуст.
    const fs = data.feedbackStats ?? { count: 0, avgRating: 0, histogram: [0, 0, 0, 0, 0], withComment: 0, coinsPaid: 0 }
    const reviews = data.feedback ?? []
    const keep = LEVEL_FILTERS.find((f) => f.id === levelFilter)?.keep ?? (() => true)
    const events = data.events.filter((e) => keep(e.level))

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-mono text-white/30">
                    season <span className="text-white/60">{data.season ? `${data.season.name} (${data.season.id}, ${data.season.status})` : 'none live'}</span> · generated {when(data.generatedAt)}
                </div>
                <button onClick={() => void load()} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white"><RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
            </div>
            {error && <div className="text-red-400 text-xs font-mono">{error}</div>}
            {data.problems?.length > 0 && <div className="text-orange-400 text-xs font-mono">Some queries failed: {data.problems.join(' · ')}</div>}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Stat label="Online now (in a run)" value={`${s.online} (${s.playing})`} accent="text-emerald-400" />
                <Stat label="Players (banned)" value={`${s.players} (${s.banned})`} />
                <Stat label="Active 24h" value={s.players24} accent="text-[#3b82f6]" />
                <Stat label="Runs (24h / 7d / all)" value={`${s.runs24} / ${s.runs7} / ${s.runsAll}`} />
                <Stat label="Accepted" value={s.finished} accent="text-emerald-400" />
                <Stat label="Rejected (wallets)" value={`${s.rejected} (${(s.rejectRate * 100).toFixed(1)}%) · ${s.cheatWallets}`} accent={s.rejected ? 'text-red-400' : 'text-white'} />
                <Stat label="Void / open" value={`${s.voided} / ${s.started}`} />
                <Stat label="Avg wave · score · kills" value={s.finished ? `${s.avgWave} · ${s.avgScore} · ${s.avgKills}` : '—'} />
                <Stat label="Playtime (all runs)" value={dur(s.playtimeMs)} accent="text-[#3b82f6]" />
                <Stat label="Run: average · longest" value={`${dur(s.avgRunMs)} · ${dur(s.longestRunMs)}`} />
                <Stat label="Payments (confirmed)" value={`${s.payments.count} (${s.payments.confirmed})`} />
                <Stat label="Paid in (confirmed)" value={`${ape(s.payments.ape)} (${ape(s.payments.confirmedApe)})`} accent="text-[#3b82f6]" />
                <Stat label="Beta rating (reviews)" value={fs.count ? `${fs.avgRating} ★ (${fs.count})` : '—'} accent={fs.count ? 'text-[#ffcf4a]' : 'text-white'} />
            </div>

            <div className="grid gap-5">
                <Section title="Season board" hint={`top ${data.board.length}`}>
                    {data.board.length === 0 ? <div className="text-white/30 text-xs">No accepted runs yet.</div> : (
                        <table className="w-full text-xs">
                            <thead><tr className="text-white/30 text-[9px] uppercase tracking-widest"><th className="text-left py-1">#</th><th className="text-left">Player</th><th className="text-right">Score</th><th className="text-right">Wave</th><th className="text-right">Kills</th><th className="text-right">Runs</th></tr></thead>
                            <tbody>{data.board.map((b) => (
                                <tr key={b.rank} className="border-t border-white/5"><td className="py-1 text-white/50">{b.rank}</td><td><W w={b.wallet_short} names={names} full={false} />{b.display_name ? <span className="text-white/40"> · {b.display_name}</span> : null}</td><td className="text-right font-black">{b.score}</td><td className="text-right text-white/60">{b.wave}</td><td className="text-right text-white/60">{b.kills}</td><td className="text-right text-white/40">{b.runs_count}</td></tr>
                            ))}</tbody>
                        </table>
                    )}
                </Section>

                <Section title="Beta access" hint={`${data.allowlist.filter((a) => a.status === 'active').length} active · ${data.allowlist.filter((a) => a.status === 'expired').length} expired · ${data.allowlist.length} total${Object.keys(holders).length ? ` · ${Object.values(holders).filter((n) => (n ?? 0) > 0).length} hold droidz` : ''}`}>
                    {/* Timed access (owner, 19.09): the duration picked here is what Add and
                        Activate grant. An expired wallet stays on the list, grey, until it is
                        activated again — the gate itself closes on the minute (the play cookie
                        is capped at expires_at). */}
                    <form className="flex flex-col sm:flex-row gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); if (!wallet) return; void act('allow', () => api('/api/admin/survival/allowlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'add', wallet, note, duration }) })).then(() => { setWallet(''); setNote('') }) }}>
                        <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x… wallet" className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-[#3b82f6]" />
                        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (who / where from)" className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-[#3b82f6]" />
                        <select value={duration} onChange={(e) => setDuration(e.target.value)} title="How long the access lasts" className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-[#3b82f6]">
                            {ACCESS_DURATIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                        </select>
                        <button type="submit" disabled={busy === 'allow'} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#3b82f6] text-[10px] font-black uppercase tracking-widest disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Add</button>
                    </form>
                    {/* Full width, full addresses (owner, 24.09: «кошельки обрезаются — не на всё окно»):
                        the list used to sit in half the page, 256px tall, with shortened wallets. */}
                    <input value={accessQ} onChange={(e) => setAccessQ(e.target.value)} placeholder="filter by wallet or note…" className="w-full mb-2 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#3b82f6]" />
                    <div className="max-h-[70vh] overflow-auto divide-y divide-white/5">
                        {data.allowlist.length === 0 && <div className="text-white/30 text-xs">The list is empty.</div>}
                        {data.allowlist.filter((a) => { const n = accessQ.trim().toLowerCase(); return !n || a.wallet.toLowerCase().includes(n) || (a.note ?? '').toLowerCase().includes(n) }).map((a) => (
                            <div key={a.wallet} className={`flex items-center gap-3 py-1.5 text-xs ${a.status === 'active' ? '' : 'opacity-60'}`}>
                                {a.status === 'active' ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                                    : a.status === 'expired' ? <Clock className="h-3.5 w-3.5 text-amber-400/70 flex-shrink-0" />
                                    : <Ban className="h-3.5 w-3.5 text-white/25 flex-shrink-0" />}
                                <CopyWallet wallet={a.wallet} className={`flex-shrink-0 ${a.status === 'active' ? '' : a.status === 'expired' ? 'text-white/40' : 'text-white/30 line-through'}`} />
                                {(() => {
                                    const n = holders[a.wallet.toLowerCase()]
                                    if (n === undefined) return <span className="w-16 flex-shrink-0 text-[9px] uppercase tracking-widest text-white/15">·</span>
                                    if (n === null) return <span className="w-16 flex-shrink-0 text-[9px] uppercase tracking-widest text-white/25" title="Indexer did not answer for this wallet">?</span>
                                    return n > 0
                                        ? <span className="w-16 flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-emerald-400" title={`${n} ApeDroidz on this wallet`}>{n}{n >= 100 ? '+' : ''} droidz</span>
                                        : <span className="w-16 flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-white/30" title="No ApeDroidz on this wallet">no droidz</span>
                                })()}
                                <span className="text-white/40 flex-1 truncate">{a.note ?? ''}{a.added_by ? <span className="text-white/25"> · {a.added_by}</span> : null}</span>
                                <span className={`font-mono text-[10px] ${a.status === 'expired' ? 'text-amber-400/70' : 'text-white/25'}`}
                                    title={a.revoked_at ? `revoked ${when(a.revoked_at)}` : a.expires_at ? `${a.status === 'expired' ? 'expired' : 'until'} ${when(a.expires_at)} · added ${when(a.added_at)}` : `added ${when(a.added_at)} · no expiry`}>
                                    {a.revoked_at ? `revoked ${day(a.revoked_at)}` : a.expires_at ? `${a.status === 'expired' ? 'expired' : 'until'} ${when(a.expires_at)}` : 'forever'}
                                </span>
                                {/* Срок можно переписать, не снимая и не выдавая доступ заново
                                    (владелец, 20.09): выбор в этом списке сразу применяется к
                                    кошельку — тем же действием, что и выдача, поэтому заметка
                                    и дата выдачи остаются на месте. */}
                                <select
                                    value=""
                                    title="Change how long this wallet's access lasts"
                                    onChange={(e) => {
                                        const d = e.target.value
                                        if (!d) return
                                        e.target.value = ''
                                        void act(a.wallet, () => api('/api/admin/survival/allowlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'add', wallet: a.wallet, note: a.note, duration: d }) }))
                                    }}
                                    className="bg-black/40 border border-white/10 rounded-md px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-white/40 outline-none hover:text-white hover:border-white/25 cursor-pointer"
                                >
                                    <option value="">Set term…</option>
                                    {ACCESS_DURATIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                                </select>
                                {a.status === 'active'
                                    ? <button onClick={() => void act(a.wallet, () => api('/api/admin/survival/allowlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'revoke', wallet: a.wallet }) }))} className="text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-red-400">Revoke</button>
                                    : <button title={`Activate for ${ACCESS_DURATIONS.find((d) => d.key === duration)?.label ?? duration} (the picker above)`} onClick={() => void act(a.wallet, () => api('/api/admin/survival/allowlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'add', wallet: a.wallet, note: a.note, duration }) }))} className="text-[9px] font-black uppercase tracking-widest text-emerald-400/70 hover:text-emerald-300">Activate</button>}
                            </div>
                        ))}
                    </div>
                </Section>
            </div>

            <div className="grid lg:grid-cols-2 gap-5">
                <Section title="Caught cheating" hint="wallets with a rejected run">
                    {data.cheaters.length === 0 ? <div className="text-white/30 text-xs">Nobody, so far.</div> : (
                        <div className="divide-y divide-white/5">{data.cheaters.map((c) => (
                            <div key={c.wallet} className="flex items-center gap-3 py-2 text-xs">
                                <AlertTriangle className={`h-3.5 w-3.5 flex-shrink-0 ${c.banned ? 'text-red-400' : 'text-orange-400'}`} />
                                <W w={c.wallet} names={names} />
                                <span className="text-white/50">{c.rejected}× · {c.reasons.join(', ')}</span>
                                <span className="text-white/25 font-mono text-[10px] flex-1 text-right">{when(c.last)}</span>
                                <button onClick={() => void act(c.wallet, () => api('/api/admin/survival/ban', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: c.wallet, banned: !c.banned, reason: c.banned ? null : c.reasons.join(',') }) }))} className={`text-[9px] font-black uppercase tracking-widest ${c.banned ? 'text-red-400 hover:text-white' : 'text-white/40 hover:text-red-400'}`}>{c.banned ? 'Banned — unban' : 'Ban'}</button>
                            </div>
                        ))}</div>
                    )}
                </Section>

                <Section title="Clans" hint="name, slug and PFP resolved from the contract via OpenSea">
                    <form className="flex flex-col sm:flex-row gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); const v = clanSlug.trim(); if (!v) return; const isContract = /^0x[0-9a-fA-F]{40}$/.test(v); void act('clan', () => api('/api/admin/survival/clans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(isContract ? { action: 'add', contract: v, chain: clanChain, name: clanName } : { action: 'add', openseaSlug: v, name: clanName }) })).then(() => { setClanSlug(''); setClanName('') }) }}>
                        <input value={clanSlug} onChange={(e) => setClanSlug(e.target.value)} placeholder="0x… collection contract (or an OpenSea slug)" className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-[#3b82f6]" />
                        <select value={clanChain} onChange={(e) => setClanChain(e.target.value)} className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-[#3b82f6] text-white/80" title="Chain of the contract">
                            <option value="ape_chain">ApeChain (33139)</option>
                            <option value="ethereum">Ethereum (1)</option>
                        </select>
                        <input value={clanName} onChange={(e) => setClanName(e.target.value)} placeholder="name (optional, from OpenSea otherwise)" className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-[#3b82f6]" />
                        <button type="submit" disabled={busy === 'clan'} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#3b82f6] text-[10px] font-black uppercase tracking-widest disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Add</button>
                    </form>
                    <div className="max-h-72 overflow-auto divide-y divide-white/5">{clans.map((c) => (
                        <div key={c.slug} className={`flex items-center gap-3 py-1.5 text-xs ${c.active ? '' : 'opacity-40'}`}>
                            {c.image_url ? <img src={`/api/survival/clans/pfp/${c.slug}`} alt="" className="h-7 w-7 rounded-md object-cover bg-white/5" /> : <div className="h-7 w-7 rounded-md bg-white/5 flex items-center justify-center text-white/30"><Users className="h-3.5 w-3.5" /></div>}
                            <span className="font-bold">{c.name}</span>
                            <span className="text-white/30 font-mono text-[10px] truncate flex-1">{c.opensea_slug} · {c.chain ?? '—'} {c.contract ? short(c.contract) : ''}</span>
                            <button onClick={() => void act(c.slug, () => api('/api/admin/survival/clans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'refresh', slug: c.slug }) }))} className="text-white/40 hover:text-white" title="Re-read OpenSea"><RefreshCcw className="h-3.5 w-3.5" /></button>
                            {c.active
                                ? <button onClick={() => void act(c.slug, () => api('/api/admin/survival/clans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove', slug: c.slug }) }))} className="text-white/40 hover:text-orange-400" title="Hide from the picker (keeps the row)"><Ban className="h-3.5 w-3.5" /></button>
                                : <button onClick={() => void act(c.slug, () => api('/api/admin/survival/clans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'restore', slug: c.slug }) }))} className="text-white/40 hover:text-emerald-400" title="Show in the picker again"><Check className="h-3.5 w-3.5" /></button>}
                            <button onClick={() => { if (!window.confirm(`Delete clan "${c.name}" for good?`)) return; setClans((prev) => prev.filter((x) => x.slug !== c.slug)); void act(c.slug, () => api('/api/admin/survival/clans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete', slug: c.slug }) })) }} className="text-white/40 hover:text-red-400" title="Delete — the row is removed"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                    ))}</div>
                </Section>
            </div>

            <Section title="Suspicious — rejected runs" hint={`${data.suspicious.length} shown`}>
                {data.suspicious.length === 0 ? <div className="text-white/30 text-xs">Nothing rejected.</div> : (
                    <div className="overflow-auto max-h-80">
                        <table className="w-full text-xs">
                            <thead><tr className="text-white/30 text-[9px] uppercase tracking-widest"><th className="text-left py-1">When</th><th className="text-left">Wallet</th><th className="text-left">Reason</th><th className="text-right">Score</th><th className="text-right">Wave</th><th className="text-right">Kills</th><th className="text-right">Server</th><th className="text-right">Client</th><th className="text-left">Build</th></tr></thead>
                            <tbody>{data.suspicious.map((r) => (
                                <tr key={r.id} className="border-t border-white/5"><td className="py-1 font-mono text-white/40">{when(r.started_at)}</td><td><W w={r.wallet} names={names} /></td><td className="text-orange-400">{r.reject_reason}</td><td className="text-right">{r.score}</td><td className="text-right">{r.wave}</td><td className="text-right">{r.kills}</td><td className="text-right text-white/50">{secs(r.server_duration_ms)}</td><td className="text-right text-white/50">{secs(r.client_duration_ms)}</td><td className="font-mono text-white/30">{r.client_version}</td></tr>
                            ))}</tbody>
                        </table>
                    </div>
                )}
            </Section>

            <Section title="Journal" hint={`client + server, newest first · ${events.length} of ${data.events.length}`}>
                <div className="flex items-center gap-1 mb-3">
                    {LEVEL_FILTERS.map((f) => (
                        <button key={f.id} onClick={() => setLevelFilter(f.id)} className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest border ${levelFilter === f.id ? 'border-[#3b82f6] text-white bg-[#3b82f6]/20' : 'border-white/10 text-white/40 hover:text-white'}`}>{f.label}</button>
                    ))}
                </div>
                {events.length === 0 ? <div className="text-white/30 text-xs">Quiet.</div> : (
                    <div className="overflow-auto max-h-96 divide-y divide-white/5">{events.map((e) => (
                        <div key={e.id} className="py-1.5 text-xs">
                            <button onClick={() => setOpenEvent(openEvent === e.id ? null : e.id)} className="w-full text-left flex items-center gap-3">
                                <span className="font-mono text-white/30 w-36 flex-shrink-0">{when(e.at)}</span>
                                <span className={`font-black uppercase text-[9px] w-10 ${LEVEL[e.level] ?? ''}`}>{e.level}</span>
                                <span className="text-white/30 w-4">{e.source === 'client' ? 'C' : 'S'}</span>
                                <W w={e.wallet} names={names} className="w-24 flex-shrink-0 truncate" />
                                <span className="text-white/60 w-32 flex-shrink-0 truncate">{e.kind}</span>
                                <span className="truncate flex-1">{e.message}</span>
                            </button>
                            {openEvent === e.id && <pre className="mt-2 text-[10px] font-mono text-white/50 bg-black/40 rounded-lg p-3 overflow-auto max-h-64">{JSON.stringify({ run: e.run_id, build: e.client_version, ...e.data }, null, 2)}</pre>}
                        </div>
                    ))}</div>
                )}
            </Section>

            {/* Отзывы о бете (владелец, 20.09): звёзды + необязательный комментарий, за них
                платим Ape Mini. Отдельным блоком, потому что это единственное на вкладке,
                что читают глазами, а не сверяют числами. */}
            <Section
                title="Beta feedback"
                hint={fs.count ? `${fs.count} reviews · ${fs.avgRating} ★ avg · ${fs.withComment} with a comment · ${fs.coinsPaid.toLocaleString()} mini paid` : 'nothing yet'}
            >
                {fs.count === 0 ? (
                    <div className="text-white/30 text-xs">No reviews yet — the form opens after 3 finished runs.</div>
                ) : (
                    <>
                        {/* Разбивка по звёздам: одна оценка 1★ среди тридцати 5★ — это не то же самое,
                            что среднее 4.8, и среднее её прячет. */}
                        <div className="mb-4 space-y-1">
                            {[5, 4, 3, 2, 1].map((n) => {
                                const c = fs.histogram[n - 1] ?? 0
                                return (
                                    <div key={n} className="flex items-center gap-2 text-[10px]">
                                        <span className="w-10 font-mono text-[#ffcf4a]">{n} ★</span>
                                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                                            <div className="h-full rounded-full bg-[#ffcf4a]/70" style={{ width: `${fs.count ? (c / fs.count) * 100 : 0}%` }} />
                                        </div>
                                        <span className="w-8 text-right font-mono text-white/40">{c}</span>
                                    </div>
                                )
                            })}
                        </div>
                        <div className="max-h-[28rem] divide-y divide-white/5 overflow-auto">
                            {reviews.map((f) => (
                                <div key={f.wallet} className="py-2">
                                    <div className="flex items-baseline gap-3 text-xs">
                                        <W w={f.wallet} names={names} className="w-24 flex-shrink-0 truncate" />
                                        <span className="w-24 flex-shrink-0 font-black text-[#ffcf4a]">{stars(f.rating)}</span>
                                        <span className="w-20 flex-shrink-0 font-black text-[#3b82f6]">+{f.coins_awarded} mini</span>
                                        <span className="flex-1 text-right font-mono text-[10px] text-white/25">
                                            {f.runs_at_submit} runs at submit{f.edited_count > 0 ? ` · edited ${f.edited_count}×` : ''}
                                            {f.client_version ? ` · ${f.client_version}` : ''} · {when(f.updated_at)}
                                        </span>
                                    </div>
                                    {f.comment ? (
                                        <p className="mt-1 whitespace-pre-wrap break-words pl-24 text-xs leading-relaxed text-white/70">{f.comment}</p>
                                    ) : (
                                        <p className="mt-1 pl-24 text-xs italic text-white/20">stars only</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </Section>

            <div className="grid lg:grid-cols-2 gap-5">
                <Section title="Recent runs" hint="newest first">
                    <div className="overflow-auto max-h-80 divide-y divide-white/5">{data.recentRuns.map((r) => (
                        <div key={r.id} className="flex items-center gap-3 py-1 text-xs">
                            <span className="font-mono text-white/30 w-36 flex-shrink-0">{when(r.started_at)}</span>
                            <W w={r.wallet} names={names} className="w-24 truncate" />
                            <span className={`w-16 font-black uppercase text-[9px] ${r.status === 'finished' ? 'text-emerald-400' : r.status === 'rejected' ? 'text-red-400' : 'text-white/40'}`}>{r.status}</span>
                            <span className="text-white/60 flex-1 truncate">{r.hero ?? ''} · score {r.score} · wave {r.wave} · {r.kills} kills · {dur(r.server_duration_ms ?? r.client_duration_ms)} {r.reject_reason ? `· ${r.reject_reason}` : ''}</span>
                        </div>
                    ))}</div>
                </Section>
                <Section title="Player progress" hint="server-side profiles, newest first">
                    <div className="overflow-auto max-h-80 divide-y divide-white/5">{data.profiles.map((p) => (
                        <div key={p.wallet} className="flex items-center gap-3 py-1 text-xs">
                            <W w={p.wallet} names={names} className="w-24 truncate" />
                            <span className="text-[#3b82f6] font-black w-24">{p.coins} mini</span>
                            <span className="text-white/60">{p.runs} runs · best {p.best_score} · {p.selected_hero ?? '—'}</span>
                            <span className="font-mono text-white/25 text-[10px] flex-1 text-right">{when(p.updated_at)}</span>
                        </div>
                    ))}{data.profiles.length === 0 && <div className="text-white/30 text-xs">No profiles yet.</div>}</div>
                </Section>
            </div>
        </div>
    )
}
