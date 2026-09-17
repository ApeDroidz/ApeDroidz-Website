'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Ban, Check, Loader2, Plus, RefreshCcw, ShieldCheck, Trash2, Users } from 'lucide-react'

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
    stats: { players: number; players24: number; runsAll: number; runs24: number; runs7: number; finished: number; rejected: number; voided: number; started: number; rejectRate: number }
    board: Array<{ rank: number; wallet_short: string; display_name: string | null; score: number; wave: number; kills: number; runs_count: number; achieved_at: string }>
    events: Array<{ id: number; at: string; wallet: string | null; source: string; level: string; kind: string; message: string; data: Record<string, unknown>; run_id: string | null; client_version: string | null }>
    suspicious: Array<{ id: string; wallet: string; status: string; reject_reason: string | null; flags: string[]; score: number; wave: number; kills: number; started_at: string; server_duration_ms: number | null; client_duration_ms: number | null; client_version: string | null; hero: string | null }>
    cheaters: Array<{ wallet: string; rejected: number; last: string; reasons: string[]; banned: boolean; ban_reason: string | null }>
    allowlist: Array<{ wallet: string; status: string; note: string | null; added_at: string; revoked_at: string | null }>
    recentRuns: Array<{ id: string; wallet: string; status: string; reject_reason: string | null; score: number; wave: number; kills: number; started_at: string; hero: string | null; client_version: string | null }>
    profiles: Array<{ wallet: string; coins: number; runs: number; best_score: number; selected_hero: string | null; updated_at: string }>
}
type Clan = { slug: string; name: string; opensea_slug: string | null; chain: string | null; contract: string | null; image_url: string | null; active: boolean }

const short = (w: string | null | undefined) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : '—')
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')
const secs = (ms: number | null | undefined) => (ms == null ? '—' : `${Math.round(ms / 1000)}s`)

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

export function SurvivalTab() {
    const [data, setData] = useState<Payload | null>(null)
    const [clans, setClans] = useState<Clan[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState<string | null>(null)
    const [wallet, setWallet] = useState('')
    const [note, setNote] = useState('')
    const [clanSlug, setClanSlug] = useState('')
    const [clanName, setClanName] = useState('')
    const [openEvent, setOpenEvent] = useState<number | null>(null)

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const [d, c] = await Promise.all([api('/api/admin/survival'), api('/api/admin/survival/clans')])
            setData(d); setClans(c.clans ?? [])
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

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-mono text-white/30">
                    season <span className="text-white/60">{data.season ? `${data.season.name} (${data.season.id}, ${data.season.status})` : 'none live'}</span> · generated {when(data.generatedAt)}
                </div>
                <button onClick={() => void load()} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white"><RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
            </div>
            {error && <div className="text-red-400 text-xs font-mono">{error}</div>}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Stat label="Players" value={s.players} />
                <Stat label="Active 24h" value={s.players24} accent="text-[#3b82f6]" />
                <Stat label="Runs (24h / 7d / all)" value={`${s.runs24} / ${s.runs7} / ${s.runsAll}`} />
                <Stat label="Accepted" value={s.finished} accent="text-emerald-400" />
                <Stat label="Rejected" value={`${s.rejected} (${(s.rejectRate * 100).toFixed(1)}%)`} accent={s.rejected ? 'text-red-400' : 'text-white'} />
                <Stat label="Void / open" value={`${s.voided} / ${s.started}`} />
            </div>

            <div className="grid lg:grid-cols-2 gap-5">
                <Section title="Season board" hint={`top ${data.board.length}`}>
                    {data.board.length === 0 ? <div className="text-white/30 text-xs">No accepted runs yet.</div> : (
                        <table className="w-full text-xs">
                            <thead><tr className="text-white/30 text-[9px] uppercase tracking-widest"><th className="text-left py-1">#</th><th className="text-left">Player</th><th className="text-right">Score</th><th className="text-right">Wave</th><th className="text-right">Kills</th><th className="text-right">Runs</th></tr></thead>
                            <tbody>{data.board.map((b) => (
                                <tr key={b.rank} className="border-t border-white/5"><td className="py-1 text-white/50">{b.rank}</td><td className="font-mono">{b.wallet_short}{b.display_name ? <span className="text-white/40"> · {b.display_name}</span> : null}</td><td className="text-right font-black">{b.score}</td><td className="text-right text-white/60">{b.wave}</td><td className="text-right text-white/60">{b.kills}</td><td className="text-right text-white/40">{b.runs_count}</td></tr>
                            ))}</tbody>
                        </table>
                    )}
                </Section>

                <Section title="Beta access" hint={`${data.allowlist.filter((a) => a.status === 'active').length} active`}>
                    <form className="flex flex-col sm:flex-row gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); if (!wallet) return; void act('allow', () => api('/api/admin/survival/allowlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'add', wallet, note }) })).then(() => { setWallet(''); setNote('') }) }}>
                        <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x… wallet" className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-[#3b82f6]" />
                        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (who / where from)" className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-[#3b82f6]" />
                        <button type="submit" disabled={busy === 'allow'} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#3b82f6] text-[10px] font-black uppercase tracking-widest disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Add</button>
                    </form>
                    <div className="max-h-64 overflow-auto divide-y divide-white/5">
                        {data.allowlist.map((a) => (
                            <div key={a.wallet} className="flex items-center gap-3 py-1.5 text-xs">
                                {a.status === 'active' ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" /> : <Ban className="h-3.5 w-3.5 text-white/25 flex-shrink-0" />}
                                <span className={`font-mono ${a.status === 'active' ? '' : 'text-white/30 line-through'}`}>{short(a.wallet)}</span>
                                <span className="text-white/40 flex-1 truncate">{a.note ?? ''}</span>
                                <span className="text-white/25 font-mono text-[10px]">{when(a.added_at).slice(0, 10)}</span>
                                {a.status === 'active'
                                    ? <button onClick={() => void act(a.wallet, () => api('/api/admin/survival/allowlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'revoke', wallet: a.wallet }) }))} className="text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-red-400">Revoke</button>
                                    : <button onClick={() => void act(a.wallet, () => api('/api/admin/survival/allowlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'add', wallet: a.wallet, note: a.note }) }))} className="text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-emerald-400">Restore</button>}
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
                                <span className="font-mono">{short(c.wallet)}</span>
                                <span className="text-white/50">{c.rejected}× · {c.reasons.join(', ')}</span>
                                <span className="text-white/25 font-mono text-[10px] flex-1 text-right">{when(c.last)}</span>
                                <button onClick={() => void act(c.wallet, () => api('/api/admin/survival/ban', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: c.wallet, banned: !c.banned, reason: c.banned ? null : c.reasons.join(',') }) }))} className={`text-[9px] font-black uppercase tracking-widest ${c.banned ? 'text-red-400 hover:text-white' : 'text-white/40 hover:text-red-400'}`}>{c.banned ? 'Banned — unban' : 'Ban'}</button>
                            </div>
                        ))}</div>
                    )}
                </Section>

                <Section title="Clans" hint="collection PFP from OpenSea">
                    <form className="flex flex-col sm:flex-row gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); if (!clanSlug) return; void act('clan', () => api('/api/admin/survival/clans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'add', openseaSlug: clanSlug, name: clanName }) })).then(() => { setClanSlug(''); setClanName('') }) }}>
                        <input value={clanSlug} onChange={(e) => setClanSlug(e.target.value)} placeholder="opensea slug (e.g. boredapeyachtclub)" className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-[#3b82f6]" />
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
                                ? <button onClick={() => void act(c.slug, () => api('/api/admin/survival/clans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove', slug: c.slug }) }))} className="text-white/40 hover:text-red-400" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                                : <button onClick={() => void act(c.slug, () => api('/api/admin/survival/clans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'restore', slug: c.slug }) }))} className="text-white/40 hover:text-emerald-400" title="Restore"><Check className="h-3.5 w-3.5" /></button>}
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
                                <tr key={r.id} className="border-t border-white/5"><td className="py-1 font-mono text-white/40">{when(r.started_at)}</td><td className="font-mono">{short(r.wallet)}</td><td className="text-orange-400">{r.reject_reason}</td><td className="text-right">{r.score}</td><td className="text-right">{r.wave}</td><td className="text-right">{r.kills}</td><td className="text-right text-white/50">{secs(r.server_duration_ms)}</td><td className="text-right text-white/50">{secs(r.client_duration_ms)}</td><td className="font-mono text-white/30">{r.client_version}</td></tr>
                            ))}</tbody>
                        </table>
                    </div>
                )}
            </Section>

            <Section title="Journal — warnings and errors" hint="client + server, newest first">
                {data.events.length === 0 ? <div className="text-white/30 text-xs">Quiet.</div> : (
                    <div className="overflow-auto max-h-96 divide-y divide-white/5">{data.events.map((e) => (
                        <div key={e.id} className="py-1.5 text-xs">
                            <button onClick={() => setOpenEvent(openEvent === e.id ? null : e.id)} className="w-full text-left flex items-center gap-3">
                                <span className="font-mono text-white/30 w-36 flex-shrink-0">{when(e.at)}</span>
                                <span className={`font-black uppercase text-[9px] w-10 ${LEVEL[e.level] ?? ''}`}>{e.level}</span>
                                <span className="text-white/30 w-4">{e.source === 'client' ? 'C' : 'S'}</span>
                                <span className="font-mono w-24 flex-shrink-0">{short(e.wallet)}</span>
                                <span className="text-white/60 w-32 flex-shrink-0 truncate">{e.kind}</span>
                                <span className="truncate flex-1">{e.message}</span>
                            </button>
                            {openEvent === e.id && <pre className="mt-2 text-[10px] font-mono text-white/50 bg-black/40 rounded-lg p-3 overflow-auto max-h-64">{JSON.stringify({ run: e.run_id, build: e.client_version, ...e.data }, null, 2)}</pre>}
                        </div>
                    ))}</div>
                )}
            </Section>

            <div className="grid lg:grid-cols-2 gap-5">
                <Section title="Recent runs" hint="newest first">
                    <div className="overflow-auto max-h-80 divide-y divide-white/5">{data.recentRuns.map((r) => (
                        <div key={r.id} className="flex items-center gap-3 py-1 text-xs">
                            <span className="font-mono text-white/30 w-36 flex-shrink-0">{when(r.started_at)}</span>
                            <span className="font-mono w-24">{short(r.wallet)}</span>
                            <span className={`w-16 font-black uppercase text-[9px] ${r.status === 'finished' ? 'text-emerald-400' : r.status === 'rejected' ? 'text-red-400' : 'text-white/40'}`}>{r.status}</span>
                            <span className="text-white/60 flex-1 truncate">{r.hero ?? ''} · score {r.score} · wave {r.wave} · {r.kills} kills {r.reject_reason ? `· ${r.reject_reason}` : ''}</span>
                        </div>
                    ))}</div>
                </Section>
                <Section title="Player progress" hint="server-side profiles, newest first">
                    <div className="overflow-auto max-h-80 divide-y divide-white/5">{data.profiles.map((p) => (
                        <div key={p.wallet} className="flex items-center gap-3 py-1 text-xs">
                            <span className="font-mono w-24">{short(p.wallet)}</span>
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
