'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, AlertTriangle, BarChart3, Check, Coins, ExternalLink, Gamepad2, Link2 as LinkIcon, Loader2, LogOut, Package, Pencil, Plus, RefreshCcw, Search, Sparkles, Target, Trash2, Users, X } from 'lucide-react'

// ── Types (loose — coming from server JSON) ───────────────────────────────────

type Window = '24h' | '7d' | '30d' | 'all'

const TABS = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'cards', label: 'Cards', icon: Gamepad2 },
    { id: 'profit', label: 'Profit', icon: Coins },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'prizes', label: 'Prizes', icon: Package },
    { id: 'quests', label: 'Quests', icon: Target },
] as const
type TabId = typeof TABS[number]['id']

// Призы группируем по типу выдачи: у NFT есть склад и он может кончиться,
// у токенов и шардов — нет. Порядок от «дорогого» к «расходному».
const GROUPS = [
    { type: 'nft', label: 'NFT prizes' },
    { type: 'token', label: 'APE' },
    { type: 'shard', label: 'Shards' },
] as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, digits = 0): string {
    if (n == null || !Number.isFinite(Number(n))) return '—'
    return new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(Number(n))
}
function shortWallet(w: string | null | undefined): string {
    if (!w) return '—'
    const s = String(w)
    return `${s.slice(0, 6)}…${s.slice(-4)}`
}

async function jsonFetch(url: string, init?: RequestInit) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...init })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
    return data
}

// ── Layout primitives ─────────────────────────────────────────────────────────

function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={`bg-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-5 ${className}`}>
            {title && <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40 mb-3">{title}</h3>}
            {children}
        </div>
    )
}

function Stat({ label, value, hint, accent = 'white' }: { label: string; value: React.ReactNode; hint?: string; accent?: 'white' | 'blue' | 'green' | 'orange' | 'red' }) {
    const colors: Record<string, string> = {
        white: 'text-white',
        blue: 'text-[#3b82f6]',
        green: 'text-emerald-400',
        orange: 'text-orange-400',
        red: 'text-red-400',
    }
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/40">{label}</span>
            <span className={`text-2xl sm:text-3xl font-black tracking-tight ${colors[accent]}`}>{value}</span>
            {hint && <span className="text-[10px] text-white/30 font-mono">{hint}</span>}
        </div>
    )
}

function Bar({ label, value, max, accent = '#3b82f6' }: { label: string; value: number; max: number; accent?: string }) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
    return (
        <div className="flex items-center gap-3 text-[11px]">
            <span className="w-32 truncate text-white/60">{label}</span>
            <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
            </div>
            <span className="w-12 text-right text-white/40 font-mono">{value}</span>
        </div>
    )
}

/**
 * Pure SVG sparkline — no chart library. Accepts an array of numbers and
 * renders a smooth line + faint area fill. Works at any size.
 */
function Sparkline({ data, height = 50, accent = '#3b82f6', label }: { data: number[]; height?: number; accent?: string; label?: string }) {
    if (!data || data.length < 2) {
        return <div className="text-[10px] text-white/20 italic">No data</div>
    }
    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const range = Math.max(1, max - min)
    const w = 100   // viewBox width — scales via CSS
    const stepX = w / (data.length - 1)
    const pts = data.map((v, i) => {
        const x = i * stepX
        const y = height - ((v - min) / range) * (height - 4) - 2
        return [x, y] as const
    })
    const linePath = pts.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(' ')
    const areaPath = `${linePath} L${pts[pts.length - 1][0]},${height} L0,${height} Z`
    return (
        <div className="flex flex-col gap-1">
            {label && <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-white/30 font-bold"><span>{label}</span><span className="font-mono">{data[data.length - 1]}</span></div>}
            <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full h-12">
                <defs>
                    <linearGradient id={`sg-${accent}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={accent} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={accent} stopOpacity="0" />
                    </linearGradient>
                </defs>
                <path d={areaPath} fill={`url(#sg-${accent})`} />
                <path d={linePath} fill="none" stroke={accent} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
        </div>
    )
}

/** Vertical-bar histogram — reads array of {label, value}. */
function Histogram({ data, accent = '#3b82f6', height = 80, formatVal }: { data: { label: string; value: number }[]; accent?: string; height?: number; formatVal?: (v: number) => string }) {
    if (!data || data.length === 0) return <p className="text-xs text-white/30">No data</p>
    const max = Math.max(...data.map(d => d.value), 1)
    return (
        <div className="flex items-end gap-1" style={{ height }}>
            {data.map((d, i) => {
                const h = max > 0 ? (d.value / max) * (height - 18) : 0
                return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 group cursor-default">
                        <span className="text-[8px] text-white/50 font-mono opacity-0 group-hover:opacity-100 transition-opacity">{formatVal ? formatVal(d.value) : d.value}</span>
                        <div className="w-full rounded-t transition-colors" style={{ height: `${Math.max(2, h)}px`, background: accent, opacity: 0.6 + (d.value / max) * 0.4 }} title={`${d.label}: ${d.value}`} />
                        <span className="text-[8px] text-white/30 font-mono truncate w-full text-center">{d.label}</span>
                    </div>
                )
            })}
        </div>
    )
}

function Loading() {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>
}
function ErrorBox({ msg }: { msg: string }) {
    return <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">{msg}</div>
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab() {
    const [data, setData] = useState<any>(null)
    const [health, setHealth] = useState<any>(null)
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        setLoading(true); setErr('')
        try {
            // Health слит сюда же: отдельная вкладка заставляла ходить за
            // тем, на что и так надо реагировать в первую очередь.
            const [o, h] = await Promise.all([
                jsonFetch('/api/admin/stats/overview'),
                jsonFetch('/api/admin/health').catch(() => null),
            ])
            setData(o); setHealth(h)
        }
        catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])
    useEffect(() => { load() }, [load])

    if (loading && !data) return <Loading />
    if (err) return <ErrorBox msg={err} />
    if (!data) return null

    const lt = data.lifetime ?? {}
    const trends = data.trends ?? { dau: [], signups: [] }
    const cardsDauSeries = (trends.dau ?? []).map((d: any) => Number(d.cards_dau))
    const revSeries = (trends.dau ?? []).map((d: any) => Number(d.ape_revenue))
    const last7Signups = (trends.signups ?? []).slice(-7).reduce((s: number, d: any) => s + Number(d.signups), 0)

    const alerts = health?.alerts ?? []
    const critical = alerts.filter((a: any) => a.severity === 'critical')
    const vault = health?.stats?.prizeVault
    const vaultApe = vault && !('error' in vault) ? Number(vault.ape) : null
    const vaultLow = vaultApe != null && vault?.maxPrize > 0 && vaultApe < vault.maxPrize * 5

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/30">{new Date(data.generatedAt).toLocaleString()}</span>
                <button onClick={load} className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-[#666666] hover:text-white">
                    <RefreshCcw size={12} /> Refresh
                </button>
            </div>

            {/* Требует действия — выше всего остального */}
            {alerts.length > 0 && (
                <div className="flex flex-col gap-2">
                    {alerts.map((a: any, i: number) => <AlertCard key={a.kind ?? i} alert={a} onResolved={load} />)}
                </div>
            )}

            {/* Состояние сайта и призового волта в одной строке */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Card className={data.maintenance ? 'border-orange-500/30 bg-orange-500/5' : ''}>
                    <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${data.maintenance ? 'bg-orange-400 animate-pulse' : 'bg-emerald-400'}`} />
                        <span className="text-sm font-black uppercase tracking-wider">
                            {data.maintenance ? 'Maintenance mode' : 'Site is live'}
                        </span>
                        <span className="text-[10px] text-white/40 ml-auto font-mono">
                            {data.maintenance ? '/coming-soon is shown' : 'public access'}
                        </span>
                    </div>
                </Card>
                <Card className={vaultApe != null && vaultLow ? 'border-red-500/30 bg-red-500/5' : ''}>
                    <div className="flex items-center gap-3">
                        <Coins size={14} className={vaultLow ? 'text-red-400' : 'text-white/40'} />
                        <span className="text-sm font-black uppercase tracking-wider">
                            {vaultApe != null ? `${fmt(vaultApe, 2)} APE` : '—'}
                        </span>
                        <span className="text-[10px] text-white/40 ml-auto font-mono">
                            prize vault{vault?.maxPrize ? ` · top prize ${vault.maxPrize}` : ''}
                        </span>
                    </div>
                </Card>
            </div>

            {data.migrationNeeded && data.migrationNeeded.length > 0 && (
                <Card className="border-red-500/40 bg-red-500/10">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <h3 className="text-sm font-black uppercase tracking-wider text-red-400 mb-1">SQL migration not applied</h3>
                            <p className="text-xs text-white/70">
                                Analytics RPCs are missing — totals and charts stay empty until you run{' '}
                                <code className="font-mono text-[10px] bg-black/40 px-1.5 py-0.5 rounded">supabase/migrations/20260428_admin_analytics.sql</code>
                            </p>
                            <p className="text-[10px] text-white/40 font-mono mt-2">Missing: {data.migrationNeeded.join(', ')}</p>
                        </div>
                    </div>
                </Card>
            )}

            {/* За сутки — то, по чему видно, живёт ли игра */}
            <div>
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-2">Last 24 hours</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card><Stat label="Spins" value={fmt(data.cards.playsToday)} hint={`${fmt(data.cards.plays7d)} in 7d`} /></Card>
                    <Card><Stat label="Revenue" value={`${fmt(data.cards.revenueApeToday, 2)} APE`} hint={`${fmt(data.cards.ticketsBoughtToday)} purchases`} accent="green" /></Card>
                    <Card>
                        <Stat
                            label="Failed payouts"
                            value={fmt(health?.stats?.cardsErrors24hCount ?? 0)}
                            hint={(health?.stats?.cardsErrors24hCount ?? 0) > 0 ? 'see alerts above' : 'all delivered'}
                            accent={(health?.stats?.cardsErrors24hCount ?? 0) > 0 ? 'red' : 'green'}
                        />
                    </Card>
                    <Card><Stat label="New players" value={fmt(last7Signups)} hint="in 7d" accent="blue" /></Card>
                </div>
            </div>

            {/* Два графика: игроки и деньги. Остальные ничего не решали. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Card>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-3">Players per day · 30d</h3>
                    <Sparkline data={cardsDauSeries} accent="#3b82f6" />
                </Card>
                <Card>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-3">Revenue, APE · 30d</h3>
                    <Sparkline data={revSeries} accent="#10b981" />
                </Card>
            </div>

            {/* Итоги за всё время */}
            <div>
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-2">All time</h3>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <Card><Stat label="Spins" value={fmt(lt.total_card_plays)} hint={`${fmt(lt.total_card_errors)} errors`} /></Card>
                    <Card><Stat label="Revenue" value={`${fmt(lt.total_card_revenue, 2)} APE`} hint={`${fmt(lt.total_card_purchases)} purchases`} accent="green" /></Card>
                    <Card><Stat label="NFTs handed out" value={fmt(lt.total_nfts_claimed)} accent="orange" /></Card>
                </div>
            </div>
        </div>
    )
}

// ── Tab: Cards ────────────────────────────────────────────────────────────────

/**
 * Glitch Cards economics. Приход — APE за билеты, расход — выплаченные APE
 * плюс себестоимость выданных NFT. Батарейки и шарды мы чеканим сами, у них
 * себестоимости нет, поэтому в расход они не идут.
 */
function ProfitPanel() {
    const [d, setD] = useState<any>(null)
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        (async () => {
            try { setD(await jsonFetch('/api/admin/stats/profit')) }
            catch (e: any) { setErr(e.message) }
            finally { setLoading(false) }
        })()
    }, [])

    if (loading) return <Loading />
    if (err) return <ErrorBox msg={err} />
    if (!d) return null

    const t = d.totals
    const c = d.coverage
    const margin = t.spent > 0 ? (t.profit / t.spent * 100) : 0

    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card><Stat label="Players paid in" value={`${fmt(t.spent, 0)} APE`} hint={`${fmt(t.tickets)} tickets`} accent="green" /></Card>
                <Card><Stat label="APE paid out" value={`${fmt(t.apeWon, 0)} APE`} hint={`over ${fmt(t.plays)} spins`} accent="orange" /></Card>
                <Card><Stat label="NFT cost" value={`${fmt(t.nftCost, 0)} APE`} hint={`${fmt(t.nftWon)} handed out`} accent="orange" /></Card>
                <Card>
                    <Stat
                        label="Profit"
                        value={`${t.profit >= 0 ? '' : '−'}${fmt(Math.abs(t.profit), 0)} APE`}
                        hint={`margin ${margin.toFixed(0)}%`}
                        accent={t.profit >= 0 ? 'green' : 'red'}
                    />
                </Card>
            </div>

            {c.unpriced > 0 && (
                <Card className="border-orange-500/30 bg-orange-500/5">
                    <p className="text-xs text-white/70">
                        <span className="font-mono text-orange-400">{c.unpriced}</span> of {c.claimedNfts} handed-out NFTs have no acquisition price yet — the cost side is understated by exactly that much, so the profit above reads higher than it is. Prices are pulled in <span className="text-white">Prizes → Stock</span>.
                    </p>
                </Card>
            )}

            <Card>
                <h3 className="text-xs font-black uppercase tracking-widest mb-3">By player · top 100 by spend</h3>
                <Table
                    headers={['Wallet', 'Spins', 'Tickets', 'Paid in', 'Won APE', 'NFTs', 'NFT cost', 'Our profit']}
                    rows={d.wallets.map((w: any) => [
                        <span key="w" className="font-mono text-[10px]">{w.wallet.slice(0, 10)}…{w.wallet.slice(-4)}</span>,
                        fmt(w.plays),
                        fmt(w.tickets),
                        <span key="s" className="font-mono text-emerald-400">{fmt(w.spent, 0)}</span>,
                        <span key="a" className="font-mono text-orange-400">{fmt(w.apeWon, 0)}</span>,
                        fmt(w.nftWon),
                        <span key="c" className="font-mono text-white/50">{w.nftCost > 0 ? fmt(w.nftCost, 0) : '—'}</span>,
                        <span key="p" className={`font-mono font-bold ${w.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(w.profit, 0)}</span>,
                    ])}
                />
            </Card>
        </div>
    )
}

function CardsTab() {
    const [win, setWin] = useState<Window>('24h')
    const [data, setData] = useState<any>(null)
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)
    const load = useCallback(async () => {
        setLoading(true); setErr('')
        try { setData(await jsonFetch(`/api/admin/stats/cards?window=${win}`)) }
        catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [win])
    useEffect(() => { load() }, [load])

    return (
        <div className="flex flex-col gap-4">
            <WindowSwitcher value={win} onChange={setWin} onRefresh={load} />
            {loading && !data ? <Loading /> : err ? <ErrorBox msg={err} /> : data && (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Card><Stat label="Plays" value={fmt(data.playsTotal)} /></Card>
                        <Card><Stat label="Unique players" value={fmt(data.uniquePlayers)} accent="blue" /></Card>
                        <Card><Stat label="Tickets bought" value={fmt(data.ticketsBought)} hint={`${fmt(data.apeRevenue, 2)} APE`} accent="green" /></Card>
                        <Card><Stat label="XP distributed" value={fmt(data.xpDistributed)} hint={`${fmt(data.errorsCount)} errors`} accent={data.errorsCount > 5 ? 'red' : 'white'} /></Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <Card title="Prize drop count">
                            <div className="flex flex-col gap-2 mt-2">
                                {(!data.prizeDistribution || data.prizeDistribution.length === 0) && <p className="text-xs text-white/30">No data</p>}
                                {(data.prizeDistribution ?? []).slice(0, 12).map((row: any) => (
                                    <Bar key={row.prize_type_id} label={row.prize_type_id} value={Number(row.drops)} max={Number(data.prizeDistribution[0]?.drops ?? 1)} />
                                ))}
                            </div>
                        </Card>

                        <Card title="Top NFT winners">
                            <div className="flex flex-col gap-2 mt-2">
                                {data.topWinners.length === 0 && <p className="text-xs text-white/30">No NFT prizes claimed in this window</p>}
                                {data.topWinners.map((w: any, i: number) => (
                                    <div key={i} className="flex items-center gap-3 text-xs">
                                        {w.image_url && <img src={w.image_url} alt="" className="w-8 h-8 rounded object-cover" />}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-white font-bold truncate">{w.name || 'NFT'}</div>
                                            <div className="text-white/40 font-mono text-[10px]">{shortWallet(w.winner_wallet)} · #{w.token_id}</div>
                                        </div>
                                        <span className="text-white/30 font-mono text-[10px]">{w.won_at && new Date(w.won_at).toLocaleDateString()}</span>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </div>

                    {/* ── Drop-rate fairness — actual vs configured ─────── */}
                    {data.fairness && data.fairness.length > 0 && (
                        <Card title="Drop-rate fairness — observed % vs configured %" className="border-purple-500/20">
                            <div className="overflow-x-auto -mx-2 px-2">
                                <table className="w-full text-[11px]">
                                    <thead>
                                        <tr className="text-left">
                                            <th className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 pb-2 px-2">Prize</th>
                                            <th className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 pb-2 px-2 text-right">Drops</th>
                                            <th className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 pb-2 px-2 text-right">Configured</th>
                                            <th className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 pb-2 px-2 text-right">Observed</th>
                                            <th className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 pb-2 px-2 text-right">Δ</th>
                                            <th className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 pb-2 px-2">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.fairness.map((p: any) => {
                                            const absDelta = Math.abs(p.delta)
                                            const ok = !p.isActive ? 'inactive' : absDelta < 1 ? 'good' : absDelta < 3 ? 'fair' : 'check'
                                            const color = ok === 'good' ? 'text-emerald-400' : ok === 'fair' ? 'text-yellow-400' : ok === 'check' ? 'text-red-400' : 'text-white/30'
                                            return (
                                                <tr key={p.id} className="border-t border-white/5">
                                                    <td className="px-2 py-2 align-middle"><div className="font-mono text-xs">{p.id}</div><div className="text-[10px] text-white/40">{p.name}</div></td>
                                                    <td className="px-2 py-2 align-middle text-right font-mono">{fmt(p.observedDrops)}</td>
                                                    <td className="px-2 py-2 align-middle text-right font-mono text-white/60">{p.configuredPct.toFixed(2)}%</td>
                                                    <td className="px-2 py-2 align-middle text-right font-mono">{p.observedPct.toFixed(2)}%</td>
                                                    <td className={`px-2 py-2 align-middle text-right font-mono ${p.delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{p.delta >= 0 ? '+' : ''}{p.delta.toFixed(2)}</td>
                                                    <td className={`px-2 py-2 align-middle text-[9px] font-black uppercase tracking-widest ${color}`}>{ok}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-[9px] text-white/30 mt-3 font-mono">good = within 1pp · fair = within 3pp · check = larger drift (small samples skew this — trust 'all' window with 1000+ drops)</p>
                        </Card>
                    )}

                    {/* ── Hourly distribution (last 7d) ─────────────────── */}
                    {data.hourlyDistribution && data.hourlyDistribution.length > 0 && (
                        <Card title="Hourly play distribution (last 7d, UTC)">
                            <Histogram
                                data={data.hourlyDistribution.map((h: any) => ({ label: String(h.hour_utc).padStart(2, '0'), value: Number(h.cards_plays) }))}
                                accent="#3b82f6"
                                height={100}
                            />
                            <p className="text-[9px] text-white/30 mt-2 font-mono">Hover bars for exact counts. UTC. Cards plays only.</p>
                        </Card>
                    )}

                    <Card title="Recent activity">
                        <Table headers={['Wallet', 'Prize', 'Status', 'When']} rows={data.recentActivity.slice(0, 30).map((r: any) => [
                            shortWallet(r.wallet_address),
                            r.prize_type_id || '—',
                            <span key="s" className={r.status === 'error' ? 'text-red-400' : r.status === 'success' ? 'text-emerald-400' : 'text-white/40'}>{r.status}</span>,
                            new Date(r.created_at).toLocaleString(),
                        ])} />
                    </Card>
                </>
            )}
        </div>
    )
}

// ── Tab: Prizes ───────────────────────────────────────────────────────────────

// ── Tab: Season ───────────────────────────────────────────────────────────────

// ── Tab: Prizes ───────────────────────────────────────────────────────────────

function PrizesTab() {
    const [prizes, setPrizes] = useState<any[]>([])
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [showImport, setShowImport] = useState(false)
    const [showStock, setShowStock] = useState(false)
    const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

    const [stock, setStock] = useState<Record<string, Record<string, number>>>({})

    const load = useCallback(async () => {
        setLoading(true); setErr('')
        try {
            const [p, s] = await Promise.all([
                jsonFetch('/api/admin/prizes'),
                // Склад грузим отдельно и не роняем страницу, если он не ответил:
                // каталог полезен и без остатков.
                jsonFetch('/api/admin/inventory?summary=1').catch(() => ({ counts: {} })),
            ])
            setPrizes(p.prizes ?? [])
            setStock(s.counts ?? {})
        }
        catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])
    useEffect(() => { load() }, [load])

    const flash = (kind: 'success' | 'error', text: string) => {
        setMsg({ kind, text })
        window.setTimeout(() => setMsg(null), 3500)
    }

    const patch = useCallback(async (id: string, body: Record<string, any>, note: string) => {
        await jsonFetch(`/api/admin/prizes/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        flash('success', note)
        load()
    }, [load])

    const toggleActive = async (id: string, active: boolean) => {
        try { await patch(id, { is_active: active }, `${id} → ${active ? 'active' : 'disabled'}`) }
        catch (e: any) { flash('error', e.message) }
    }

    // Построчное редактирование: в правку уходят только изменённые поля,
    // чтобы случайно не перезаписать то, что админ не трогал.
    const [editId, setEditId] = useState<string | null>(null)
    const [draft, setDraft] = useState<Record<string, string>>({})
    const [savingRow, setSavingRow] = useState(false)

    const startEdit = (p: any) => {
        setEditId(p.id)
        setDraft({
            name: String(p.name ?? ''),
            type: String(p.type ?? ''),
            drop_chance: String(p.drop_chance ?? ''),
            xp_reward: String(p.xp_reward ?? 0),
            amount: p.amount == null ? '' : String(p.amount),
        })
    }

    const saveEdit = async (p: any) => {
        const body: Record<string, any> = {}
        if (draft.name !== String(p.name ?? '')) body.name = draft.name
        if (draft.type !== String(p.type ?? '')) body.type = draft.type
        if (draft.drop_chance !== String(p.drop_chance ?? '')) body.drop_chance = Number(draft.drop_chance)
        if (draft.xp_reward !== String(p.xp_reward ?? 0)) body.xp_reward = Number(draft.xp_reward)
        const amountNow = p.amount == null ? '' : String(p.amount)
        if (draft.amount !== amountNow) body.amount = draft.amount === '' ? null : draft.amount

        if (!Object.keys(body).length) { setEditId(null); return }
        setSavingRow(true)
        try {
            await patch(p.id, body, `${p.id}: ${Object.keys(body).join(', ')} updated`)
            setEditId(null)
        } catch (e: any) { flash('error', e.message) }
        finally { setSavingRow(false) }
    }

    // Сумма весов активных призов — по ней считается реальный шанс выпадения.
    // Само поле drop_chance это вес, а не проценты: 0.32 при сумме 0.927 —
    // это 34.5%, и держать это в уме при правке невозможно.
    const totalWeight = prizes
        .filter((p: any) => p.is_active)
        .reduce((s: number, p: any) => s + Number(p.drop_chance || 0), 0)

    const prizeRow = (p: any, withStock: boolean) => {
        const editing = editId === p.id
        const cell = (field: string, width: string, mono = true) => (
            <input
                key={field}
                value={draft[field] ?? ''}
                onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}
                onKeyDown={e => {
                    if (e.key === 'Enter') saveEdit(p)
                    if (e.key === 'Escape') setEditId(null)
                }}
                className={`${width} ${mono ? 'font-mono' : ''} bg-black/50 border border-[#3b82f6]/40 rounded-lg h-7 px-2 text-xs focus:outline-none focus:border-[#3b82f6]`}
            />
        )
        const avail = stock[p.id]?.available ?? 0
        const claimed = stock[p.id]?.claimed ?? 0
        const pct = totalWeight > 0 && p.is_active
            ? (Number(p.drop_chance || 0) / totalWeight * 100)
            : 0

        return [
            <span key="i" className="font-mono text-xs">{p.id}</span>,

            editing ? cell('name', 'w-40', false)
                : (p.name || <span key="n" className="text-red-400/70 text-[11px]">— no name —</span>),

            editing ? cell('drop_chance', 'w-20') : (
                <span key="d" className="font-mono text-white/70">
                    {pct >= 0.01 ? `${pct.toFixed(2)}%` : '<0.01%'}
                    <span className="text-white/25 ml-1.5">({p.drop_chance})</span>
                </span>
            ),

            editing ? cell('xp_reward', 'w-16')
                : <span key="x" className="font-mono text-[#3b82f6]">{p.xp_reward ?? 0}</span>,

            editing ? cell('amount', 'w-16')
                : <span key="a" className="font-mono text-white/50">{p.amount ?? '—'}</span>,

            withStock ? (
                <span key="s" className={`font-mono text-xs ${avail === 0 ? 'text-red-400' : 'text-white/60'}`}>
                    {avail}<span className="text-white/25"> / {claimed} out</span>
                </span>
            ) : <span key="s" />,

            <button key="ac" onClick={() => toggleActive(p.id, !p.is_active)} className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${p.is_active ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-white/5 text-white/30 border border-white/10'}`}>{p.is_active ? 'Active' : 'Disabled'}</button>,

            editing ? (
                <div key="z" className="flex items-center gap-1">
                    <button onClick={() => saveEdit(p)} disabled={savingRow} title="save (Enter)"
                        className="h-7 px-2 rounded-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white flex items-center">
                        {savingRow ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    </button>
                    <button onClick={() => setEditId(null)} title="cancel (Esc)"
                        className="h-7 px-2 rounded-full border border-white/10 text-white/50 hover:text-white flex items-center">
                        <X size={12} />
                    </button>
                </div>
            ) : (
                <button key="z" onClick={() => startEdit(p)} title="edit" className="text-white/30 hover:text-white transition-colors">
                    <Pencil size={12} />
                </button>
            ),
        ]
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-black uppercase tracking-widest">Prize catalogue</h2>
                <div className="flex items-center gap-2">
                    <button onClick={() => setShowStock(s => !s)} className={`text-[10px] font-black uppercase tracking-widest px-3 py-2 border rounded-full flex items-center gap-1.5 transition-colors ${showStock ? 'bg-white text-black border-white' : 'text-white/60 hover:text-white border-white/10'}`}><Package size={12} /> Stock</button>
                    <button onClick={() => setShowImport(s => !s)} className={`text-[10px] font-black uppercase tracking-widest px-3 py-2 border rounded-full flex items-center gap-1.5 transition-colors ${showImport ? 'bg-white text-black border-white' : 'text-white/60 hover:text-white border-white/10'}`}><LinkIcon size={12} /> Import by link</button>
                    <button onClick={() => setShowForm(s => !s)} className="text-[10px] font-black uppercase tracking-widest text-white px-3 py-2 bg-[#3b82f6] hover:bg-[#2c63c4] rounded-xl flex items-center gap-1.5"><Plus size={12} /> New prize</button>
                    <button onClick={load} className="text-[10px] font-bold uppercase tracking-widest text-[#666666] hover:text-white"><RefreshCcw size={12} /></button>
                </div>
            </div>

            {msg && <div className={`px-3 py-2 rounded-xl text-xs ${msg.kind === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>{msg.text}</div>}

            {showForm && <PrizeForm onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); load(); flash('success', 'Prize created') }} />}
            {showImport && <LinkImportPanel prizes={prizes} onMsg={flash} onChanged={load} />}
            {showStock && <StockPanel prizes={prizes} stock={stock} onMsg={flash} onChanged={load} />}

            {loading ? <Loading /> : err ? <ErrorBox msg={err} /> : (
                <div className="flex flex-col gap-4">
                    {GROUPS.map(g => {
                        const rows = prizes.filter((p: any) => p.type === g.type)
                        if (!rows.length) return null
                        const share = rows.filter((p: any) => p.is_active)
                            .reduce((s: number, p: any) => s + Number(p.drop_chance || 0), 0)
                        const stockTotal = rows.reduce((s: number, p: any) => s + (stock[p.id]?.available ?? 0), 0)
                        return (
                            <Card key={g.type}>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-baseline gap-3">
                                        <h3 className="text-xs font-black uppercase tracking-widest">{g.label}</h3>
                                        <span className="text-[10px] font-mono text-white/35">
                                            {rows.length} items · {totalWeight > 0 ? (share / totalWeight * 100).toFixed(1) : '0'}% of wheel
                                        </span>
                                    </div>
                                    {g.type === 'nft' && (
                                        <span className={`text-[10px] font-mono ${stockTotal === 0 ? 'text-red-400' : 'text-white/35'}`}>
                                            in stock: {stockTotal}
                                        </span>
                                    )}
                                </div>
                                <Table
                                    headers={['ID', 'Name', 'Chance', 'XP', 'Amount', g.type === 'nft' ? 'Stock' : '', 'Active', '']}
                                    rows={rows.map((p: any) => prizeRow(p, g.type === 'nft'))}
                                />
                            </Card>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

function PrizeForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
    const [id, setId] = useState('')
    const [name, setName] = useState('')
    const [type, setType] = useState<'nft' | 'shard' | 'token'>('nft')
    const [dropChance, setDropChance] = useState('1')
    const [xpReward, setXpReward] = useState('100')
    const [imageUrl, setImageUrl] = useState('')
    const [amount, setAmount] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')

    const submit = async () => {
        setBusy(true); setErr('')
        try {
            await jsonFetch('/api/admin/prizes', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: id.trim(), name: name.trim(), type,
                    drop_chance: Number(dropChance), xp_reward: Number(xpReward),
                    image_url: imageUrl.trim() || undefined,
                    amount: amount ? Number(amount) : undefined,
                }),
            })
            onCreated()
        } catch (e: any) { setErr(e.message) }
        finally { setBusy(false) }
    }

    return (
        <Card className="border-[#3b82f6]/30 bg-[#3b82f6]/5">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-black uppercase tracking-widest">New prize</h3>
                <button onClick={onClose} className="text-white/30 hover:text-white text-xs">✕</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="ID (lowercase, _-)" value={id} onChange={setId} placeholder="e.g. epic_droid_42" />
                <FormField label="Name" value={name} onChange={setName} placeholder="Epic Droid #42" />
                <FormField label="Type">
                    <select value={type} onChange={e => setType(e.target.value as any)} className="bg-black/40 border border-white/10 rounded-xl h-10 px-3 text-sm focus:outline-none focus:border-[#3b82f6]">
                        <option value="nft">nft</option>
                        <option value="shard">shard</option>
                        <option value="token">token (APE)</option>
                    </select>
                </FormField>
                <FormField label="Drop chance (weight)" value={dropChance} onChange={setDropChance} placeholder="1" />
                <FormField label="XP reward" value={xpReward} onChange={setXpReward} placeholder="100" />
                <FormField label="Amount (shards / APE)" value={amount} onChange={setAmount} placeholder="leave empty for NFT" />
                <FormField label="Image URL" value={imageUrl} onChange={setImageUrl} placeholder="https://..." className="sm:col-span-2" />
            </div>
            {err && <p className="text-xs text-red-400 mt-3">{err}</p>}
            <div className="flex justify-end gap-2 mt-4">
                <button onClick={onClose} className="px-3 h-9 text-[10px] uppercase font-bold tracking-widest text-white/50 hover:text-white">Cancel</button>
                <button onClick={submit} disabled={busy || !id || !name} className="px-4 h-9 bg-[#3b82f6] hover:bg-[#2c63c4] disabled:opacity-40 rounded-xl text-[10px] uppercase font-black tracking-widest text-white flex items-center gap-2">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create
                </button>
            </div>
        </Card>
    )
}


/**
 * Склад: сами NFT, лежащие за призами. Виден список по категориям, каждую
 * позицию можно переименовать, перенести в другую категорию, вернуть в пул
 * или удалить. Категория тут не косметика — она решает, в каком сегменте
 * барабана приз разыгрывается.
 */
function StockPanel({ prizes, stock, onMsg, onChanged }: {
    prizes: any[]
    stock: Record<string, Record<string, number>>
    onMsg: (k: 'success' | 'error', t: string) => void
    onChanged: () => void
}) {
    const nftPrizes = prizes.filter((p: any) => p.type === 'nft')
    const [cat, setCat] = useState<string>(nftPrizes[0]?.id ?? '')
    const [status, setStatus] = useState<'available' | 'claimed' | ''>('available')
    const [items, setItems] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [sel, setSel] = useState<Set<string>>(new Set())
    const [moveTo, setMoveTo] = useState('')
    const [priceAll, setPriceAll] = useState('')
    const [pulling, setPulling] = useState(false)
    const [editing, setEditing] = useState<string | null>(null)
    const [nameDraft, setNameDraft] = useState('')

    const load = useCallback(async () => {
        if (!cat) return
        setLoading(true); setSel(new Set())
        try {
            const url = new URL('/api/admin/inventory', window.location.origin)
            url.searchParams.set('prize_type_id', cat)
            if (status) url.searchParams.set('status', status)
            setItems((await jsonFetch(url.toString())).items ?? [])
        } catch (e: any) { onMsg('error', e.message) }
        finally { setLoading(false) }
    }, [cat, status, onMsg])
    useEffect(() => { load() }, [load])

    const patchItem = async (id: string, body: any, note: string) => {
        try {
            await jsonFetch(`/api/admin/inventory/${id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            })
            onMsg('success', note); load(); onChanged()
        } catch (e: any) { onMsg('error', e.message) }
    }

    const removeItem = async (id: string, label: string) => {
        if (!window.confirm(`Remove “${label}” from stock?`)) return
        try {
            await jsonFetch(`/api/admin/inventory/${id}`, { method: 'DELETE' })
            onMsg('success', `${label} removed`); load(); onChanged()
        } catch (e: any) { onMsg('error', e.message) }
    }

    const moveSelected = async () => {
        if (!moveTo || !sel.size) return
        try {
            const r = await jsonFetch('/api/admin/inventory', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [...sel], prize_type_id: moveTo }),
            })
            onMsg('success', `Moved ${r.moved} → ${moveTo}`); load(); onChanged()
        } catch (e: any) { onMsg('error', e.message) }
    }

    // Основной путь: тянем цену приобретения из OpenSea — последняя продажа
    // перед передачей токена в призовой волт. Ручной ввод остаётся запасным
    // вариантом для того, что попало к нам без продажи.
    const pullPrices = async () => {
        const ids = sel.size ? [...sel] : items.map((i: any) => i.id)
        if (!ids.length) return
        setPulling(true)
        try {
            const r = await jsonFetch('/api/admin/inventory/price', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ids.slice(0, 100) }),
            })
            const why = (r.results ?? []).filter((x: any) => !x.ok).map((x: any) => x.reason)
            const top = [...new Set(why)].slice(0, 2).join('; ')
            onMsg(r.priced > 0 ? 'success' : 'error',
                `Priced ${r.priced}, skipped ${r.skipped}${top ? ` — ${top}` : ''}`)
            load(); onChanged()
        } catch (e: any) { onMsg('error', e.message) }
        finally { setPulling(false) }
    }

    const priceSelected = async () => {
        const v = priceAll.trim()
        if (!sel.size || v === '') return
        const value = v === '-' || v === '—' ? null : v
        let ok = 0
        for (const id of sel) {
            try {
                await jsonFetch(`/api/admin/inventory/${id}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ acquisition_ape: value }),
                })
                ok++
            } catch { /* по одной: сбой на одной позиции не рушит всю партию */ }
        }
        onMsg(ok === sel.size ? 'success' : 'error',
            `Price set on ${ok} of ${sel.size}`)
        setPriceAll(''); load(); onChanged()
    }

    const toggle = (id: string) => setSel(s => {
        const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
    })

    return (
        <Card>
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <h3 className="text-xs font-black uppercase tracking-widest mr-2">Stock</h3>
                {nftPrizes.map((p: any) => {
                    const n = stock[p.id]?.available ?? 0
                    return (
                        <button
                            key={p.id}
                            onClick={() => setCat(p.id)}
                            className={`px-3 h-7 rounded-full text-[10px] font-bold tracking-wider transition-colors ${cat === p.id
                                ? 'bg-white text-black'
                                : 'bg-white/5 text-white/50 hover:text-white hover:bg-white/10'}`}
                        >
                            {p.id} <span className={cat === p.id ? 'text-black/40' : 'text-white/30'}>{n}</span>
                        </button>
                    )
                })}
                <div className="ml-auto flex items-center gap-2">
                    <select
                        value={status}
                        onChange={e => setStatus(e.target.value as any)}
                        className="bg-black/40 border border-white/10 rounded-full h-7 px-3 text-[10px] focus:outline-none focus:border-[#3b82f6]"
                    >
                        <option value="available">in stock</option>
                        <option value="claimed">handed out</option>
                        <option value="">all</option>
                    </select>
                    <button
                        onClick={() => setSel(s => s.size === items.length ? new Set() : new Set(items.map((i: any) => i.id)))}
                        className="h-7 px-3 rounded-full bg-white/5 hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-white"
                    >
                        {sel.size === items.length && items.length > 0 ? 'clear all' : 'select all'}
                    </button>
                    <button onClick={load} className="text-[#666666] hover:text-white"><RefreshCcw size={12} /></button>
                </div>
            </div>

            {sel.size > 0 && (
                <div className="flex items-center gap-2 mb-3 p-2 rounded-xl bg-[#3b82f6]/10 border border-[#3b82f6]/25">
                    <span className="text-[11px] font-bold">Selected: {sel.size}</span>
                    <select
                        value={moveTo}
                        onChange={e => setMoveTo(e.target.value)}
                        className="bg-black/40 border border-white/10 rounded-full h-7 px-3 text-[10px] focus:outline-none focus:border-[#3b82f6]"
                    >
                        <option value="">— move to category —</option>
                        {nftPrizes.filter((p: any) => p.id !== cat).map((p: any) => <option key={p.id} value={p.id}>{p.id}</option>)}
                    </select>
                    <button
                        onClick={moveSelected}
                        disabled={!moveTo}
                        className="h-7 px-3 rounded-full bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-40 text-[10px] font-black uppercase tracking-widest"
                    >
                        Move
                    </button>

                    <span className="w-px h-5 bg-white/10 mx-1" />

                    <button
                        onClick={pullPrices}
                        disabled={pulling}
                        className="h-7 px-3 rounded-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5"
                    >
                        {pulling ? <Loader2 size={11} className="animate-spin" /> : null}
                        Pull prices from OpenSea
                    </button>

                    <input
                        value={priceAll}
                        onChange={e => setPriceAll(e.target.value)}
                        placeholder="manual, APE"
                        className="w-24 font-mono bg-black/40 border border-white/10 rounded-full h-7 px-3 text-[10px] focus:outline-none focus:border-[#3b82f6] placeholder:text-white/25"
                    />
                    <button
                        onClick={priceSelected}
                        disabled={priceAll.trim() === ''}
                        className="h-7 px-3 rounded-full border border-white/15 hover:bg-white/10 disabled:opacity-40 text-[10px] font-black uppercase tracking-widest"
                    >
                        Set
                    </button>

                    <button onClick={() => setSel(new Set())} className="ml-auto text-white/40 hover:text-white text-[10px] uppercase tracking-widest">clear</button>
                </div>
            )}

            {loading ? <Loading /> : items.length === 0 ? (
                <p className="text-center text-xs text-white/30 py-6">Empty</p>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {items.map((it: any) => (
                        <div key={it.id} className={`flex items-center gap-3 p-2 rounded-xl border transition-colors ${sel.has(it.id) ? 'border-[#3b82f6]/50 bg-[#3b82f6]/10' : 'border-white/5 bg-white/[0.02]'}`}>
                            <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} className="shrink-0" />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {it.image_url
                                ? <img src={it.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 bg-black/40" />
                                : <div className="w-10 h-10 rounded-lg bg-black/40 shrink-0" />}

                            <div className="min-w-0 flex-1">
                                {editing === it.id ? (
                                    <input
                                        autoFocus
                                        value={nameDraft}
                                        onChange={e => setNameDraft(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') { patchItem(it.id, { name: nameDraft }, `${it.token_id}: name updated`); setEditing(null) }
                                            if (e.key === 'Escape') setEditing(null)
                                        }}
                                        onBlur={() => setEditing(null)}
                                        className="w-full bg-black/50 border border-[#3b82f6]/40 rounded-lg h-7 px-2 text-xs focus:outline-none"
                                    />
                                ) : (
                                    <button
                                        onClick={() => { setEditing(it.id); setNameDraft(it.name ?? '') }}
                                        className="text-xs text-left hover:text-[#3b82f6] transition-colors truncate block w-full"
                                    >
                                        {it.name || <span className="text-red-400/70">— no name —</span>}
                                    </button>
                                )}
                                <p className="text-[10px] font-mono text-white/30 truncate">
                                    #{it.token_id} · {String(it.contract_address).slice(0, 8)}…
                                    {it.status !== 'available' && <span className="text-white/50"> · {it.status}</span>}
                                </p>
                            </div>

                            {/* Себестоимость: во сколько APE обошёлся нам этот NFT.
                                По ней считается расход в профите Glitch Cards. */}
                            <div className="shrink-0 flex items-center gap-1">
                                <input
                                    defaultValue={it.acquisition_ape ?? ''}
                                    placeholder="price"
                                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                                    onBlur={e => {
                                        const v = e.target.value.trim()
                                        const was = it.acquisition_ape == null ? '' : String(it.acquisition_ape)
                                        if (v === was) return
                                        patchItem(it.id, { acquisition_ape: v === '' ? null : v }, `#${it.token_id}: price ${v || '—'}`)
                                    }}
                                    className={`w-16 font-mono bg-black/40 border rounded-lg h-7 px-2 text-[11px] text-right focus:outline-none focus:border-[#3b82f6] placeholder:text-white/20 ${it.acquisition_ape == null ? 'border-white/10' : 'border-emerald-500/30'}`}
                                />
                                <span className="text-[9px] text-white/25">APE</span>
                            </div>

                            <select
                                value={it.prize_type_id}
                                onChange={e => patchItem(it.id, { prize_type_id: e.target.value }, `#${it.token_id} → ${e.target.value}`)}
                                className="shrink-0 bg-black/40 border border-white/10 rounded-lg h-7 px-1 text-[10px] focus:outline-none focus:border-[#3b82f6]"
                            >
                                {nftPrizes.map((p: any) => <option key={p.id} value={p.id}>{p.id}</option>)}
                            </select>

                            {it.status === 'claimed' ? (
                                <button
                                    onClick={() => patchItem(it.id, { status: 'available' }, `#${it.token_id} returned to pool`)}
                                    title="return to pool"
                                    className="shrink-0 text-white/25 hover:text-emerald-400 transition-colors"
                                >
                                    <RefreshCcw size={12} />
                                </button>
                            ) : (
                                <button
                                    onClick={() => removeItem(it.id, it.name || `#${it.token_id}`)}
                                    title="remove from stock"
                                    className="shrink-0 text-white/25 hover:text-red-400 transition-colors"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </Card>
    )
}

interface ResolvedRow {
    ref: string
    ok: boolean
    error?: string
    contract?: string
    tokenId?: string
    standard?: 'erc721' | 'erc1155'
    name?: string
    imageUrl?: string
    vaultBalance?: number
    inVault?: boolean
    /** выбранная категория приза — заполняется в UI */
    prizeId?: string
}

/**
 * Импорт призов ссылками. Кидаешь пачку ссылок на NFT — по каждой
 * подтягивается имя, картинка и стандарт токена, и сразу проверяется, лежит
 * ли токен в призовом волте. Без этой проверки приз можно завести «на бумаге»,
 * и он отвалится уже у победителя — так в марте потерялись семь наград.
 */
function LinkImportPanel({ prizes, onMsg, onChanged }: { prizes: any[]; onMsg: (k: 'success' | 'error', t: string) => void; onChanged: () => void }) {
    const nftPrizes = prizes.filter((p: any) => p.type === 'nft')
    const [raw, setRaw] = useState('')
    const [rows, setRows] = useState<ResolvedRow[]>([])
    const [vault, setVault] = useState('')
    const [busy, setBusy] = useState(false)
    const [saving, setSaving] = useState(false)
    const [defaultPrize, setDefaultPrize] = useState(nftPrizes[0]?.id ?? '')

    const refs = raw.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean)

    const resolve = async () => {
        if (!refs.length) return
        setBusy(true)
        try {
            const d = await jsonFetch('/api/admin/inventory/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refs }),
            })
            setVault(d.vault)
            setRows((d.items as ResolvedRow[]).map(r => ({ ...r, prizeId: defaultPrize })))
            const bad = d.items.filter((r: ResolvedRow) => !r.ok).length
            const notInVault = d.items.filter((r: ResolvedRow) => r.ok && !r.inVault).length
            onMsg(bad || notInVault ? 'error' : 'success',
                `Resolved ${d.items.length}: ${bad} failed, ${notInVault} not in vault`)
        } catch (e: any) { onMsg('error', e.message) }
        finally { setBusy(false) }
    }

    const setRow = (i: number, patch: Partial<ResolvedRow>) =>
        setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

    const ready = rows.filter(r => r.ok && r.inVault && r.prizeId && r.name)

    const save = async () => {
        if (!ready.length) return
        setSaving(true)
        try {
            const d = await jsonFetch('/api/admin/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: ready.map(r => ({
                        prize_type_id: r.prizeId,
                        contract_address: r.contract,
                        token_id: r.tokenId,
                        name: r.name,
                        image_url: r.imageUrl,
                    })),
                }),
            })
            const skipped = (d.skipped ?? []).length

            // Сразу пробиваем цену приобретения по OpenSea: заводить позицию
            // без неё бессмысленно — она не попадёт в расчёт себестоимости.
            let pricedNote = ''
            const newIds = (d.items ?? []).map((x: any) => x.id).filter(Boolean)
            if (newIds.length) {
                try {
                    const pr = await jsonFetch('/api/admin/inventory/price', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: newIds }),
                    })
                    pricedNote = `, priced ${pr.priced}/${newIds.length}`
                } catch { pricedNote = ', price lookup failed' }
            }

            onMsg(skipped ? 'error' : 'success',
                `Added ${d.inserted}${pricedNote}` + (skipped ? `, skipped ${skipped}: ${d.skipped.map((s: any) => `#${s.token_id} (${s.reason})`).join(', ')}` : ''))
            if (d.inserted) {
                const savedKeys = new Set(ready.map(r => `${r.contract}:${r.tokenId}`))
                setRows(rs => rs.filter(r => !savedKeys.has(`${r.contract}:${r.tokenId}`)))
                // Без этого каталог и склад оставались со старыми числами, и
                // импорт выглядел так, будто ничего не добавилось.
                onChanged()
            }
        } catch (e: any) { onMsg('error', e.message) }
        finally { setSaving(false) }
    }

    return (
        <Card className="border-[#3b82f6]/30 bg-[#3b82f6]/5">
            <h3 className="text-xs font-black uppercase tracking-widest mb-3">Inventory — import by link</h3>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                <FormField label="NFT links — one per line (OpenSea, or plain 0xContract/tokenId)">
                    <textarea
                        value={raw}
                        onChange={e => setRaw(e.target.value)}
                        rows={4}
                        placeholder={'https://opensea.io/item/ape_chain/0x.../123\n0xabc...def/456'}
                        className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#3b82f6] transition-colors placeholder:text-white/20"
                    />
                </FormField>
                <div className="flex flex-col gap-2">
                    <FormField label="Default category">
                        <select
                            value={defaultPrize}
                            onChange={e => {
                                setDefaultPrize(e.target.value)
                                setRows(rs => rs.map(r => ({ ...r, prizeId: e.target.value })))
                            }}
                            className="bg-black/40 border border-white/10 rounded-xl h-10 px-3 text-sm focus:outline-none focus:border-[#3b82f6]"
                        >
                            {nftPrizes.map((p: any) => <option key={p.id} value={p.id}>{p.id}</option>)}
                        </select>
                    </FormField>
                    <button
                        onClick={resolve}
                        disabled={busy || !refs.length}
                        className="h-10 px-4 bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-40 rounded-xl text-[10px] uppercase font-black tracking-widest text-white flex items-center justify-center gap-2"
                    >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                        Resolve {refs.length ? `(${refs.length})` : ''}
                    </button>
                </div>
            </div>

            {rows.length > 0 && (
                <div className="mt-4 space-y-2">
                    {vault && (
                        <p className="text-[10px] font-mono text-white/35">
                            prize vault: {vault}
                        </p>
                    )}
                    {rows.map((r, i) => (
                        <div
                            key={`${r.ref}-${i}`}
                            className={`flex items-center gap-3 p-2 rounded-xl border ${r.ok && r.inVault
                                ? 'border-emerald-500/25 bg-emerald-500/5'
                                : 'border-red-500/25 bg-red-500/5'}`}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {r.imageUrl
                                ? <img src={r.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0 bg-black/40" />
                                : <div className="w-12 h-12 rounded-lg bg-black/40 shrink-0" />}

                            <div className="min-w-0 flex-1">
                                <input
                                    value={r.name ?? ''}
                                    onChange={e => setRow(i, { name: e.target.value })}
                                    placeholder="name not resolved — type it"
                                    className="w-full bg-transparent border-b border-white/10 focus:border-[#3b82f6] outline-none text-sm py-0.5 placeholder:text-white/25"
                                />
                                <p className="text-[10px] font-mono text-white/35 truncate mt-1">
                                    {r.contract ? `${r.contract.slice(0, 10)}…${r.contract.slice(-6)} #${r.tokenId}` : r.ref}
                                    {r.standard ? ` · ${r.standard}` : ''}
                                </p>
                            </div>

                            <div className="shrink-0 text-right">
                                {!r.ok ? (
                                    <span className="text-[10px] font-bold text-red-400">{r.error}</span>
                                ) : !r.inVault ? (
                                    <span className="text-[10px] font-bold text-red-400">not in vault — will not be added</span>
                                ) : (
                                    <span className="text-[10px] font-bold text-emerald-400">
                                        in vault{r.standard === 'erc1155' && r.vaultBalance ? ` ×${r.vaultBalance}` : ''}
                                    </span>
                                )}
                            </div>

                            <select
                                value={r.prizeId ?? ''}
                                onChange={e => setRow(i, { prizeId: e.target.value })}
                                disabled={!r.ok}
                                className="shrink-0 bg-black/40 border border-white/10 rounded-lg h-8 px-2 text-[11px] focus:outline-none focus:border-[#3b82f6] disabled:opacity-30"
                            >
                                {nftPrizes.map((p: any) => <option key={p.id} value={p.id}>{p.id}</option>)}
                            </select>

                            <button
                                onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}
                                className="shrink-0 text-white/30 hover:text-white transition-colors"
                                title="remove"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}

                    <div className="flex justify-end pt-1">
                        <button
                            onClick={save}
                            disabled={saving || !ready.length}
                            className="px-4 h-9 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 rounded-xl text-[10px] uppercase font-black tracking-widest text-white flex items-center gap-2"
                        >
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                            Add {ready.length} of {rows.length}
                        </button>
                    </div>
                </div>
            )}
        </Card>
    )
}

function FormField({ label, value, onChange, placeholder, className = '', children }: { label: string; value?: string; onChange?: (v: string) => void; placeholder?: string; className?: string; children?: React.ReactNode }) {
    return (
        <div className={`flex flex-col gap-1 ${className}`}>
            <label className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/40">{label}</label>
            {children ?? (
                <input value={value} onChange={e => onChange?.(e.target.value)} placeholder={placeholder} className="bg-black/40 border border-white/10 rounded-xl h-10 px-3 text-sm focus:outline-none focus:border-[#3b82f6] transition-colors placeholder:text-white/20" />
            )}
        </div>
    )
}

// ── Tab: Health ───────────────────────────────────────────────────────────────

function AlertCard({ alert, onResolved }: { alert: { severity: string; kind: string; message: string; detail?: any; fingerprint?: string }; onResolved?: () => void }) {
    const [open, setOpen] = useState(false)
    const [resolving, setResolving] = useState(false)
    const c: Record<string, string> = {
        critical: 'border-red-500/30 bg-red-500/5',
        warning: 'border-orange-500/30 bg-orange-500/5',
        info: 'border-blue-500/30 bg-blue-500/5',
    }
    const txt: Record<string, string> = {
        critical: 'text-red-400',
        warning: 'text-orange-400',
        info: 'text-blue-400',
    }

    const resolve = async () => {
        if (!alert.fingerprint || resolving) return
        setResolving(true)
        try {
            const res = await fetch('/api/admin/health/dismiss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: alert.kind, fingerprint: alert.fingerprint }),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            onResolved?.()
        } catch (e: any) {
            window.alert(`Failed to resolve: ${e.message}`)
            setResolving(false)
        }
    }

    return (
        <div className={`border rounded-2xl p-4 ${c[alert.severity] ?? ''}`}>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                    <AlertTriangle size={16} className={txt[alert.severity] ?? ''} />
                    <span className={`text-[10px] uppercase font-black tracking-widest ${txt[alert.severity] ?? ''}`}>{alert.severity}</span>
                    <span className="text-[10px] font-mono text-white/30 truncate">{alert.kind}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    {alert.detail && <button onClick={() => setOpen(o => !o)} className="text-[10px] font-bold uppercase tracking-widest text-[#666666] hover:text-white">{open ? 'Hide' : 'Detail'}</button>}
                    {alert.fingerprint && (
                        <button
                            onClick={resolve}
                            disabled={resolving}
                            className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/70 hover:text-emerald-300 disabled:opacity-40"
                        >
                            {resolving ? '…' : 'Resolve'}
                        </button>
                    )}
                </div>
            </div>
            <p className="text-sm text-white mt-1">{alert.message}</p>
            {open && alert.detail && (
                <pre className="mt-3 max-h-72 overflow-auto bg-black/40 border border-white/10 rounded-lg p-3 text-[10px] text-white/60 font-mono">{JSON.stringify(alert.detail, null, 2)}</pre>
            )}
        </div>
    )
}

// ── Tab: Users ────────────────────────────────────────────────────────────────

function UsersTab() {
    const [data, setData] = useState<any>(null)
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState<'top' | 'recent'>('top')

    // Drill-down state
    const [search, setSearch] = useState('')
    const [drillDown, setDrillDown] = useState<any>(null)
    const [drillLoading, setDrillLoading] = useState(false)
    const [drillError, setDrillError] = useState('')

    const load = useCallback(async () => {
        setLoading(true); setErr('')
        try { setData(await jsonFetch('/api/admin/stats/users')) }
        catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])
    useEffect(() => { load() }, [load])

    const performSearch = useCallback(async (wallet: string) => {
        const w = wallet.trim().toLowerCase()
        if (!/^0x[0-9a-f]{40}$/.test(w)) {
            setDrillError('Invalid wallet (need 0x… 40 hex)')
            return
        }
        setDrillLoading(true); setDrillError('')
        try {
            setDrillDown(await jsonFetch(`/api/admin/stats/users?wallet=${w}`))
        } catch (e: any) { setDrillError(e.message); setDrillDown(null) }
        finally { setDrillLoading(false) }
    }, [])

    return (
        <div className="flex flex-col gap-4">
            {/* ── Wallet search ──────────────────────────────────────────── */}
            <Card title="Wallet drill-down">
                <div className="flex items-center gap-2">
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && performSearch(search)}
                        placeholder="0x… (paste wallet, press Enter)"
                        className="flex-1 bg-black/40 border border-white/10 rounded-xl h-10 px-3 text-sm font-mono focus:outline-none focus:border-[#3b82f6] placeholder:text-white/20"
                    />
                    <button onClick={() => performSearch(search)} disabled={drillLoading} className="h-10 px-4 bg-[#3b82f6] hover:bg-[#2c63c4] disabled:opacity-50 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                        {drillLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Search
                    </button>
                    {drillDown && <button onClick={() => { setDrillDown(null); setSearch('') }} className="h-10 px-3 text-[10px] font-bold uppercase tracking-widest text-[#666666] hover:text-white">Clear</button>}
                </div>
                {drillError && <p className="text-xs text-red-400 mt-2">{drillError}</p>}
            </Card>

            {drillDown ? <WalletDrillDown data={drillDown} /> : (
                <>
                    <div className="flex items-center justify-between">
                        <div className="flex bg-white/5 rounded-xl border border-white/10 p-0.5">
                            {([['top', 'Top spenders'], ['recent', 'Recent signups']] as const).map(([id, label]) => (
                                <button key={id} onClick={() => setView(id as any)} className={`px-3 h-7 text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors ${view === id ? 'bg-[#3b82f6] text-white' : 'text-white/40 hover:text-white'}`}>{label}</button>
                            ))}
                        </div>
                        <button onClick={load} className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-[#666666] hover:text-white"><RefreshCcw size={12} /> Refresh</button>
                    </div>

                    {loading && !data ? <Loading /> : err ? <ErrorBox msg={err} /> : data && (
                        <>
                            {view === 'top' && (
                                <Card title="Top 50 Cards spenders (all-time)">
                                    <Table headers={['#', 'Wallet', 'APE spent', 'Purchases', 'Last']} rows={(data.topSpenders ?? []).map((u: any, i: number) => [
                                        <span key="r" className="font-mono text-white/40">{i + 1}</span>,
                                        <button key="w" onClick={() => { setSearch(u.wallet_address); performSearch(u.wallet_address) }} className="font-mono text-[#3b82f6] hover:underline">{shortWallet(u.wallet_address)}</button>,
                                        <span key="a" className="font-mono text-emerald-400 font-bold">{fmt(u.total_ape, 2)} APE</span>,
                                        <span key="c" className="font-mono text-white/60">{fmt(u.purchases)}</span>,
                                        <span key="l" className="font-mono text-[10px] text-white/30">{u.last_purchase && new Date(u.last_purchase).toLocaleDateString()}</span>,
                                    ])} />
                                </Card>
                            )}

                            {view === 'recent' && (
                                <Card title="Recent signups (last 50, ordered by first activity)">
                                    <Table headers={['Wallet', 'First seen', 'Source']} rows={(data.recentSignups ?? []).map((u: any) => [
                                        <button key="w" onClick={() => { setSearch(u.wallet_address); performSearch(u.wallet_address) }} className="font-mono text-[#3b82f6] hover:underline">{shortWallet(u.wallet_address)}</button>,
                                        <span key="t" className="font-mono text-[10px] text-white/60">{new Date(u.first_seen).toLocaleString()}</span>,
                                        <span key="s" className="text-[10px] uppercase tracking-widest text-white/40">{u.sources}</span>,
                                    ])} />
                                </Card>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    )
}

function WalletDrillDown({ data }: { data: any }) {
    const s = data.summary
    if (!s) return <Card>No data for this wallet — they may have never played.</Card>

    return (
        <div className="flex flex-col gap-4">
            <Card title="Wallet summary" className="border-[#3b82f6]/30 bg-[#3b82f6]/5">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
                    <Stat label="Wallet" value={<span className="font-mono text-xs">{shortWallet(s.wallet_address)}</span>} hint={s.x_handle ?? 'no X handle'} />
                    <Stat label="First seen" value={<span className="text-sm font-mono">{s.first_seen ? new Date(s.first_seen).toLocaleDateString() : '—'}</span>} />
                    <Stat label="Droids owned" value={fmt(s.droids_count)} hint="On-chain (DB snapshot)" />
                    <Stat label="Tickets balance" value={fmt(s.games_balance)} accent="green" />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-white/10">
                    <Stat label="Cards plays" value={fmt(s.cards_plays)} hint={`${fmt(s.cards_nfts_won)} NFTs won`} />
                    <Stat label="Cards spent" value={`${fmt(s.cards_ape_spent, 2)} APE`} accent="green" />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-2 gap-4 mt-4 pt-4 border-t border-white/10">
                    <Stat label="Season 2 XP" value={fmt(s.season2_xp)} accent="blue" />
                    <Stat label="NFT XP (lifetime)" value={fmt(s.nft_xp)} />
                </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Card title="Recent Cards plays (last 30)">
                    <Table headers={['Prize', 'Status', 'XP', 'When']} rows={(data.recentCards ?? []).slice(0, 15).map((r: any) => [
                        <span key="p" className="font-mono text-xs">{r.prize_type_id || '—'}</span>,
                        <span key="s" className={r.status === 'error' ? 'text-red-400' : r.status === 'success' ? 'text-emerald-400' : 'text-white/40'}>{r.status}</span>,
                        <span key="x" className="font-mono text-[#3b82f6]">{r.xp_awarded || 0}</span>,
                        <span key="t" className="font-mono text-[10px] text-white/40">{new Date(r.created_at).toLocaleString()}</span>,
                    ])} />
                </Card>

            </div>

            <Card title={`NFTs won (${(data.nftsWon ?? []).length})`}>
                {(!data.nftsWon || data.nftsWon.length === 0) ? <p className="text-xs text-white/30">No NFTs won</p> : (
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {data.nftsWon.map((n: any, i: number) => (
                            <div key={i} className="flex flex-col gap-1 bg-white/5 border border-white/10 rounded-lg p-2">
                                {n.image_url && <img src={n.image_url} alt="" className="w-full aspect-square rounded object-cover" />}
                                <div className="text-[9px] text-white/60 truncate">{n.name}</div>
                                <div className="text-[8px] font-mono text-white/30">#{n.token_id}</div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            <Card title="Recent transactions">
                <Table headers={['Type', 'Amount', 'Status', 'TX', 'When']} rows={(data.recentTransactions ?? []).map((r: any) => [
                    <span key="t" className="text-[10px] uppercase tracking-widest text-white/50">{r.type}</span>,
                    <span key="a" className="font-mono">{fmt(r.amount, 4)}</span>,
                    <span key="s" className={r.status === 'confirmed' ? 'text-emerald-400' : r.status === 'pending_investigation' ? 'text-red-400' : 'text-white/40'}>{r.status}</span>,
                    r.tx_hash ? <a key="x" href={`https://apescan.io/tx/${r.tx_hash}`} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-[#3b82f6] hover:underline">{r.tx_hash.slice(0, 12)}…</a> : <span key="x" className="text-white/30">—</span>,
                    <span key="w" className="font-mono text-[10px] text-white/40">{new Date(r.created_at).toLocaleString()}</span>,
                ])} />
            </Card>
        </div>
    )
}

// ── Tab: Quests ───────────────────────────────────────────────────────────────
// Daily X-tasks: admin creates a quest by providing the tweet URL + title +
// active window; players complete it on /glitch_games/cards. This tab lets
// you manage the quest catalogue and inspect per-quest stats.

interface Quest {
    id: number
    title: string
    tweet_url: string
    active_from: string
    active_to: string
    status: 'scheduled' | 'active' | 'ended'
    claims_count: number
    xp_distributed: number
    created_at?: string
}

function QuestsTab() {
    const [quests, setQuests] = useState<Quest[]>([])
    const [loading, setLoading] = useState(true)
    const [err, setErr] = useState('')
    const [showForm, setShowForm] = useState(false)
    const [editing, setEditing] = useState<Quest | null>(null)
    const [drillId, setDrillId] = useState<number | null>(null)
    const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

    const flash = (kind: 'success' | 'error', text: string) => {
        setMsg({ kind, text })
        window.setTimeout(() => setMsg(null), 3500)
    }

    const load = useCallback(async () => {
        setLoading(true); setErr('')
        try { setQuests((await jsonFetch('/api/admin/quests')).quests ?? []) }
        catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])
    useEffect(() => { load() }, [load])

    const onDelete = async (q: Quest, hard: boolean) => {
        const word = hard ? 'permanently delete' : 'end this quest now (soft-delete)'
        if (!confirm(`Are you sure you want to ${word}?\n\n"${q.title}"`)) return
        try {
            await jsonFetch(`/api/admin/quests/${q.id}${hard ? '?hard=1' : ''}`, { method: 'DELETE' })
            flash('success', hard ? 'Quest deleted' : 'Quest ended')
            load()
        } catch (e: any) { flash('error', e.message) }
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-widest">Daily X-task quests</h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => { setEditing(null); setShowForm(true) }}
                        className="text-[10px] font-black uppercase tracking-widest text-white px-3 py-2 bg-[#3b82f6] hover:bg-[#2c63c4] rounded-xl flex items-center gap-1.5"
                    >
                        <Plus size={12} /> New quest
                    </button>
                    <button onClick={load} className="text-[10px] font-bold uppercase tracking-widest text-[#666666] hover:text-white">
                        <RefreshCcw size={12} />
                    </button>
                </div>
            </div>

            {msg && (
                <div className={`px-3 py-2 rounded-xl text-xs ${
                    msg.kind === 'success'
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}>
                    {msg.text}
                </div>
            )}

            {/* Form (create or edit) */}
            {showForm && (
                <QuestForm
                    initial={editing}
                    onClose={() => { setShowForm(false); setEditing(null) }}
                    onSaved={() => { setShowForm(false); setEditing(null); load(); flash('success', editing ? 'Quest updated' : 'Quest created') }}
                />
            )}

            {/* List */}
            {loading ? <Loading /> : err ? <ErrorBox msg={err} /> : (
                <Card>
                    <Table headers={['Status', 'Title / Tweet', 'Window', 'Claims', 'XP', 'Actions']} rows={quests.map((q: Quest) => [
                        <span key="s" className={`text-[9px] font-black uppercase tracking-widest ${
                            q.status === 'active' ? 'text-emerald-400'
                            : q.status === 'scheduled' ? 'text-blue-400'
                            : 'text-white/30'
                        }`}>{q.status}</span>,
                        <div key="t" className="flex flex-col gap-0.5">
                            <span className="font-bold text-white text-xs">{q.title}</span>
                            <a href={q.tweet_url} target="_blank" rel="noreferrer" className="font-mono text-[9px] text-[#3b82f6] hover:underline flex items-center gap-1 truncate max-w-[260px]">
                                <ExternalLink size={9} className="flex-shrink-0" />
                                {q.tweet_url.replace('https://', '').slice(0, 36)}…
                            </a>
                        </div>,
                        <span key="w" className="text-[10px] text-white/50 font-mono">
                            {new Date(q.active_from).toLocaleDateString()}<br />
                            {new Date(q.active_to).toLocaleDateString()}
                        </span>,
                        <span key="c" className="font-mono text-white">{fmt(q.claims_count)}</span>,
                        <span key="x" className="font-mono text-[#3b82f6] font-bold">{fmt(q.xp_distributed)}</span>,
                        <div key="a" className="flex items-center gap-1">
                            <button onClick={() => setDrillId(q.id)} className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest bg-white/5 hover:bg-white/10 border border-white/10 rounded">Stats</button>
                            <button onClick={() => { setEditing(q); setShowForm(true) }} className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest bg-white/5 hover:bg-white/10 border border-white/10 rounded flex items-center gap-1"><Pencil size={9} /> Edit</button>
                            {q.status !== 'ended' && (
                                <button onClick={() => onDelete(q, false)} className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 rounded text-orange-400">End</button>
                            )}
                            <button onClick={() => onDelete(q, true)} title="Hard delete (only works if no claims attached)" className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded text-red-400 flex items-center gap-1"><Trash2 size={9} /></button>
                        </div>,
                    ])} />
                </Card>
            )}

            {/* Drill-down modal */}
            {drillId != null && (
                <QuestDrillModal id={drillId} onClose={() => setDrillId(null)} />
            )}
        </div>
    )
}

function QuestForm({ initial, onClose, onSaved }: { initial: Quest | null; onClose: () => void; onSaved: () => void }) {
    const [title, setTitle] = useState(initial?.title ?? '')
    const [url, setUrl] = useState(initial?.tweet_url ?? '')
    const [from, setFrom] = useState(initial?.active_from ? toLocalInput(initial.active_from) : toLocalInput(new Date().toISOString()))
    const [to, setTo] = useState(initial?.active_to ? toLocalInput(initial.active_to) : toLocalInput(new Date(Date.now() + 86400_000).toISOString()))
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')

    const submit = async () => {
        setBusy(true); setErr('')
        try {
            const body = {
                title: title.trim(),
                tweet_url: url.trim(),
                active_from: new Date(from).toISOString(),
                active_to: new Date(to).toISOString(),
            }
            if (initial) {
                await jsonFetch(`/api/admin/quests/${initial.id}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                })
            } else {
                await jsonFetch('/api/admin/quests', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                })
            }
            onSaved()
        } catch (e: any) { setErr(e.message) }
        finally { setBusy(false) }
    }

    return (
        <Card className="border-[#3b82f6]/30 bg-[#3b82f6]/5">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-black uppercase tracking-widest">{initial ? 'Edit quest' : 'New quest'}</h3>
                <button onClick={onClose} className="text-white/30 hover:text-white text-xs">✕</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Title" value={title} onChange={setTitle} placeholder="RT this and tag 3 friends" className="sm:col-span-2" />
                <FormField label="Tweet / X post URL" value={url} onChange={setUrl} placeholder="https://x.com/account/status/12345" className="sm:col-span-2" />
                <FormField label="Active from (local time)">
                    <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} className="bg-black/40 border border-white/10 rounded-xl h-10 px-3 text-sm focus:outline-none focus:border-[#3b82f6]" />
                </FormField>
                <FormField label="Active to (local time)">
                    <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} className="bg-black/40 border border-white/10 rounded-xl h-10 px-3 text-sm focus:outline-none focus:border-[#3b82f6]" />
                </FormField>
            </div>
            {err && <p className="text-xs text-red-400 mt-3">{err}</p>}
            <div className="flex justify-end gap-2 mt-4">
                <button onClick={onClose} className="px-3 h-9 text-[10px] uppercase font-bold tracking-widest text-white/50 hover:text-white">Cancel</button>
                <button
                    onClick={submit}
                    disabled={busy || !title || !url}
                    className="px-4 h-9 bg-[#3b82f6] hover:bg-[#2c63c4] disabled:opacity-40 rounded-xl text-[10px] uppercase font-black tracking-widest text-white flex items-center gap-2"
                >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} {initial ? 'Save' : 'Create'}
                </button>
            </div>
        </Card>
    )
}

function QuestDrillModal({ id, onClose }: { id: number; onClose: () => void }) {
    const [data, setData] = useState<any>(null)
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        (async () => {
            setLoading(true); setErr('')
            try { setData(await jsonFetch(`/api/admin/quests/${id}`)) }
            catch (e: any) { setErr(e.message) }
            finally { setLoading(false) }
        })()
    }, [id])

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="relative w-full max-w-3xl bg-[#080808] border border-white/10 rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
                <button onClick={onClose} className="absolute top-3 right-3 text-white/30 hover:text-white text-sm">✕</button>
                {loading ? <Loading /> : err ? <ErrorBox msg={err} /> : data && (
                    <div className="flex flex-col gap-4">
                        <div>
                            <h3 className="text-base font-black uppercase tracking-tight text-white">{data.quest.title}</h3>
                            <a href={data.quest.tweet_url} target="_blank" rel="noreferrer" className="text-[10px] font-mono text-[#3b82f6] hover:underline flex items-center gap-1 mt-1"><ExternalLink size={10} />{data.quest.tweet_url}</a>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <Card><Stat label="Total claims" value={fmt(data.stats.total_claims)} accent="blue" /></Card>
                            <Card><Stat label="XP distributed" value={fmt(data.stats.xp_distributed)} accent="green" hint="100 XP per claim" /></Card>
                        </div>

                        {data.stats.per_day && data.stats.per_day.length > 0 && (
                            <Card title="Claims per day">
                                <Histogram
                                    data={data.stats.per_day.map((d: any) => ({ label: d.day.slice(5), value: d.count }))}
                                    accent="#3b82f6"
                                    height={80}
                                />
                            </Card>
                        )}

                        {data.stats.top_handles && data.stats.top_handles.length > 0 && (
                            <Card title="Top X handles (by distinct wallets claiming with that handle)">
                                <Table headers={['#', 'Handle', 'Wallets']} rows={data.stats.top_handles.map((h: any, i: number) => [
                                    <span key="r" className="font-mono text-white/40">{i + 1}</span>,
                                    <span key="h" className="font-mono text-white text-xs">{h.handle}</span>,
                                    <span key="w" className="font-mono text-[#3b82f6] font-bold">{h.wallets}</span>,
                                ])} />
                            </Card>
                        )}

                        {data.recentClaims && data.recentClaims.length > 0 && (
                            <Card title={`Recent claims (last ${data.recentClaims.length})`}>
                                <Table headers={['Wallet', 'X handle', 'Proof', 'When']} rows={data.recentClaims.slice(0, 30).map((c: any) => [
                                    <span key="w" className="font-mono text-xs text-white">{shortWallet(c.wallet_address)}</span>,
                                    <span key="x" className="text-[10px] text-white/60">{c.x_handle ?? '—'}</span>,
                                    c.proof_link
                                        ? <a key="p" href={c.proof_link} target="_blank" rel="noreferrer" className="text-[10px] text-[#3b82f6] hover:underline flex items-center gap-1"><ExternalLink size={9} /> link</a>
                                        : <span key="p" className="text-white/30">—</span>,
                                    <span key="t" className="font-mono text-[10px] text-white/40">{new Date(c.claimed_at).toLocaleString()}</span>,
                                ])} />
                            </Card>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

/** Format an ISO string for <input type="datetime-local"> (which expects local-time YYYY-MM-DDTHH:mm). */
function toLocalInput(iso: string): string {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Window switcher ───────────────────────────────────────────────────────────

function WindowSwitcher({ value, onChange, onRefresh }: { value: Window; onChange: (v: Window) => void; onRefresh: () => void }) {
    return (
        <div className="flex items-center gap-2 justify-end">
            <div className="flex bg-white/5 rounded-xl border border-white/10 p-0.5">
                {(['24h', '7d', '30d', 'all'] as Window[]).map(w => (
                    <button key={w} onClick={() => onChange(w)} className={`px-3 h-7 text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors ${value === w ? 'bg-[#3b82f6] text-white' : 'text-white/40 hover:text-white'}`}>{w === 'all' ? 'All-time' : w}</button>
                ))}
            </div>
            <button onClick={onRefresh} className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-[#666666] hover:text-white"><RefreshCcw size={12} /> Refresh</button>
        </div>
    )
}

// ── Generic table ─────────────────────────────────────────────────────────────

function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
    if (!rows || rows.length === 0) return <p className="text-center text-xs text-white/30 py-6">No data</p>
    return (
        <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-[11px]">
                <thead>
                    <tr className="text-left">
                        {/* ключ по индексу: пустые заголовки у колонок-действий
                            иначе дают одинаковый ключ и React ругается */}
                        {headers.map((h, i) => <th key={i} className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 pb-2 px-2">{h}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i} className="border-t border-white/5">
                            {row.map((cell, j) => <td key={j} className="px-2 py-2 align-middle">{cell}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function SpltpnlPage() {
    const [tab, setTab] = useState<TabId>('overview')

    const logout = async () => {
        if (!confirm('Logout from admin?')) return
        try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }) } catch {}
        window.location.href = '/coming-soon'
    }

    const TabBody = useMemo(() => {
        switch (tab) {
            case 'overview': return <OverviewTab />
            case 'cards':    return <CardsTab />
            case 'profit':   return <ProfitPanel />
            case 'users':    return <UsersTab />
            case 'prizes':   return <PrizesTab />
            case 'quests':   return <QuestsTab />
        }
    }, [tab])

    return (
        <div className="min-h-screen flex flex-col">
            <header className="border-b border-white/10 sticky top-0 bg-black/95 backdrop-blur z-40">
                <div className="max-w-[1400px] mx-auto flex items-center gap-4 px-5 h-14">
                    <Sparkles size={16} className="text-[#3b82f6]" />
                    <h1 className="text-sm font-black uppercase tracking-widest">SPLTPNL</h1>
                    <span className="text-[9px] font-mono text-white/30">admin</span>
                    <div className="ml-auto flex items-center gap-3">
                        <a href="/" className="text-[10px] font-bold uppercase tracking-widest text-[#666666] hover:text-white">Site →</a>
                        <button onClick={logout} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#666666] hover:text-white"><LogOut size={12} /> Logout</button>
                    </div>
                </div>
                <nav className="max-w-[1400px] mx-auto flex overflow-x-auto px-3 gap-1 -mb-px">
                    {TABS.map(t => {
                        const Icon = t.icon
                        const active = tab === t.id
                        return (
                            <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest border-b-2 whitespace-nowrap transition-colors ${active ? 'text-white border-[#3b82f6]' : 'text-white/40 border-transparent hover:text-white/70'}`}>
                                <Icon size={12} /> {t.label}
                            </button>
                        )
                    })}
                </nav>
            </header>

            <main className="max-w-[1400px] mx-auto w-full px-5 py-6">
                <AnimatePresence mode="wait">
                    <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                        {TabBody}
                    </motion.div>
                </AnimatePresence>
            </main>
        </div>
    )
}
