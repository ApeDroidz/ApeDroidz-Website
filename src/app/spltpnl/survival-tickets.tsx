'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Plus, Save } from 'lucide-react'
import { CopyWallet } from './survival-players'

/**
 * The lucky ticket's prize table (owner, 24.09.2026). Chance = weight ÷ the sum of weights of the
 * prizes that are on and in stock — players see the same odds in the game before they pay.
 * Stock empty = unlimited; a number = that many left, it stops dropping at 0 (the droid starts at 0:
 * put the number of droids you actually hold for prizes). Won droids are sent by hand — mark them here.
 */
type Prize = { id: string; label: string; kind: string; spec: Record<string, unknown>; weight: number; stock: number | null; active: boolean; sort: number }
type Payload = { prizes: Prize[]; drawn: Record<string, number>; totalDraws: number; pendingNft: Array<{ id: string; wallet: string; created_at: string }>; recent: Array<{ id: string; wallet: string; prize: string; at: string; opened: boolean }> }
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

    const live = d.prizes.filter((p) => p.active && p.weight > 0 && (p.stock === null || p.stock > 0))
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
            {d.pendingNft.length > 0 && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 space-y-2">
                    <div className="text-xs font-black uppercase tracking-widest text-red-300">Droids to send</div>
                    {d.pendingNft.map((w) => (
                        <div key={w.id} className="flex items-center gap-3 text-xs">
                            <CopyWallet wallet={w.wallet} /><span className="text-white/40">{new Date(w.created_at).toLocaleString()}</span>
                            <button onClick={() => { const note = prompt('Which droid / tx hash?') ?? ''; void call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fulfil: w.id, note }) }) }}
                                className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/80 text-[10px] font-black uppercase tracking-widest"><Check className="h-3 w-3" /> Sent</button>
                        </div>
                    ))}
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[1000px]">
                    <thead><tr className="text-white/30 text-[9px] uppercase tracking-widest text-left"><th className="py-1">Id</th><th>Label</th><th>Kind</th><th>What (JSON)</th><th>Weight</th><th>Chance</th><th>Stock</th><th>Drawn</th><th>On</th><th /></tr></thead>
                    <tbody>{rows.map(([key, base]) => {
                        const p = ed(key, base)
                        const chance = p.active && p.weight > 0 && (p.stock === null || p.stock > 0) && total ? (p.weight / total) * 100 : 0
                        return (
                            <tr key={key} className="border-t border-white/5">
                                <td className="py-1.5 pr-2">{key === '__new' ? <input className={`${input} w-24 font-mono`} placeholder="new_prize" value={p.id} onChange={(e) => set(key, base, { id: e.target.value })} /> : <span className="font-mono">{p.id}</span>}</td>
                                <td className="pr-2"><input className={`${input} w-40`} value={p.label} onChange={(e) => set(key, base, { label: e.target.value })} /></td>
                                <td className="pr-2"><select className={input} value={p.kind} onChange={(e) => set(key, base, { kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></td>
                                <td className="pr-2"><input className={`${input} w-52 font-mono`} value={p.specText} onChange={(e) => set(key, base, { specText: e.target.value })} /></td>
                                <td className="pr-2"><input className={`${input} w-20`} type="number" min="0" value={p.weight} onChange={(e) => set(key, base, { weight: Number(e.target.value) })} /></td>
                                <td className="pr-2 font-mono text-white/70">{chance ? `${chance < 1 ? chance.toFixed(2) : chance.toFixed(1)}%` : '—'}</td>
                                <td className="pr-2"><input className={`${input} w-16`} placeholder="∞" value={p.stockText} onChange={(e) => set(key, base, { stockText: e.target.value })} /></td>
                                <td className="pr-2 text-white/50">{d.drawn[p.id] ?? 0}</td>
                                <td className="pr-2"><input type="checkbox" checked={p.active} onChange={(e) => set(key, base, { active: e.target.checked })} /></td>
                                <td><button disabled={!draft[key]} onClick={() => void save(key, p)} className="flex items-center gap-1 px-2 py-1 rounded bg-[#3b82f6] text-[10px] font-black uppercase tracking-widest disabled:opacity-25">{key === '__new' ? <Plus className="h-3 w-3" /> : <Save className="h-3 w-3" />}{key === '__new' ? 'Add' : 'Save'}</button></td>
                            </tr>
                        )
                    })}</tbody>
                </table>
            </div>
            {msg && <div className="text-xs font-mono text-white/60">{msg}</div>}
            <div className="text-[10px] text-white/35">{d.totalDraws} tickets opened so far. Chance = weight ÷ the weights of everything on and in stock — the game shows players these same odds. Stock empty = unlimited.</div>
        </div>
    )
}
