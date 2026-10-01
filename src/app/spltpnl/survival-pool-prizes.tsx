'use client'

import { useCallback, useEffect, useState } from 'react'
import { CopyWallet } from './survival-players'
import { POOL_LEVELS, levelAt } from '@/lib/survivalPoolLevels'

/**
 * NFT prizes of the season's PRIZE POOL (owner, 28.09.2026: «в прайз пул — окошки, куда я добавлю другие
 * NFT; в сплитпанели — возможность добавлять призы именно сюда, по принципу, как в лаки тикет»).
 *
 * Add by link, like the lucky ticket: paste links → each resolves to a name, a picture and whether the
 * PRIZE VAULT holds it (/api/admin/inventory/resolve) → pick the season, the PLACE on the board that
 * takes it, and (optionally) the pool LEVEL that opens it → add. The game shows them in the PRIZE POOL
 * tab — locked until the pool reaches their level. At the season's end: mark the winner, then the send.
 */
type Prize = { id: number; season_id: string; place: number; unlock_level: number | null; contract: string; token_id: string; standard: string; name: string | null; image_url: string | null; status: string; winner: string | null; tx_hash: string | null; note: string | null; added_at: string; sent_at: string | null }
type Season = { id: string; name: string; status?: string }
type Pool = { poolApe: number; poolLevel: number }
type Payload = { liveSeason: Season | null; seasons: Season[]; prizes: Prize[]; poolApe: number | null; poolLevel: number | null; pools?: Record<string, Pool> }
type Resolved = { ref: string; ok: boolean; error?: string; contract?: string; tokenId?: string; standard?: string; name?: string; imageUrl?: string; inVault?: boolean }
const fmtApe = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const STATUS: Record<string, string> = { listed: 'text-emerald-400', awarded: 'text-yellow-300', sent: 'text-white/40' }
const WALLET = /^0x[0-9a-fA-F]{40}$/
const TX = /^0x[0-9a-fA-F]{64}$/

export function SurvivalPoolPrizes() {
    const [d, setD] = useState<Payload | null>(null)
    const [msg, setMsg] = useState<string | null>(null)
    const [raw, setRaw] = useState('')
    const [rows, setRows] = useState<Resolved[]>([])
    const [season, setSeason] = useState('')
    const [place, setPlace] = useState('1')
    const [level, setLevel] = useState('')
    const [busy, setBusy] = useState(false)
    const call = useCallback(async (init?: RequestInit) => {
        const r = await fetch('/api/admin/survival/pool-prizes', { credentials: 'include', cache: 'no-store', ...init, headers: { 'content-type': 'application/json' } })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setMsg(j.error ?? `HTTP ${r.status}`); return null }
        setD(j)
        return j
    }, [])
    useEffect(() => { void call().then((j) => { if (j?.liveSeason) setSeason(j.liveSeason.id) }) }, [call])
    if (!d) return <div className="text-white/40 text-xs">{msg ?? 'Loading pool prizes…'}</div>

    const refs = raw.split(/[\n,\s]+/).map((x) => x.trim()).filter(Boolean)
    const resolve = async () => {
        setBusy(true); setMsg(null)
        const r = await fetch('/api/admin/inventory/resolve', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs }) })
        const j = await r.json().catch(() => ({}))
        setBusy(false)
        if (!r.ok) { setMsg(j.error ?? `HTTP ${r.status}`); return }
        setRows(j.items ?? [])
    }
    const ready = rows.filter((r) => r.ok && r.inVault)
    const add = async () => {
        setBusy(true)
        const j = await call({ method: 'POST', body: JSON.stringify({ seasonId: season, place: Number(place), unlockLevel: level === '' ? null : Number(level),
            importNfts: ready.map((x) => ({ contract: x.contract, tokenId: x.tokenId, standard: x.standard, name: x.name, imageUrl: x.imageUrl })) }) })
        setBusy(false)
        if (!j) return
        setMsg(`Added ${j.added?.length ?? 0}${j.skipped?.length ? `, skipped ${j.skipped.length}: ${j.skipped.map((x: { ref: string; reason: string }) => `${x.ref.split('/')[1]} (${x.reason})`).join(', ')}` : ''}`)
        setRows([]); setRaw('')
    }
    const update = (id: number, patch: Record<string, unknown>) => { setMsg(null); void call({ method: 'POST', body: JSON.stringify({ update: { id, ...patch } }) }) }
    // The level the game shows this prize's season pool at — a prize above it is LOCKED for the players.
    const lockedBy = (p: Prize): Pool | null => {
        const pool = d.pools?.[p.season_id]
        return pool && p.status === 'listed' && p.unlock_level !== null && p.unlock_level > pool.poolLevel ? pool : null
    }
    const prizeLabel = (p: Prize) => `«${p.name ?? `#${p.token_id}`}» (place #${p.place}, ${seasonName(p.season_id)})`
    const award = (p: Prize) => {
        const locked = lockedBy(p)
        if (locked && !window.confirm(`This prize is LOCKED: pool LVL ${locked.poolLevel} (${fmtApe(locked.poolApe)} APE), it opens at LVL ${p.unlock_level}. Players see it closed.\n\nAward it anyway?`)) return
        const raw = window.prompt(`Winner wallet for ${prizeLabel(p)} (0x…)`)
        if (raw === null) return
        const w = raw.trim()
        if (!WALLET.test(w)) { setMsg('winner: 0x + 40 hex'); return }
        if (!window.confirm(`Award ${prizeLabel(p)} to\n${w.toLowerCase()}?`)) return
        update(p.id, { status: 'awarded', winner: w, ...(locked ? { force: true } : {}) })
    }
    const markSent = (p: Prize) => {
        const raw = window.prompt(`Transfer tx hash for ${prizeLabel(p)} → ${p.winner ?? '?'} (0x…)`)
        if (raw === null) return
        const tx = raw.trim()
        if (!TX.test(tx)) { setMsg('tx hash: 0x + 64 hex'); return }
        update(p.id, { status: 'sent', txHash: tx })
    }
    const unaward = (p: Prize) => {
        if (!window.confirm(`Take ${prizeLabel(p)} back from ${p.winner ?? '?'} and list it again?`)) return
        update(p.id, { status: 'listed' })
    }
    const input = 'bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#3b82f6]'
    const seasonName = (id: string) => d.seasons.find((s) => s.id === id)?.name ?? id
    const levelLabel = (l: number) => `LVL ${l} · ${levelAt(l)} APE`

    return (
        <div className="space-y-3">
            <div className="rounded-xl border border-[#3b82f6]/30 bg-[#3b82f6]/5 p-3 space-y-3">
                <div className="text-xs font-black uppercase tracking-widest">Add NFT prizes by link</div>
                <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-start">
                    <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={3} placeholder={'https://opensea.io/item/ape_chain/0x.../123\n0xabc...def/456'}
                        className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-[#3b82f6]" />
                    <div className="flex flex-col gap-2 min-w-[220px]">
                        <select value={season} onChange={(e) => setSeason(e.target.value)} className={input} title="The season whose pool promises them">
                            {d.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === d.liveSeason?.id ? ' (live)' : ''}</option>)}
                        </select>
                        <div className="flex gap-2">
                            <label className="flex-1 text-[9px] uppercase tracking-widest text-white/40">Place<input className={`${input} w-full mt-0.5`} type="number" min="1" value={place} onChange={(e) => setPlace(e.target.value)} /></label>
                            <label className="flex-1 text-[9px] uppercase tracking-widest text-white/40">Opens at
                                <select className={`${input} w-full mt-0.5`} value={level} onChange={(e) => setLevel(e.target.value)}>
                                    <option value="">from the start</option>
                                    {POOL_LEVELS.map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
                                </select>
                            </label>
                        </div>
                        <button onClick={() => void resolve()} disabled={busy || !refs.length} className="px-3 py-1.5 rounded-lg bg-[#3b82f6] text-[10px] font-black uppercase tracking-widest disabled:opacity-40">Resolve {refs.length ? `(${refs.length})` : ''}</button>
                    </div>
                </div>
                {rows.length > 0 && (
                    <div className="space-y-1.5">
                        {rows.map((r, i) => (
                            <div key={`${r.ref}-${i}`} className={`flex items-center gap-2 p-1.5 rounded-lg border ${r.ok && r.inVault ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-red-500/25 bg-red-500/5'}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {r.imageUrl ? <img src={r.imageUrl} alt="" className="w-10 h-10 rounded object-cover" /> : <div className="w-10 h-10 rounded bg-black/40" />}
                                <div className="flex-1 min-w-0 text-xs"><div className="truncate">{r.name ?? 'name not resolved'}</div><div className="font-mono text-[10px] text-white/35 truncate">{r.contract ? `${r.contract.slice(0, 10)}… #${r.tokenId} · ${r.standard}` : r.ref}</div></div>
                                <span className={`text-[10px] font-bold ${r.ok && r.inVault ? 'text-emerald-400' : 'text-red-400'}`}>{!r.ok ? r.error : r.inVault ? 'in prize vault' : 'NOT in prize vault — will not be added'}</span>
                            </div>
                        ))}
                        <button onClick={() => void add()} disabled={busy || !ready.length || !season} className="px-3 py-1.5 rounded-lg bg-emerald-500/80 text-[10px] font-black uppercase tracking-widest disabled:opacity-40">
                            Add {ready.length} for place {place}{level ? `, opens at LVL ${level}` : ''}
                        </button>
                    </div>
                )}
                {msg && <div className="text-xs font-mono text-white/70">{msg}</div>}
            </div>

            <div className="text-[10px] font-black uppercase tracking-widest text-white/60">
                {d.liveSeason ? `${d.liveSeason.name} pool: ${d.poolApe === null ? '?' : fmtApe(d.poolApe)} APE · LVL ${d.poolLevel ?? '?'}` : 'No live season'}
            </div>
            {d.prizes.length === 0 ? <div className="text-xs text-white/40">No NFT prizes in any pool yet — the game shows empty slots.</div> : (
                <div className="divide-y divide-white/5">
                    {d.prizes.map((p) => (
                        <div key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {p.image_url ? <img src={p.image_url} alt="" className="w-10 h-10 rounded object-cover" /> : <div className="w-10 h-10 rounded bg-black/40" />}
                            <div className="w-44 min-w-0"><div className="truncate">{p.name ?? `#${p.token_id}`}</div><div className="text-[10px] text-white/35 truncate">{seasonName(p.season_id)}</div></div>
                            <label className="text-[9px] uppercase tracking-widest text-white/40">Place
                                <input className={`${input} w-16 ml-1`} type="number" min="1" defaultValue={p.place} disabled={p.status !== 'listed'}
                                    onBlur={(e) => { if (Number(e.target.value) !== p.place) update(p.id, { place: Number(e.target.value) }) }} />
                            </label>
                            <select className={input} value={p.unlock_level ?? ''} disabled={p.status !== 'listed'} onChange={(e) => update(p.id, { unlockLevel: e.target.value === '' ? null : Number(e.target.value) })}>
                                <option value="">from the start</option>
                                {POOL_LEVELS.map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
                            </select>
                            <span className={`w-16 font-black uppercase text-[9px] ${STATUS[p.status] ?? ''}`}>{p.status}</span>
                            {lockedBy(p) && <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 font-black uppercase text-[9px]" title={`Pool is LVL ${lockedBy(p)!.poolLevel}; players see this prize closed`}>Locked</span>}
                            <span className="flex-1 min-w-[120px] truncate text-white/50">{p.winner ? <CopyWallet wallet={p.winner} /> : null}{p.note ? ` · ${p.note}` : ''}</span>
                            {p.tx_hash && <a className="font-mono text-sky-400/80" href={`https://apescan.io/tx/${p.tx_hash}`} target="_blank" rel="noreferrer">tx</a>}
                            {p.status === 'listed' && <button onClick={() => award(p)} className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${lockedBy(p) ? 'bg-white/10 text-white/40' : 'bg-yellow-500/70'}`}>Award</button>}
                            {p.status === 'awarded' && <button onClick={() => markSent(p)} className="px-2 py-0.5 rounded bg-emerald-500/70 text-[9px] font-black uppercase">Mark sent</button>}
                            {p.status === 'awarded' && <button onClick={() => unaward(p)} className="px-2 py-0.5 rounded bg-white/10 text-[9px] font-black uppercase text-white/50">Unaward</button>}
                            {p.status === 'listed' && <button onClick={() => void call({ method: 'POST', body: JSON.stringify({ remove: p.id }) })} className="px-2 py-0.5 rounded bg-white/10 text-[9px] font-black uppercase text-white/50">Remove</button>}
                        </div>
                    ))}
                </div>
            )}
            <div className="text-[10px] text-white/35">Place = the spot on the season board (among pass holders) that takes the prize. «Opens at» ties it to the pool&apos;s level: the game shows it locked until the pool gets there. Prizes are sent by hand at the season&apos;s end — Award names the winner (a LOCKED prize — above the pool&apos;s level — asks before it goes), Unaward undoes a wrong one, Mark sent keeps the tx and is final.</div>
        </div>
    )
}
