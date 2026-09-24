'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Save } from 'lucide-react'
import { CopyWallet } from './survival-players'

/**
 * The lucky ticket's prize table (owner, 24.09.2026). Chance = weight ÷ the sum of weights of the
 * prizes that are on and in stock — players see the same odds in the game before they pay.
 * Stock empty = unlimited; a number = that many left, it stops dropping at 0 (the droid starts at 0:
 * put the number of droids you actually hold for prizes). Won droids are sent by hand — mark them here.
 */
type Prize = { id: string; label: string; kind: string; spec: Record<string, unknown>; weight: number; stock: number | null; active: boolean; sort: number }
type Nft = { id: number; prize_id: string; contract: string; token_id: string; standard: string; name: string | null; image_url: string | null; status: string; winner: string | null; tx_hash: string | null; error: string | null; added_at: string; sent_at: string | null }
type Payload = { prizes: Prize[]; drawn: Record<string, number>; totalDraws: number; nfts: Nft[]; recent: Array<{ id: string; wallet: string; prize: string; at: string; opened: boolean }> }
type Resolved = { ref: string; ok: boolean; error?: string; contract?: string; tokenId?: string; standard?: string; name?: string; imageUrl?: string; inVault?: boolean }
const NFT_STATUS: Record<string, string> = { available: 'text-emerald-400', reserved: 'text-yellow-300', sending: 'text-yellow-300', sent: 'text-white/40', failed: 'text-red-400' }

/**
 * NFT prizes by link, the way Glitch Cards adds them: paste links → each resolves to a name, a
 * picture and whether the PRIZE VAULT really holds it (/api/admin/inventory/resolve — a token that
 * is only «on paper» would fail at the winner) → pick the ticket prize it belongs to → add.
 * Won tokens are sent from the vault automatically; a failed send shows here with Retry.
 */
function NftPool({ d, call }: { d: Payload; call: (init?: RequestInit) => Promise<boolean> }) {
    const nftPrizes = d.prizes.filter((p) => p.kind === 'nft')
    const [raw, setRaw] = useState('')
    const [rows, setRows] = useState<Resolved[]>([])
    const [prizeId, setPrizeId] = useState(nftPrizes[0]?.id ?? '')
    const [busy, setBusy] = useState(false)
    const [note, setNote] = useState<string | null>(null)
    const refs = raw.split(/[\n,\s]+/).map((x) => x.trim()).filter(Boolean)
    const resolve = async () => {
        setBusy(true); setNote(null)
        const r = await fetch('/api/admin/inventory/resolve', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs }) })
        const j = await r.json().catch(() => ({}))
        setBusy(false)
        if (!r.ok) { setNote(j.error ?? `HTTP ${r.status}`); return }
        setRows(j.items ?? [])
    }
    const ready = rows.filter((r) => r.ok && r.inVault)
    const add = async () => {
        setBusy(true)
        const r = await fetch('/api/admin/survival/tickets', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ prizeId, importNfts: ready.map((x) => ({ contract: x.contract, tokenId: x.tokenId, standard: x.standard, name: x.name, imageUrl: x.imageUrl })) }) })
        const j = await r.json().catch(() => ({}))
        setBusy(false)
        if (!r.ok) { setNote(j.error ?? `HTTP ${r.status}`); return }
        setNote(`Added ${j.added?.length ?? 0}${j.skipped?.length ? `, skipped ${j.skipped.length}: ${j.skipped.map((x: { ref: string; reason: string }) => `${x.ref.split('/')[1]} (${x.reason})`).join(', ')}` : ''}`)
        setRows([]); setRaw('')
        await call()
    }
    const pool = d.nfts
    const avail = (id: string) => pool.filter((n) => n.prize_id === id && n.status === 'available').length
    return (
        <div className="rounded-xl border border-[#3b82f6]/30 bg-[#3b82f6]/5 p-3 space-y-3">
            <div className="text-xs font-black uppercase tracking-widest">NFT prizes — add by link</div>
            {nftPrizes.length === 0 ? <div className="text-xs text-white/40">Add a prize of kind «nft» in the table above first (e.g. «An ApeDroidz droid»).</div> : (
                <>
                    <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-start">
                        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={3} placeholder={'https://opensea.io/item/ape_chain/0x.../123\n0xabc...def/456'}
                            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-[#3b82f6]" />
                        <div className="flex flex-col gap-2">
                            <select value={prizeId} onChange={(e) => setPrizeId(e.target.value)} className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs">
                                {nftPrizes.map((p) => <option key={p.id} value={p.id}>{p.label} ({avail(p.id)} in pool)</option>)}
                            </select>
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
                            <button onClick={() => void add()} disabled={busy || !ready.length} className="px-3 py-1.5 rounded-lg bg-emerald-500/80 text-[10px] font-black uppercase tracking-widest disabled:opacity-40">Add {ready.length} to the ticket</button>
                        </div>
                    )}
                </>
            )}
            {note && <div className="text-xs font-mono text-white/70">{note}</div>}
            {pool.length > 0 && (
                <div className="max-h-72 overflow-auto divide-y divide-white/5">
                    {pool.map((n) => (
                        <div key={n.id} className="flex items-center gap-2 py-1.5 text-xs">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {n.image_url ? <img src={n.image_url} alt="" className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 rounded bg-black/40" />}
                            <span className="w-44 truncate">{n.name ?? `#${n.token_id}`}</span>
                            <span className="text-white/40 w-28 truncate">{n.prize_id}</span>
                            <span className={`w-20 font-black uppercase text-[9px] ${NFT_STATUS[n.status] ?? ''}`}>{n.status}</span>
                            <span className="flex-1 truncate text-white/50">{n.winner ? <CopyWallet wallet={n.winner} /> : null}{n.error ? <span className="text-red-400"> {n.error}</span> : null}</span>
                            {n.tx_hash && <a className="font-mono text-sky-400/80" href={`https://apescan.io/tx/${n.tx_hash}`} target="_blank" rel="noreferrer">tx</a>}
                            {(n.status === 'failed' || n.status === 'reserved') && <button onClick={() => void call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ retrySend: n.id }) })} className="px-2 py-0.5 rounded bg-red-500/70 text-[9px] font-black uppercase">Retry send</button>}
                            {n.status === 'available' && <button onClick={() => void call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ removeNft: n.id }) })} className="px-2 py-0.5 rounded bg-white/10 text-[9px] font-black uppercase text-white/50">Remove</button>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
const KINDS = ['coins', 'resources', 'item', 'boost', 'runs', 'nft']
const BLANK: Prize = { id: '', label: '', kind: 'coins', spec: { coins: 100 }, weight: 10, stock: null, active: false, sort: 200 }

export function SurvivalTickets() {
    const [d, setD] = useState<Payload | null>(null)
    const [draft, setDraft] = useState<Record<string, Prize & { specText: string; stockText: string }>>({})
    const [msg, setMsg] = useState<string | null>(null)
    const call = useCallback(async (init?: RequestInit) => {
        const r = await fetch('/api/admin/survival/tickets', { credentials: 'include', cache: 'no-store', ...init })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setMsg(j.error ?? `HTTP ${r.status}`); return false }
        setD(j); return true
    }, [])
    useEffect(() => { void call() }, [call])
    if (!d) return <div className="text-white/40 text-xs">{msg ?? 'Loading prizes…'}</div>

    const live = d.prizes.filter((p) => p.active && p.weight > 0 && (p.stock === null || p.stock > 0) && (p.kind !== 'nft' || d.nfts.some((n) => n.prize_id === p.id && n.status === 'available')))
    const total = live.reduce((a, p) => a + p.weight, 0)
    const ed = (key: string, base: Prize) => draft[key] ?? { ...base, specText: JSON.stringify(base.spec ?? {}), stockText: base.stock === null ? '' : String(base.stock) }
    const set = (key: string, base: Prize, patch: Partial<Prize & { specText: string; stockText: string }>) => setDraft((x) => ({ ...x, [key]: { ...ed(key, base), ...patch } }))
    const save = async (key: string, p: Prize & { specText: string; stockText: string }) => {
        setMsg(null)
        const ok = await call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prize: { ...p, spec: p.specText, stock: p.stockText === '' ? null : p.stockText } }) })
        if (ok) { setDraft((x) => { const n = { ...x }; delete n[key]; return n }); setMsg(`${p.id} saved`) }
    }
    const input = 'bg-black/40 border border-white/10 rounded px-2 py-1 text-xs outline-none focus:border-[#3b82f6]'
    const rows: Array<[string, Prize]> = [...d.prizes.map((p) => [p.id, p] as [string, Prize]), ['__new', BLANK]]
    return (
        <div className="space-y-3">
            <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[1000px]">
                    <thead><tr className="text-white/30 text-[9px] uppercase tracking-widest text-left"><th className="py-1">Id</th><th>Label</th><th>Kind</th><th>What (JSON)</th><th>Weight</th><th>Chance</th><th>Stock</th><th>Drawn</th><th>On</th><th /></tr></thead>
                    <tbody>{rows.map(([key, base]) => {
                        const p = ed(key, base)
                        const inPlay = live.some((x) => x.id === p.id)
                        const chance = inPlay && total ? (p.weight / total) * 100 : 0
                        return (
                            <tr key={key} className="border-t border-white/5">
                                <td className="py-1.5 pr-2">{key === '__new' ? <input className={`${input} w-24 font-mono`} placeholder="new_prize" value={p.id} onChange={(e) => set(key, base, { id: e.target.value })} /> : <span className="font-mono">{p.id}</span>}</td>
                                <td className="pr-2"><input className={`${input} w-40`} value={p.label} onChange={(e) => set(key, base, { label: e.target.value })} /></td>
                                <td className="pr-2"><select className={input} value={p.kind} onChange={(e) => set(key, base, { kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></td>
                                <td className="pr-2"><input className={`${input} w-52 font-mono`} value={p.specText} onChange={(e) => set(key, base, { specText: e.target.value })} /></td>
                                <td className="pr-2"><input className={`${input} w-20`} type="number" min="0" value={p.weight} onChange={(e) => set(key, base, { weight: Number(e.target.value) })} /></td>
                                <td className="pr-2 font-mono text-white/70">{chance ? `${chance < 1 ? chance.toFixed(2) : chance.toFixed(1)}%` : '—'}</td>
                                <td className="pr-2">{p.kind === 'nft'
                                    ? <span className="text-white/50" title="NFT prizes drop by their pool of tokens below">{d.nfts.filter((n) => n.prize_id === p.id && n.status === 'available').length} in pool</span>
                                    : <input className={`${input} w-16`} placeholder="∞" value={p.stockText} onChange={(e) => set(key, base, { stockText: e.target.value })} />}</td>
                                <td className="pr-2 text-white/50">{d.drawn[p.id] ?? 0}</td>
                                <td className="pr-2"><input type="checkbox" checked={p.active} onChange={(e) => set(key, base, { active: e.target.checked })} /></td>
                                <td><button disabled={!draft[key]} onClick={() => void save(key, p)} className="flex items-center gap-1 px-2 py-1 rounded bg-[#3b82f6] text-[10px] font-black uppercase tracking-widest disabled:opacity-25">{key === '__new' ? <Plus className="h-3 w-3" /> : <Save className="h-3 w-3" />}{key === '__new' ? 'Add' : 'Save'}</button></td>
                            </tr>
                        )
                    })}</tbody>
                </table>
            </div>
            {msg && <div className="text-xs font-mono text-white/60">{msg}</div>}
            <NftPool d={d} call={call} />
            <div className="text-[10px] text-white/35">{d.totalDraws} tickets opened so far. Chance = weight ÷ the weights of everything on and in stock — the game shows players these same odds. Stock empty = unlimited.</div>
        </div>
    )
}
