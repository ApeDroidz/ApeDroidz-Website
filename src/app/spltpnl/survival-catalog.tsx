'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Save } from 'lucide-react'

/**
 * The price list (owner, 25.09.2026: «цену забега хочу менять; подготовить систему для внутренних
 * покупок — пропуск сезона, доп. предметы, боксы»). One row per thing that can be bought. A change
 * applies to the next purchase; one already ordered keeps its price. Off = not sold.
 *   runs        → run credits (a continue also costs one run)
 *   season_pass → the PASS rail of the current season
 *   item        → grant {"kind":"servo","rarity":"epic"}
 *   box         → grant {"box":"basic","rolls":3} — contents rolled from the server's seed
 *   bundle      → grant {"coins":5000,"resources":{"scrap":50}}
 */
type Item = { sku: string; kind: string; title: string; description: string; price_ape: number; credits: number; mode: string; grant_spec: Record<string, unknown>; active: boolean; sort: number }
const KINDS = ['runs', 'season_pass', 'item', 'box', 'bundle', 'ticket']
const BLANK: Item = { sku: '', kind: 'box', title: '', description: '', price_ape: 1, credits: 0, mode: 'solo', grant_spec: {}, active: false, sort: 100 }

export function SurvivalCatalog() {
    const [items, setItems] = useState<Item[] | null>(null)
    const [draft, setDraft] = useState<Record<string, Item & { grantText: string }>>({})
    const [msg, setMsg] = useState<string | null>(null)
    const load = useCallback(async () => {
        const r = await fetch('/api/admin/survival/catalog', { credentials: 'include', cache: 'no-store' })
        const d = await r.json().catch(() => ({}))
        if (r.ok) setItems(d.items)
        else setMsg(d.error ?? `HTTP ${r.status}`)
    }, [])
    useEffect(() => { void load() }, [load])
    const edit = (it: Item) => draft[it.sku] ?? { ...it, grantText: JSON.stringify(it.grant_spec ?? {}) }
    const set = (sku: string, base: Item, patch: Partial<Item & { grantText: string }>) =>
        setDraft((d) => ({ ...d, [sku]: { ...(d[sku] ?? { ...base, grantText: JSON.stringify(base.grant_spec ?? {}) }), ...patch } }))
    const save = async (key: string, it: Item & { grantText: string }) => {
        setMsg(null)
        const r = await fetch('/api/admin/survival/catalog', {
            method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ item: { ...it, grant_spec: it.grantText } }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) { setMsg(`${it.sku || 'new item'}: ${d.error ?? r.status}`); return }
        setItems(d.items); setDraft((x) => { const n = { ...x }; delete n[key]; return n }); setMsg(`${it.sku} saved`)
    }
    if (!items) return <div className="text-white/40 text-xs">{msg ?? 'Loading prices…'}</div>
    const rows: Array<[string, Item]> = [...items.map((i) => [i.sku, i] as [string, Item]), ['__new', BLANK]]
    const input = 'bg-black/40 border border-white/10 rounded px-2 py-1 text-xs outline-none focus:border-[#3b82f6]'
    return (
        <div className="space-y-2">
            <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[1000px]">
                    <thead><tr className="text-white/30 text-[9px] uppercase tracking-widest text-left"><th className="py-1">SKU</th><th>Kind</th><th>Title</th><th>Price, APE</th><th>Runs</th><th>Pool</th><th>Grant (JSON)</th><th>On sale</th><th /></tr></thead>
                    <tbody>{rows.map(([key, base]) => {
                        const it = key === '__new' ? (draft.__new ?? { ...BLANK, grantText: '{}' }) : edit(base)
                        const dirty = !!draft[key]
                        return (
                            <tr key={key} className="border-t border-white/5 align-top">
                                <td className="py-1.5 pr-2">{key === '__new' ? <input className={`${input} w-28 font-mono`} placeholder="new_sku" value={it.sku} onChange={(e) => set(key, base, { sku: e.target.value })} /> : <span className="font-mono">{it.sku}</span>}</td>
                                <td className="pr-2">{key === '__new' ? <select className={input} value={it.kind} onChange={(e) => set(key, base, { kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select> : <span className="text-white/50">{it.kind}</span>}</td>
                                <td className="pr-2"><input className={`${input} w-40`} value={it.title} onChange={(e) => set(key, base, { title: e.target.value })} /></td>
                                <td className="pr-2"><input className={`${input} w-20 font-black`} type="number" min="0.000001" step="0.1" value={it.price_ape} onChange={(e) => set(key, base, { price_ape: Number(e.target.value) })} /></td>
                                <td className="pr-2"><input className={`${input} w-14`} type="number" min="0" value={it.credits} disabled={it.kind !== 'runs'} onChange={(e) => set(key, base, { credits: Number(e.target.value) })} /></td>
                                <td className="pr-2"><select className={input} value={it.mode} onChange={(e) => set(key, base, { mode: e.target.value })}><option value="solo">solo</option><option value="coop">co-op</option></select></td>
                                <td className="pr-2"><input className={`${input} w-56 font-mono`} value={it.grantText} disabled={it.kind === 'runs' || it.kind === 'season_pass'} onChange={(e) => set(key, base, { grantText: e.target.value })} /></td>
                                <td className="pr-2"><input type="checkbox" checked={it.active} onChange={(e) => set(key, base, { active: e.target.checked })} /></td>
                                <td><button disabled={!dirty} onClick={() => void save(key, it)} className="flex items-center gap-1 px-2 py-1 rounded bg-[#3b82f6] text-[10px] font-black uppercase tracking-widest disabled:opacity-25">{key === '__new' ? <Plus className="h-3 w-3" /> : <Save className="h-3 w-3" />}{key === '__new' ? 'Add' : 'Save'}</button></td>
                            </tr>
                        )
                    })}</tbody>
                </table>
            </div>
            {msg && <div className="text-xs font-mono text-white/60">{msg}</div>}
            <div className="text-[10px] text-white/35">A price change applies to the next purchase. «Runs» — how many run credits it gives (a continue costs one run). The pool is where half of the payment goes.</div>
        </div>
    )
}
