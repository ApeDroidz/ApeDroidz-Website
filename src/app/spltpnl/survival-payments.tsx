'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCcw, Search } from 'lucide-react'
import { CopyWallet } from './survival-players'
import { SurvivalCatalog } from './survival-catalog'
import { SurvivalTickets } from './survival-tickets'

/**
 * Droidz Survival → Payments (owner, 24.09.2026): every payment, and what the money did —
 * totals by mode / platform / item, APE per day, each pool as the ledger books it next to what its
 * vault actually holds on chain, credits issued and spent, orders stuck in pending, attempts the
 * server refused, and a «Recheck tx» for support (it books only what the cashier's event shows).
 */

type Sum = { count: number; ape: number; pool: number }
type Payload = {
    generatedAt: string
    config: { cashier: string | null; paidRuns: boolean; payForReal: boolean; public: boolean; coopOpen: boolean; skus: Record<string, { priceApe: number; credits: number; label: string }>; vaults: Record<string, string> }
    totals: { all: Sum; day: Sum; week: Sum; byMode: Record<string, Sum>; byPlatform: Record<string, Sum>; bySku: Record<string, Sum>; viaHub: Sum }
    days: Array<{ day: string; solo: number; coop: number; count: number }>
    pools: Record<string, number>
    balances: Record<string, number | null>
    credits: { issued: { solo: number; coop: number }; spent: { solo: number; coop: number } }
    orders: { total: number; pending: number; paid: number; stuck: Array<{ id: string; wallet: string; sku: string; mode: string; platform: string; price_ape: number; created_at: string }> }
    payments: Array<{ tx_hash: string; wallet: string; name: string | null; amount_ape: number; to_pool_ape: number | null; mode: string | null; platform: string | null; viaHub: boolean; credits_granted: number; created_at: string }>
    refused: Array<{ at: string; wallet: string | null; kind: string; message: string; data: Record<string, unknown> }>
    problems: string[]
}

// Validated for the dark surface (dataviz validate_palette.js --mode dark): all checks pass.
const SOLO = '#3b82f6'
const COOP = '#c4841c'

const ape = (n: number | null | undefined, d = 2) => (n == null ? '—' : `${Number(n).toLocaleString(undefined, { maximumFractionDigits: d })} APE`)
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`

async function api(url: string, init?: RequestInit) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...init })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
    return data
}

function Tile({ k, v, sub, accent }: { k: string; v: string; sub?: string; accent?: string }) {
    return (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-[9px] font-black uppercase tracking-widest text-white/35">{k}</div>
            <div className={`mt-1 text-xl font-black ${accent ?? 'text-white'}`}>{v}</div>
            {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
        </div>
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

/** APE per day, stacked solo / co-op. One axis, thin bars, a 2px gap, hover tooltip per day. */
function DailyChart({ days }: { days: Payload['days'] }) {
    const [hover, setHover] = useState<number | null>(null)
    const W = 900, H = 180, PAD_L = 44, PAD_B = 22, PAD_T = 10
    const max = Math.max(1, ...days.map((d) => d.solo + d.coop))
    const step = (W - PAD_L) / days.length
    const bw = Math.max(4, step - 6)
    const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / max)
    const ticks = [0, max / 2, max]
    const h = hover !== null ? days[hover] : null
    return (
        <div className="relative">
            <div className="flex gap-4 text-[10px] text-white/60 mb-2">
                <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SOLO }} />Solo</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COOP }} />Co-op</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="APE paid per day, last 30 days, solo and co-op">
                {ticks.map((t) => (
                    <g key={t}>
                        <line x1={PAD_L} x2={W} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.08)" />
                        <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.4)">{t.toFixed(t >= 10 ? 0 : 1)}</text>
                    </g>
                ))}
                {days.map((d, i) => {
                    const x = PAD_L + i * step + (step - bw) / 2
                    const soloTop = y(d.solo), coopTop = y(d.solo + d.coop), base = y(0)
                    return (
                        <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                            <rect x={PAD_L + i * step} y={PAD_T} width={step} height={H - PAD_T - PAD_B} fill="transparent" />
                            {d.solo > 0 && <rect x={x} y={soloTop} width={bw} height={Math.max(1, base - soloTop)} rx={d.coop > 0 ? 0 : 3} fill={SOLO} opacity={hover === null || hover === i ? 1 : 0.5} />}
                            {d.coop > 0 && <rect x={x} y={coopTop} width={bw} height={Math.max(1, soloTop - coopTop - (d.solo > 0 ? 2 : 0))} rx={3} fill={COOP} opacity={hover === null || hover === i ? 1 : 0.5} />}
                            {(i % 5 === 0 || i === days.length - 1) && <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.35)">{d.day.slice(5)}</text>}
                        </g>
                    )
                })}
            </svg>
            {h && (
                <div className="absolute top-6 right-2 rounded-lg border border-white/10 bg-black/90 px-3 py-2 text-[11px] pointer-events-none">
                    <div className="font-black">{h.day}</div>
                    <div className="text-white/70">Solo {ape(h.solo)} · Co-op {ape(h.coop)}</div>
                    <div className="text-white/40">{h.count} payment{h.count === 1 ? '' : 's'}</div>
                </div>
            )}
        </div>
    )
}

export function SurvivalPayments() {
    const [d, setD] = useState<Payload | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [q, setQ] = useState('')
    const [tx, setTx] = useState('')
    const [recheck, setRecheck] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try { setD(await api('/api/admin/survival/payments')) } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
    }, [])
    useEffect(() => { void load() }, [load])

    const doRecheck = async () => {
        setRecheck('checking…')
        try {
            const r = await api('/api/admin/survival/payments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: tx }) })
            setRecheck((r.results as Array<{ orderId: string; state: string }>).map((x) => `${x.orderId ? x.orderId.slice(0, 8) + ': ' : ''}${x.state}`).join(' · '))
            void load()
        } catch (e) { setRecheck((e as Error).message) }
    }

    if (!d) return <div className="flex items-center gap-2 text-white/40 text-sm py-10">{error ? <span className="text-red-400">{error}</span> : <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>}</div>
    const t = d.totals
    const needle = q.trim().toLowerCase()
    const list = d.payments.filter((p) => !needle || p.wallet.includes(needle) || p.tx_hash.includes(needle) || (p.name ?? '').toLowerCase().includes(needle))
    const outstanding = { solo: d.credits.issued.solo - d.credits.spent.solo, coop: d.credits.issued.coop - d.credits.spent.coop }

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2 text-[9px] font-black uppercase tracking-widest">
                    <span className={`px-2 py-1 rounded ${d.config.cashier ? 'bg-emerald-500/15 text-emerald-300' : 'bg-orange-500/15 text-orange-300'}`}>cashier {d.config.cashier ? short(d.config.cashier) : 'not deployed'}</span>
                    <span className={`px-2 py-1 rounded ${d.config.paidRuns ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-white/40'}`}>paid runs {d.config.paidRuns ? 'on' : 'off'}</span>
                    <span className={`px-2 py-1 rounded ${d.config.payForReal ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-white/40'}`}>real payments {d.config.payForReal ? 'on' : 'stub'}</span>
                    <span className={`px-2 py-1 rounded ${d.config.public ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-white/40'}`}>{d.config.public ? 'public' : 'beta list'}</span>
                </div>
                <button onClick={() => void load()} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white"><RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
            </div>
            {d.problems.length > 0 && <div className="text-orange-400 text-xs font-mono">Some queries failed: {d.problems.join(' · ')}</div>}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Tile k="Paid in (all time)" v={ape(t.all.ape)} sub={`${t.all.count} payments`} accent="text-[#3b82f6]" />
                <Tile k="Last 24h" v={ape(t.day.ape)} sub={`${t.day.count} payments`} />
                <Tile k="Last 7 days" v={ape(t.week.ape)} sub={`${t.week.count} payments`} />
                <Tile k="To the pools" v={ape(t.all.pool)} sub="half of what arrived" accent="text-emerald-400" />
                <Tile k="Via Otherside Hub" v={ape(t.viaHub.ape)} sub={`${t.viaHub.count} payments · site ${t.byPlatform.site?.count ?? 0}`} />
                <Tile k="Orders" v={`${d.orders.paid} / ${d.orders.total}`} sub={`paid / made · ${d.orders.pending} pending`} />
            </div>

            <Box title="Prices" hint="what can be bought — edit and save">
                <SurvivalCatalog />
            </Box>

            <Box title="Lucky ticket" hint="prizes, odds and stock — the draw happens on the server">
                <SurvivalTickets />
            </Box>

            <Box title="APE paid per day" hint="last 30 days, by mode">
                <DailyChart days={d.days} />
            </Box>

            <div className="grid lg:grid-cols-3 gap-4">
                {(['solo', 'coop'] as const).map((m) => (
                    <Box key={m} title={`${m === 'solo' ? 'Solo' : 'Co-op'} pool`} hint={short(d.config.vaults[m])}>
                        <div className="space-y-1 text-xs">
                            <div className="flex justify-between"><span className="text-white/50">Booked this season</span><span className="font-black">{ape(d.pools[`${m}_pool`] ?? 0, 4)}</span></div>
                            <div className="flex justify-between"><span className="text-white/50">Vault holds on chain</span><span className="font-black">{ape(d.balances[m], 4)}</span></div>
                            <div className="flex justify-between"><span className="text-white/50">Paid in ({m})</span><span>{ape(t.byMode[m]?.ape ?? 0)} · {t.byMode[m]?.count ?? 0}</span></div>
                            <div className="flex justify-between"><span className="text-white/50">Run credits: bought / played / left</span><span>{d.credits.issued[m]} / {d.credits.spent[m]} / {outstanding[m]}</span></div>
                        </div>
                    </Box>
                ))}
                <Box title="Team wallet" hint={short(d.config.vaults.team)}>
                    <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-white/50">Holds on chain</span><span className="font-black">{ape(d.balances.team, 4)}</span></div>
                        {Object.entries(t.bySku).map(([sku, s]) => (
                            <div key={sku} className="flex justify-between"><span className="text-white/50">{d.config.skus[sku]?.label ?? sku}</span><span>{s.count} · {ape(s.ape)}</span></div>
                        ))}
                    </div>
                </Box>
            </div>

            <Box title="Recheck a transaction" hint="support: books only what the cashier's Paid event shows">
                <div className="flex flex-col sm:flex-row gap-2">
                    <input value={tx} onChange={(e) => setTx(e.target.value)} placeholder="0x… transaction hash" className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-[#3b82f6]" />
                    <button onClick={() => void doRecheck()} disabled={!/^0x[0-9a-fA-F]{64}$/.test(tx.trim())} className="px-3 py-2 rounded-lg bg-[#3b82f6] text-[10px] font-black uppercase tracking-widest disabled:opacity-40">Recheck tx</button>
                </div>
                {recheck && <div className="mt-2 text-xs font-mono text-white/70">{recheck}</div>}
            </Box>

            <div className="grid lg:grid-cols-2 gap-4">
                <Box title="Stuck orders" hint="pending over 30 min, last 7 days">
                    {d.orders.stuck.length === 0 ? <div className="text-white/30 text-xs">None.</div> : (
                        <div className="max-h-64 overflow-auto divide-y divide-white/5 text-xs">{d.orders.stuck.map((o) => (
                            <div key={o.id} className="py-1 flex gap-2"><span className="font-mono text-white/30 w-36 flex-shrink-0">{when(o.created_at)}</span><span className="font-mono">{short(o.wallet)}</span><span className="text-white/50">{o.sku} · {o.mode} · {o.platform} · {o.price_ape} APE</span></div>
                        ))}</div>
                    )}
                </Box>
                <Box title="Refused" hint="attempts the server did not credit">
                    {d.refused.length === 0 ? <div className="text-white/30 text-xs">None.</div> : (
                        <div className="max-h-64 overflow-auto divide-y divide-white/5 text-xs">{d.refused.map((e, i) => (
                            <div key={i} className="py-1 flex gap-2"><span className="font-mono text-white/30 w-36 flex-shrink-0">{when(e.at)}</span><span className="text-orange-400 w-28 flex-shrink-0">{e.kind.replace('pay.', '')}</span><span className="font-mono text-white/50 truncate" title={JSON.stringify(e.data)}>{e.wallet ? short(e.wallet) : '—'} · {e.message}</span></div>
                        ))}</div>
                    )}
                </Box>
            </div>

            <Box title="All payments" hint={`${d.payments.length}, newest first`}>
                <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 mb-2">
                    <Search className="h-3.5 w-3.5 text-white/30" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="wallet, name or tx hash…" className="flex-1 bg-transparent text-xs outline-none" />
                </div>
                <div className="overflow-auto max-h-[60vh]">
                    <table className="w-full text-xs min-w-[900px]">
                        <thead><tr className="text-white/30 text-[9px] uppercase tracking-widest"><th className="text-left py-1">When</th><th className="text-left">Player</th><th className="text-left">Mode · where</th><th className="text-right">Paid</th><th className="text-right">To pool</th><th className="text-right">Runs</th><th className="text-left pl-3">Tx</th></tr></thead>
                        <tbody>{list.map((p) => (
                            <tr key={p.tx_hash} className="border-t border-white/5">
                                <td className="py-1 font-mono text-white/40 whitespace-nowrap">{when(p.created_at)}</td>
                                <td><CopyWallet wallet={p.wallet} />{p.name ? <span className="text-white/40"> ({p.name})</span> : null}</td>
                                <td className="text-white/60"><span style={{ color: p.mode === 'coop' ? COOP : SOLO }}>■</span> {p.mode ?? 'solo'} · {p.platform ?? 'site'}{p.viaHub ? ' (Hub)' : ''}</td>
                                <td className="text-right font-black">{ape(p.amount_ape, 4)}</td>
                                <td className="text-right text-emerald-400">{ape(p.to_pool_ape, 4)}</td>
                                <td className="text-right">{p.credits_granted}</td>
                                <td className="pl-3"><a className="font-mono text-sky-400/80 hover:text-sky-300" href={`https://apescan.io/tx/${p.tx_hash}`} target="_blank" rel="noreferrer">{p.tx_hash.slice(0, 12)}…</a></td>
                            </tr>
                        ))}</tbody>
                    </table>
                    {list.length === 0 && <div className="text-white/30 text-xs p-3">No payments{needle ? ' match' : ' yet'}.</div>}
                </div>
            </Box>
        </div>
    )
}
