'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, Copy, Loader2, RefreshCcw, Search } from 'lucide-react'
import CATALOG from '@/lib/survivalGameCatalog.json'

/**
 * Droidz Survival → Players (the owner, 24.09.2026): every player in one table, and a full
 * report per player — stats, resources, trees, bag, weapons, season, runs, journal, payments.
 *
 * DRIFT is the column to watch: runs that reached Game Over on the server minus runs the save counts.
 * Anything above zero means the save was rolled back at some point (the stale-profile bug
 * fixed 24.09) — that many runs of progress were lost, which is what a refund is sized from.
 */

type Row = {
    wallet: string; name: string | null; x: string | null; clan: string | null; banned: boolean
    firstSeen: string; lastSeen: string; access: 'none' | 'active' | 'expired' | 'revoked'
    coins: number; heroes: string[]; selectedHero: string | null
    resources: { scrap: number; circuit: number; cell: number; core: number }
    treeLevels: number; items: number; saveRuns: number; serverRuns: number; drift: number
    finished: number; rejected: number; best: number; playMs: number; lastRun: string | null
    paidCount: number; paidApe: number; clientVersion: string | null; savedAt: string | null
}

type Detail = {
    wallet: string
    player: Record<string, unknown> | null
    profile: { state: Record<string, any>; coins: number; runs: number; best_score: number; selected_hero: string | null; client_version: string | null; created_at: string; updated_at: string } | null
    seasons: Array<{ season_id: string; season: Record<string, any>; daily: Record<string, any>; sxp: number; tier: number; updated_at: string }> | null
    runs: Array<{ id: string; season_id: string; status: string; reject_reason: string | null; flags: unknown; score: number | null; wave: number | null; kills: number | null; hero: string | null; weapon: string | null; started_at: string; finished_at: string | null; server_duration_ms: number | null; client_duration_ms: number | null; client_version: string | null }> | null
    events: Array<{ id: number; at: string; level: string; kind: string; message: string; data: Record<string, unknown>; client_version: string | null }> | null
    payments: Array<{ tx_hash: string; amount_ape: number; confirmed_at: string | null; credits_granted: number | null; created_at: string }> | null
    feedback: { rating: number; comment: string | null; runs_at_submit: number; coins_awarded: number; created_at: string; updated_at: string; edited_count: number } | null
    access: { note: string | null; added_by: string | null; added_at: string; revoked_at: string | null; expires_at: string | null } | null
    x: string | null
    stats: { serverRuns: number; ended: number; finished: number; rejected: number; voided: number; best: number; playMs: number; saveRuns: number; drift: number }
    problems: string[]
}

type SortKey = 'lastSeen' | 'best' | 'serverRuns' | 'coins' | 'drift' | 'playMs' | 'treeLevels'
const SORTS: Array<{ key: SortKey; label: string }> = [
    { key: 'lastSeen', label: 'Last seen' },
    { key: 'best', label: 'Best score' },
    { key: 'serverRuns', label: 'Runs' },
    { key: 'playMs', label: 'Playtime' },
    { key: 'coins', label: 'Ape Mini' },
    { key: 'treeLevels', label: 'Tree levels' },
    { key: 'drift', label: 'Drift (lost runs)' },
]

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')
const num = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString())
const dur = (ms: number | null | undefined) => {
    if (!ms) return '—'
    const t = Math.round(ms / 1000)
    if (t < 60) return `${t}s`
    if (t < 3600) return `${Math.floor(t / 60)}m ${t % 60}s`
    return `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`
}
/**
 * The game's own names and pictures (owner, 24.09: «я с игры ничего не знаю по названиям,
 * только визуально»). survivalGameCatalog.json is exported from the game configs by
 * `npx tsx tools/export-panel-catalog.ts` in the game repo — rerun it when heroes, trees,
 * items or enemies change.
 */
type Pic = { name: string; file: string | null; box?: number[]; desc?: string; max?: number; branch?: string }
const CAT = CATALOG as unknown as { base: string } & Record<'heroes' | 'weapons' | 'enemies' | 'items' | 'resources' | 'nodes', Record<string, Pic>>
const pretty = (id: string) => id.replace(/_/g, ' ')
/** 'volt_core_hp' under hero 'volt' → 'CHASSIS' (the id without its hero prefix when the catalog lacks it). */
const nodeName = (hero: string, id: string) => {
    const known = CAT.nodes[id]?.name
    if (known) return known
    const p = { goblin: 'gob' }[hero] ?? hero
    return pretty(id.startsWith(`${p}_`) ? id.slice(p.length + 1) : id)
}

/**
 * One picture from the game at a fixed size. Animation frames are 324×164 with the figure
 * somewhere inside, so they are cropped to the figure's box (box = x0, y0, x1, y1, w, h);
 * icons are drawn whole. Pixel art stays sharp.
 */
function GamePic({ pic, size = 28, title }: { pic?: Pic; size?: number; title?: string }) {
    if (!pic?.file) return <span style={{ width: size, height: size }} className="inline-block flex-shrink-0 rounded bg-white/5" title={title} />
    const url = CAT.base + pic.file
    const b = pic.box
    if (!b) return <img src={url} alt="" width={size} height={size} title={title} className="flex-shrink-0" style={{ imageRendering: 'pixelated' }} />
    const [x0, y0, x1, y1, w, h] = b
    const k = Math.min((size - 4) / (x1 - x0), (size - 4) / (y1 - y0))
    return (
        // The droids and the enemies are near-black silhouettes by design: they sit on a light tile, like the game's fog.
        <span title={title} className="inline-block flex-shrink-0 rounded-[4px]" style={{
            width: size, height: size, imageRendering: 'pixelated', backgroundColor: '#96a0b4', backgroundImage: `url(${url})`, backgroundRepeat: 'no-repeat',
            backgroundSize: `${w * k}px ${h * k}px`,
            backgroundPosition: `${-x0 * k + (size - (x1 - x0) * k) / 2}px ${-y0 * k + (size - (y1 - y0) * k) / 2}px`,
        }} />
    )
}

/** A picture with its name — the chip every list in the report uses. */
function Chip({ pic, label, extra, title, className = '' }: { pic?: Pic; label: string; extra?: React.ReactNode; title?: string; className?: string }) {
    return (
        <span title={title} className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[10px] ${className || 'bg-white/5 border-white/10'}`}>
            <GamePic pic={pic} size={22} />
            <span className="font-black uppercase tracking-wide">{label}</span>
            {extra}
        </span>
    )
}

function Resources({ res }: { res: Record<string, number | undefined> }) {
    return (
        <span className="inline-flex flex-wrap items-center gap-2.5">
            {(['scrap', 'circuit', 'cell', 'core'] as const).map((r) => (
                <span key={r} className="inline-flex items-center gap-1" title={CAT.resources[r]?.name ?? r}>
                    <GamePic pic={CAT.resources[r]} size={18} /><span className="font-mono text-xs">{res[r] ?? 0}</span>
                </span>
            ))}
        </span>
    )
}
const RARITY: Record<string, string> = { common: 'text-white/60', rare: 'text-sky-400', epic: 'text-fuchsia-400', legendary: 'text-amber-400' }
const ACCESS: Record<Row['access'], string> = { active: 'text-emerald-400', expired: 'text-amber-400/80', revoked: 'text-white/30 line-through', none: 'text-white/25' }
const LEVEL: Record<string, string> = { error: 'text-red-400', warn: 'text-orange-400', info: 'text-white/60', debug: 'text-white/30' }

async function api(url: string) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
    return data
}

export function CopyWallet({ wallet, className = '' }: { wallet: string; className?: string }) {
    const [done, setDone] = useState(false)
    return (
        <span className={`inline-flex items-center gap-1.5 ${className}`}>
            <span className="font-mono select-all break-all">{wallet}</span>
            <button type="button" title="Copy address" className="text-white/30 hover:text-white flex-shrink-0"
                onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(wallet).then(() => { setDone(true); setTimeout(() => setDone(false), 1200) }) }}>
                {done ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </button>
        </span>
    )
}

function Box({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-3 mb-3">
                <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40">{title}</h3>
                {hint && <span className="text-[10px] text-white/30 font-mono">{hint}</span>}
            </div>
            {children}
        </div>
    )
}

function Kv({ k, v, accent }: { k: string; v: React.ReactNode; accent?: string }) {
    return (
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-[9px] font-black uppercase tracking-widest text-white/35">{k}</div>
            <div className={`mt-0.5 text-sm font-black ${accent ?? 'text-white'}`}>{v}</div>
        </div>
    )
}

/**
 * Runs in hand for one wallet, editable (owner, 25.09.2026: «начислять кому-то игры или
 * редактировать число»). Sets the unspent count per mode; the server adds grants or takes
 * unspent runs away (api/admin/survival/credits).
 */
export function RunsEditor({ wallet }: { wallet: string }) {
    const [have, setHave] = useState<{ solo: number; coop: number } | null>(null)
    const [draft, setDraft] = useState<{ solo: string; coop: string }>({ solo: '', coop: '' })
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const load = useCallback(async () => {
        setError(null)
        try {
            const r = await api(`/api/admin/survival/credits?wallet=${wallet}`)
            setHave({ solo: r.solo, coop: r.coop }); setDraft({ solo: String(r.solo), coop: String(r.coop) })
        } catch (e) { setError((e as Error).message) }
    }, [wallet])
    useEffect(() => { void load() }, [load])
    const save = async (mode: 'solo' | 'coop', count: number) => {
        if (!Number.isInteger(count) || count < 0) { setError('A whole number, 0 or more'); return }
        setBusy(mode); setError(null)
        try {
            const res = await fetch('/api/admin/survival/credits', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet, mode, count }) })
            const r = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(r?.error || `HTTP ${res.status}`)
            setHave({ solo: r.solo, coop: r.coop }); setDraft({ solo: String(r.solo), coop: String(r.coop) })
        } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
    }
    const row = (mode: 'solo' | 'coop') => {
        const n = have?.[mode] ?? 0
        const dirty = have !== null && draft[mode] !== String(n)
        const btn = 'h-7 min-w-7 px-2 rounded-lg border border-white/10 bg-white/5 text-xs font-black hover:bg-white/10 disabled:opacity-40'
        return (
            <div className="flex items-center gap-2">
                <span className="w-12 text-[10px] font-black uppercase tracking-widest text-white/40">{mode}</span>
                <button className={btn} disabled={!have || busy !== null || n === 0} onClick={() => void save(mode, n - 1)}>−</button>
                <input value={draft[mode]} onChange={(e) => setDraft({ ...draft, [mode]: e.target.value.replace(/[^0-9]/g, '') })}
                    onKeyDown={(e) => { if (e.key === 'Enter' && dirty) void save(mode, Number(draft[mode])) }}
                    className="h-7 w-16 rounded-lg border border-white/10 bg-black/40 px-2 text-center text-sm font-black text-white outline-none focus:border-[#3b82f6]" />
                <button className={btn} disabled={!have || busy !== null} onClick={() => void save(mode, n + 1)}>+</button>
                <button className={btn} disabled={!have || busy !== null} onClick={() => void save(mode, n + 10)}>+10</button>
                {dirty && <button className={`${btn} text-[#3b82f6]`} disabled={busy !== null} onClick={() => void save(mode, Number(draft[mode]))}>Set</button>}
                {busy === mode && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />}
            </div>
        )
    }
    return (
        <div className="space-y-1.5">
            {row('solo')}
            {row('coop')}
            <div className="text-[10px] text-white/30">Unspent runs this season. Up adds free grants; down removes unspent runs (grants first).</div>
            {error && <div className="text-red-400 text-xs font-mono">{error}</div>}
        </div>
    )
}

/** Give runs to any wallet, even one that has not opened the game yet. */
function GiveRuns() {
    const [w, setW] = useState('')
    const ok = /^0x[0-9a-fA-F]{40}$/.test(w.trim())
    return (
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-3 space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-white/40">Give runs to a wallet</div>
            <input value={w} onChange={(e) => setW(e.target.value)} placeholder="0x…"
                className="w-full max-w-md h-8 rounded-lg border border-white/10 bg-black/40 px-3 text-xs font-mono text-white outline-none focus:border-[#3b82f6]" />
            {ok && <RunsEditor key={w.trim().toLowerCase()} wallet={w.trim().toLowerCase()} />}
        </div>
    )
}

export function SurvivalPlayers() {
    const [rows, setRows] = useState<Row[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [q, setQ] = useState('')
    const [sort, setSort] = useState<SortKey>('lastSeen')
    const [open, setOpen] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try { setRows((await api('/api/admin/survival/players')).players ?? []) } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
    }, [])
    useEffect(() => { void load() }, [load])

    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase()
        const list = (rows ?? []).filter((r) => !needle || r.wallet.includes(needle) || (r.name ?? '').toLowerCase().includes(needle)
            || (r.x ?? '').toLowerCase().includes(needle) || (r.clan ?? '').toLowerCase().includes(needle))
        const val = (r: Row) => (sort === 'lastSeen' ? Date.parse(r.lastSeen) : r[sort])
        return [...list].sort((a, b) => val(b) - val(a))
    }, [rows, q, sort])

    if (open) return <PlayerDetail wallet={open} onBack={() => setOpen(null)} />

    const lost = (rows ?? []).filter((r) => r.drift > 0)
    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <div className="flex-1 flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg px-3 py-2">
                    <Search className="h-3.5 w-3.5 text-white/30" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="wallet, name, X handle, clan…" className="flex-1 bg-transparent text-xs outline-none" />
                </div>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none">
                    {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
                </select>
                <button onClick={() => void load()} className="flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white"><RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
            </div>
            {error && <div className="text-red-400 text-xs font-mono">{error}</div>}
            <GiveRuns />
            {lost.length > 0 && (
                <div className="flex items-start gap-2 text-xs text-orange-300/90 bg-orange-500/10 border border-orange-500/20 rounded-xl px-3 py-2">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{lost.length} player{lost.length === 1 ? '' : 's'} had progress rolled back by the old save bug — {lost.reduce((n, r) => n + r.drift, 0)} runs lost in total. Sort by «Drift» to see who.</span>
                </div>
            )}
            {!rows ? <div className="flex items-center gap-2 text-white/40 text-sm py-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div> : (
                <div className="overflow-x-auto border border-white/10 rounded-2xl">
                    <table className="w-full text-xs min-w-[1100px]">
                        <thead className="bg-white/[0.03]"><tr className="text-white/30 text-[9px] uppercase tracking-widest">
                            <th className="text-left px-3 py-2">Wallet</th><th className="text-left">Name · X · clan</th><th className="text-left">Access</th>
                            <th className="text-right">Runs</th><th className="text-right">Best</th><th className="text-right">Play</th>
                            <th className="text-right">Ape Mini</th><th className="text-right" title="scrap / circuit / cell / core">Resources</th>
                            <th className="text-right">Heroes</th><th className="text-right" title="Tree levels bought, all heroes">Tree</th><th className="text-right">Bag</th>
                            <th className="text-right" title="Runs that reached Game Over minus runs in the save: progress lost to a rollback">Drift</th>
                            <th className="text-right px-3">Last seen</th>
                        </tr></thead>
                        <tbody>{shown.map((r) => (
                            <tr key={r.wallet} onClick={() => setOpen(r.wallet)} className="border-t border-white/5 hover:bg-white/[0.04] cursor-pointer">
                                <td className="px-3 py-2"><span className={`font-mono ${r.banned ? 'text-red-400 line-through' : ''}`}>{r.wallet}</span></td>
                                <td className="text-white/60 max-w-[220px] truncate">{r.name ?? '—'}{r.x ? <span className="text-sky-400/80"> · @{r.x.replace(/^@/, '')}</span> : null}{r.clan ? <span className="text-white/35"> · {r.clan}</span> : null}</td>
                                <td className={`text-[9px] font-black uppercase tracking-widest ${ACCESS[r.access]}`}>{r.access}</td>
                                <td className="text-right">{r.serverRuns}{r.rejected ? <span className="text-red-400"> ({r.rejected}✕)</span> : null}</td>
                                <td className="text-right font-black">{num(r.best)}</td>
                                <td className="text-right text-white/60">{dur(r.playMs)}</td>
                                <td className="text-right text-[#3b82f6] font-black">{num(r.coins)}</td>
                                <td className="text-right text-white/60"><Resources res={r.resources} /></td>
                                <td className="text-right"><span className="inline-flex gap-0.5 justify-end">{r.heroes.map((h) => <GamePic key={h} pic={CAT.heroes[h]} size={20} title={CAT.heroes[h]?.name ?? h} />)}</span></td>
                                <td className="text-right text-white/60">{r.treeLevels}</td>
                                <td className="text-right text-white/60">{r.items}</td>
                                <td className={`text-right font-black ${r.drift ? 'text-orange-400' : 'text-white/20'}`}>{r.drift || '·'}</td>
                                <td className="text-right px-3 font-mono text-white/35 whitespace-nowrap">{when(r.lastSeen)}</td>
                            </tr>
                        ))}</tbody>
                    </table>
                    {shown.length === 0 && <div className="text-white/30 text-xs p-4">Nobody matches.</div>}
                </div>
            )}
        </div>
    )
}

function PlayerDetail({ wallet, onBack }: { wallet: string; onBack: () => void }) {
    const [d, setD] = useState<Detail | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [raw, setRaw] = useState(false)
    const load = useCallback(async () => {
        setError(null)
        try { setD(await api(`/api/admin/survival/players?wallet=${wallet}`)) } catch (e) { setError((e as Error).message) }
    }, [wallet])
    useEffect(() => { void load() }, [load])

    const back = <button onClick={onBack} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> All players</button>
    if (error) return <div className="space-y-3">{back}<div className="text-red-400 text-xs font-mono">{error}</div></div>
    if (!d) return <div className="space-y-3">{back}<div className="flex items-center gap-2 text-white/40 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div></div>

    const st = d.profile?.state ?? {}
    const res = st.resources ?? {}
    const trees: Record<string, Record<string, number>> = st.heroTrees ?? {}
    const items: Array<{ uid: string; kind: string; rarity: string }> = Array.isArray(st.items) ? st.items : []
    const equipped = new Set<string>(Array.isArray(st.equipped) ? st.equipped : [])
    const tiers: Record<string, number> = st.weaponTiers ?? {}
    const bestiary = Object.entries((st.bestiary ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1])
    const player = (d.player ?? {}) as { clan?: string | null; banned?: boolean; ban_reason?: string | null; first_seen?: string; last_seen?: string }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">{back}<button onClick={() => void load()} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white"><RefreshCcw className="h-3.5 w-3.5" /> Refresh</button></div>

            <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4 space-y-2">
                <CopyWallet wallet={d.wallet} className="text-sm" />
                <div className="text-xs text-white/50">
                    {d.access?.note ?? 'no name'}{d.x ? <span className="text-sky-400"> · @{d.x.replace(/^@/, '')}</span> : null}{player.clan ? ` · clan ${player.clan}` : ''}
                    {player.banned ? <span className="text-red-400 font-black"> · BANNED{player.ban_reason ? ` (${player.ban_reason})` : ''}</span> : null}
                </div>
                <div className="text-[10px] font-mono text-white/30">
                    first seen {when(player.first_seen)} · last seen {when(player.last_seen)} · save written {when(d.profile?.updated_at)} · build {d.profile?.client_version ?? '—'}
                    {d.access ? ` · access ${d.access.revoked_at ? `revoked ${when(d.access.revoked_at)}` : d.access.expires_at ? `until ${when(d.access.expires_at)}` : 'forever'}` : ' · not on the beta list'}
                </div>
            </div>
            {d.problems.length > 0 && <div className="text-orange-400 text-xs font-mono">Some queries failed: {d.problems.join(' · ')}</div>}
            {d.stats.drift > 0 && (
                <div className="flex items-start gap-2 text-xs text-orange-300/90 bg-orange-500/10 border border-orange-500/20 rounded-xl px-3 py-2">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>The save counts {d.stats.saveRuns} runs, the server saw {d.stats.ended} reach Game Over: progress from about {d.stats.drift} runs was rolled back by the old save bug.</span>
                </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                <Kv k="Runs (server)" v={d.stats.serverRuns} />
                <Kv k="Accepted" v={d.stats.finished} accent="text-emerald-400" />
                <Kv k="Rejected · void" v={`${d.stats.rejected} · ${d.stats.voided}`} accent={d.stats.rejected ? 'text-red-400' : undefined} />
                <Kv k="Best score" v={num(d.stats.best)} />
                <Kv k="Playtime" v={dur(d.stats.playMs)} accent="text-[#3b82f6]" />
                <Kv k="Kills (lifetime)" v={num(st.lifetime?.kills)} />
                <Kv k="Ape Mini" v={num(st.coins)} accent="text-[#3b82f6]" />
                <Kv k="Resources" v={<Resources res={res} />} />
            </div>

            <Box title="Runs in hand">
                <RunsEditor wallet={d.wallet} />
            </Box>

            {!d.profile ? <div className="text-white/30 text-xs">No save on the server for this wallet yet.</div> : (
                <>
                    <div className="grid lg:grid-cols-2 gap-4">
                        <Box title="Heroes & skill trees" hint={`selected: ${CAT.heroes[st.selectedHero]?.name ?? st.selectedHero ?? '—'}`}>
                            <div className="space-y-3">
                                {(Array.isArray(st.unlockedHeroes) ? st.unlockedHeroes as string[] : []).map((h) => {
                                    const t = Object.entries(trees[h] ?? {}).filter(([, n]) => Number(n) > 0)
                                    return (
                                        <div key={h}>
                                            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest"><GamePic pic={CAT.heroes[h]} size={36} />{CAT.heroes[h]?.name ?? h}{h === st.selectedHero ? <span className="text-emerald-400"> · selected</span> : null}<span className="text-white/30 font-normal normal-case tracking-normal"> — {t.reduce((n, [, v]) => n + Number(v), 0)} levels</span></div>
                                            {t.length === 0 ? <div className="text-white/30 text-xs">nothing bought</div> : (
                                                <div className="flex flex-wrap gap-1.5 mt-1">{t.map(([id, n]) => (
                                                    <Chip key={id} pic={CAT.nodes[id]} label={nodeName(h, id)} title={CAT.nodes[id] ? `${CAT.nodes[id].branch} — ${CAT.nodes[id].desc}` : id}
                                                        extra={<span className="text-[#3b82f6] font-black">{n}{CAT.nodes[id]?.max ? <span className="text-white/30">/{CAT.nodes[id].max}</span> : null}</span>} />
                                                ))}</div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </Box>
                        <Box title="Weapons & cosmetics">
                            <div className="text-xs space-y-1.5">
                                <div>Selected: <span className="font-black">{CAT.weapons[st.selectedWeapon]?.name ?? st.selectedWeapon ?? '—'}</span></div>
                                <div className="flex flex-wrap gap-1.5">{(Array.isArray(st.unlockedWeapons) ? st.unlockedWeapons as string[] : []).map((w) => (
                                    <Chip key={w} pic={CAT.weapons[w]} label={CAT.weapons[w]?.name ?? pretty(w)} extra={<span className="text-[#3b82f6] font-black">T{tiers[w] ?? 1}</span>} />
                                ))}</div>
                                <div className="text-white/50">Cosmetics: {(Array.isArray(st.cosmetics) ? st.cosmetics as string[] : []).map(pretty).join(', ') || '—'} · worn {st.cosmetic ? pretty(st.cosmetic) : '—'}</div>
                                <div className="text-white/50">Boost waiting: {st.boost ?? 'none'} · clan in save: {st.clan || '—'}</div>
                            </div>
                        </Box>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-4">
                        <Box title="Bag" hint={`${items.length} items · ${equipped.size} equipped`}>
                            {items.length === 0 ? <div className="text-white/30 text-xs">Empty.</div> : (
                                <div className="flex flex-wrap gap-1.5">{items.map((it) => (
                                    <Chip key={it.uid} pic={CAT.items[it.kind]} label={CAT.items[it.kind]?.name ?? it.kind} title={`${it.rarity} — ${CAT.items[it.kind]?.desc ?? ''}${equipped.has(it.uid) ? ' · equipped' : ''}`}
                                        className={equipped.has(it.uid) ? 'border-emerald-400/50 bg-emerald-400/10' : 'border-white/10 bg-white/5'}
                                        extra={<><span className={`uppercase ${RARITY[it.rarity] ?? 'text-white/60'}`}>{it.rarity}</span>{equipped.has(it.uid) ? <span className="text-emerald-400">✓</span> : null}</>} />
                                ))}</div>
                            )}
                        </Box>
                        <Box title="Season" hint={`${d.seasons?.length ?? 0} season rows`}>
                            {(d.seasons ?? []).length === 0 ? <div className="text-white/30 text-xs">No season progress.</div> : (d.seasons ?? []).map((s) => (
                                <div key={s.season_id} className="text-xs py-1">
                                    <span className="font-black">{s.season_id}</span> · tier {s.tier} · {num(s.sxp)} sxp · {s.season?.pass ? <span className="text-amber-400">PASS</span> : 'free'} · claimed {(s.season?.claimed ?? []).length}{s.season?.pass ? ` + ${(s.season?.claimedPass ?? []).length} pass` : ''}
                                    <span className="text-white/35"> · daily streak {s.daily?.streak ?? 0} · updated {when(s.updated_at)}</span>
                                </div>
                            ))}
                        </Box>
                    </div>

                    <Box title="Bestiary" hint={`${bestiary.length} kinds met`}>
                        <div className="flex flex-wrap gap-1.5">{bestiary.map(([k, n]) => (
                            <Chip key={k} pic={CAT.enemies[k]} label={CAT.enemies[k]?.name ?? pretty(k)} extra={<span className="text-white/50 font-mono">{num(n)}</span>} />
                        ))}</div>
                    </Box>
                </>
            )}

            <Box title="Runs" hint={`${d.runs?.length ?? 0}, newest first`}>
                <div className="overflow-auto max-h-96">
                    <table className="w-full text-xs min-w-[760px]">
                        <thead><tr className="text-white/30 text-[9px] uppercase tracking-widest"><th className="text-left py-1">Started</th><th className="text-left">Status</th><th className="text-left">Hero · weapon</th><th className="text-right">Score</th><th className="text-right">Wave</th><th className="text-right">Kills</th><th className="text-right">Server</th><th className="text-right">Client</th><th className="text-left pl-3">Build</th></tr></thead>
                        <tbody>{(d.runs ?? []).map((r) => (
                            <tr key={r.id} className="border-t border-white/5">
                                <td className="py-1 font-mono text-white/40 whitespace-nowrap">{when(r.started_at)}</td>
                                <td className={`font-black uppercase text-[9px] ${r.status === 'finished' ? 'text-emerald-400' : r.status === 'rejected' ? 'text-red-400' : 'text-white/40'}`}>{r.status}{r.reject_reason ? <span className="text-orange-400 normal-case font-normal"> {r.reject_reason}</span> : null}</td>
                                <td className="text-white/60"><span className="inline-flex items-center gap-1.5">{r.hero ? <GamePic pic={CAT.heroes[r.hero]} size={20} /> : null}{CAT.heroes[r.hero ?? '']?.name ?? r.hero ?? '—'} · {CAT.weapons[r.weapon ?? '']?.name ?? r.weapon ?? '—'}</span></td>
                                <td className="text-right font-black">{num(r.score)}</td><td className="text-right">{r.wave ?? '—'}</td><td className="text-right">{r.kills ?? '—'}</td>
                                <td className="text-right text-white/50">{dur(r.server_duration_ms)}</td><td className="text-right text-white/50">{dur(r.client_duration_ms)}</td>
                                <td className="pl-3 font-mono text-white/30">{r.client_version}</td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            </Box>

            <div className="grid lg:grid-cols-2 gap-4">
                <Box title="Journal" hint={`${d.events?.length ?? 0} latest`}>
                    <div className="overflow-auto max-h-80 divide-y divide-white/5">{(d.events ?? []).map((e) => (
                        <div key={e.id} className="py-1 text-xs flex gap-2">
                            <span className="font-mono text-white/30 w-36 flex-shrink-0">{when(e.at)}</span>
                            <span className={`w-40 flex-shrink-0 truncate ${LEVEL[e.level] ?? ''}`}>{e.kind}</span>
                            <span className="text-white/50 truncate" title={JSON.stringify(e.data)}>{e.message}</span>
                        </div>
                    ))}{(d.events ?? []).length === 0 && <div className="text-white/30 text-xs">Nothing logged.</div>}</div>
                </Box>
                <Box title="Payments & review">
                    <div className="space-y-1 text-xs">
                        {(d.payments ?? []).length === 0 ? <div className="text-white/30">No payments.</div> : (d.payments ?? []).map((p) => (
                            <div key={p.tx_hash} className="flex gap-2"><span className="font-mono text-white/30">{when(p.created_at)}</span><span className="font-black">{p.amount_ape} APE</span><span className={p.confirmed_at ? 'text-emerald-400' : 'text-white/40'}>{p.confirmed_at ? 'confirmed' : 'pending'}</span><a className="font-mono text-sky-400/70 truncate" href={`https://apescan.io/tx/${p.tx_hash}`} target="_blank" rel="noreferrer">{p.tx_hash.slice(0, 14)}…</a></div>
                        ))}
                        <div className="pt-2 border-t border-white/5 mt-2">
                            {d.feedback ? <><span className="text-[#ffcf4a]">{'★'.repeat(d.feedback.rating)}</span> <span className="text-white/40">after {d.feedback.runs_at_submit} runs · +{d.feedback.coins_awarded} mini</span>{d.feedback.comment ? <div className="text-white/70 mt-1 whitespace-pre-wrap">{d.feedback.comment}</div> : null}</> : <span className="text-white/30">No review.</span>}
                        </div>
                    </div>
                </Box>
            </div>

            {d.profile && (
                <div>
                    <button onClick={() => setRaw((v) => !v)} className="text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white">{raw ? 'Hide' : 'Show'} raw save (JSON)</button>
                    {raw && <pre className="mt-2 text-[10px] font-mono text-white/60 bg-black/40 border border-white/10 rounded-xl p-3 overflow-auto max-h-[60vh]">{JSON.stringify(d.profile.state, null, 2)}</pre>}
                </div>
            )}
        </div>
    )
}
