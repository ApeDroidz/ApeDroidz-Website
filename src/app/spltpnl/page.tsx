'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, AlertTriangle, BarChart3, BoxSelect, Coins, ExternalLink, Gamepad2, Loader2, LogOut, Package, Pencil, Plane, Plus, RefreshCcw, Search, ShieldAlert, Sparkles, Target, Trash2, Trophy, Users } from 'lucide-react'

// ── Types (loose — coming from server JSON) ───────────────────────────────────

type Window = '24h' | '7d' | '30d' | 'all'

const TABS = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'cards', label: 'Cards', icon: Gamepad2 },
    { id: 'flight', label: 'Flight', icon: Plane },
    { id: 'season', label: 'Season 2', icon: Trophy },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'prizes', label: 'Prizes', icon: Package },
    { id: 'quests', label: 'Quests', icon: Target },
    { id: 'health', label: 'Health', icon: ShieldAlert },
] as const
type TabId = typeof TABS[number]['id']

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
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)
    const load = useCallback(async () => {
        setLoading(true); setErr('')
        try { setData(await jsonFetch('/api/admin/stats/overview')) }
        catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])
    useEffect(() => { load() }, [load])

    if (loading && !data) return <Loading />
    if (err) return <ErrorBox msg={err} />
    if (!data) return null

    const lt = data.lifetime ?? {}
    const liab = data.liability ?? null
    const trends = data.trends ?? { dau: [], signups: [] }
    const dauSeries = (trends.dau ?? []).map((d: any) => Number(d.cards_dau) + Number(d.flight_dau))
    const cardsDauSeries = (trends.dau ?? []).map((d: any) => Number(d.cards_dau))
    const flightDauSeries = (trends.dau ?? []).map((d: any) => Number(d.flight_dau))
    const revSeries = (trends.dau ?? []).map((d: any) => Number(d.ape_revenue))
    const depSeries = (trends.dau ?? []).map((d: any) => Number(d.ape_deposits))
    const wdSeries = (trends.dau ?? []).map((d: any) => Number(d.ape_withdrawals))
    const signupsSeries = (trends.signups ?? []).map((d: any) => Number(d.signups))
    const cumulativeUsers = (trends.signups ?? []).map((d: any) => Number(d.cumulative))
    const today = (trends.signups ?? []).slice(-1)[0]
    const last7Signups = (trends.signups ?? []).slice(-7).reduce((s: number, d: any) => s + Number(d.signups), 0)
    const last30Signups = (trends.signups ?? []).reduce((s: number, d: any) => s + Number(d.signups), 0)

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/30">{new Date(data.generatedAt).toLocaleString()}</span>
                <button onClick={load} className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-white/40 hover:text-white">
                    <RefreshCcw size={12} /> Refresh
                </button>
            </div>

            {/* Status row */}
            <Card className={data.maintenance ? 'border-orange-500/30 bg-orange-500/5' : ''}>
                <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${data.maintenance ? 'bg-orange-400 animate-pulse' : 'bg-emerald-400'}`} />
                    <span className="text-sm font-black uppercase tracking-wider">
                        {data.maintenance ? 'Maintenance mode ON' : 'Site is LIVE'}
                    </span>
                    <span className="text-[10px] text-white/40 ml-auto font-mono">
                        {data.maintenance ? 'Public sees /coming-soon' : 'Public access enabled'}
                    </span>
                </div>
            </Card>

            {/* SQL migration not applied banner */}
            {data.migrationNeeded && data.migrationNeeded.length > 0 && (
                <Card className="border-red-500/40 bg-red-500/10">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <h3 className="text-sm font-black uppercase tracking-wider text-red-400 mb-1">SQL migration not applied</h3>
                            <p className="text-xs text-white/70">
                                The analytics RPCs are missing. Lifetime totals, sparklines, and Users tab will show empty until you run{' '}
                                <code className="font-mono text-[10px] bg-black/40 px-1.5 py-0.5 rounded">supabase/migrations/20260428_admin_analytics.sql</code>{' '}
                                in Supabase SQL Editor.
                            </p>
                            <p className="text-[10px] text-white/40 font-mono mt-2">Missing: {data.migrationNeeded.join(', ')}</p>
                        </div>
                    </div>
                </Card>
            )}

            {/* ── 24h snapshot row ─────────────────────────────────────────── */}
            <div>
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-2">Last 24 hours</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card><Stat label="Cards plays" value={fmt(data.cards.playsToday)} hint={`${fmt(data.cards.plays7d)} in 7d`} /></Card>
                    <Card><Stat label="Flight bets" value={fmt(data.flight.betsToday)} hint={`${fmt(data.flight.bets7d)} in 7d`} accent="blue" /></Card>
                    <Card><Stat label="Cards revenue" value={`${fmt(data.cards.revenueApeToday, 2)} APE`} hint={`${fmt(data.cards.ticketsBoughtToday)} purchases`} accent="green" /></Card>
                    <Card>
                        <Stat
                            label="Flight net"
                            value={`${data.flight.netToday >= 0 ? '+' : ''}${fmt(data.flight.netToday, 2)} APE`}
                            hint={`Deposits ${fmt(data.flight.depositsApeToday, 2)} · Withdrawals ${fmt(data.flight.withdrawalsApeToday, 2)}`}
                            accent={data.flight.netToday >= 0 ? 'green' : 'red'}
                        />
                    </Card>
                </div>
            </div>

            {/* ── Lifetime totals row ──────────────────────────────────────── */}
            {lt && (
                <div>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-2">Lifetime totals</h3>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Card><Stat label="Cards plays" value={fmt(lt.total_card_plays)} hint={`${fmt(lt.total_card_errors)} errors`} /></Card>
                        <Card><Stat label="Cards revenue" value={`${fmt(lt.total_card_revenue, 2)} APE`} hint={`${fmt(lt.total_card_purchases)} purchases`} accent="green" /></Card>
                        <Card>
                            <Stat
                                label="Flight house edge"
                                value={`${fmt(data.derived?.lifetimeFlightHouseEdge ?? 0, 2)} APE`}
                                hint={`Volume ${fmt(lt.total_flight_volume, 2)} APE`}
                                accent={(data.derived?.lifetimeFlightHouseEdge ?? 0) >= 0 ? 'green' : 'red'}
                            />
                        </Card>
                        <Card><Stat label="Total NFTs claimed" value={fmt(lt.total_nfts_claimed)} hint={`${fmt(lt.total_rounds)} rounds played`} accent="orange" /></Card>
                    </div>
                </div>
            )}

            {/* ── Vault liability ──────────────────────────────────────────── */}
            {liab && (
                <Card title="Vault liability — APE owed to players right now" className="border-yellow-500/20 bg-yellow-500/5">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
                        <Stat label="Total liability" value={`${fmt(liab.total_balance, 4)} APE`} accent="orange" hint="If everyone withdraws now" />
                        <Stat label="Players w/ balance" value={fmt(liab.players)} hint="Active flight wallets" />
                        <Stat label="Largest balance" value={`${fmt(liab.max_balance, 4)} APE`} hint="Single biggest holder" />
                        <Stat label="Mean balance" value={`${fmt(liab.mean_balance, 4)} APE`} />
                    </div>
                </Card>
            )}

            {/* ── 30-day trend charts ──────────────────────────────────────── */}
            {dauSeries.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <Card title="DAU 30 days (cards + flight combined)">
                        <Sparkline data={dauSeries} accent="#3b82f6" />
                        <div className="text-[10px] text-white/30 font-mono mt-2">
                            Latest: {dauSeries.slice(-1)[0]} · Peak: {Math.max(...dauSeries)}
                        </div>
                    </Card>
                    <Card title="Cards revenue 30d (APE)">
                        <Sparkline data={revSeries} accent="#10b981" />
                        <div className="text-[10px] text-white/30 font-mono mt-2">
                            7d total: {fmt(revSeries.slice(-7).reduce((s: number, n: number) => s + n, 0), 2)} APE
                        </div>
                    </Card>
                    <Card title="Flight money flow 30d">
                        <div className="flex flex-col gap-1">
                            <Sparkline data={depSeries} accent="#10b981" label="Deposits" />
                            <Sparkline data={wdSeries} accent="#ef4444" label="Withdrawals" />
                        </div>
                    </Card>
                </div>
            )}

            {/* ── Cards vs Flight DAU split ───────────────────────────────── */}
            {cardsDauSeries.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <Card title="Cards DAU 30d">
                        <Sparkline data={cardsDauSeries} accent="#3b82f6" />
                        <div className="text-[10px] text-white/30 font-mono mt-2">Latest {cardsDauSeries.slice(-1)[0]} · Peak {Math.max(...cardsDauSeries)}</div>
                    </Card>
                    <Card title="Flight DAU 30d">
                        <Sparkline data={flightDauSeries} accent="#f97316" />
                        <div className="text-[10px] text-white/30 font-mono mt-2">Latest {flightDauSeries.slice(-1)[0]} · Peak {Math.max(...flightDauSeries)}</div>
                    </Card>
                </div>
            )}

            {/* ── Signups & cumulative users ───────────────────────────────── */}
            {signupsSeries.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <Card title="Signups 30 days">
                        <Sparkline data={signupsSeries} accent="#a855f7" />
                        <div className="grid grid-cols-3 gap-2 mt-3 text-[10px]">
                            <div><div className="text-white/30 font-bold uppercase tracking-widest">Today</div><div className="font-mono text-white">{today?.signups ?? 0}</div></div>
                            <div><div className="text-white/30 font-bold uppercase tracking-widest">7d</div><div className="font-mono text-white">{last7Signups}</div></div>
                            <div><div className="text-white/30 font-bold uppercase tracking-widest">30d</div><div className="font-mono text-white">{last30Signups}</div></div>
                        </div>
                    </Card>
                    <Card title="Cumulative users (30d)">
                        <Sparkline data={cumulativeUsers} accent="#a855f7" />
                        <div className="text-[10px] text-white/30 font-mono mt-2">Now: {cumulativeUsers.slice(-1)[0]} total</div>
                    </Card>

                    <Card title="Health" className={(data.health.pendingInvestigation > 0 || data.health.errorsToday > 5) ? 'border-red-500/30' : ''}>
                        <div className="flex flex-col gap-3 mt-2">
                            <div className="flex items-center justify-between text-sm"><span className="text-white/50">Pending investigation</span><span className={`font-mono font-bold ${data.health.pendingInvestigation > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{fmt(data.health.pendingInvestigation)}</span></div>
                            <div className="flex items-center justify-between text-sm"><span className="text-white/50">Cards errors 24h</span><span className={`font-mono font-bold ${data.health.errorsToday > 5 ? 'text-orange-400' : 'text-white/60'}`}>{fmt(data.health.errorsToday)}</span></div>
                            {data.season2.topWallet && (
                                <div className="border-t border-white/10 pt-3 flex flex-col gap-1">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">S2 leader</span>
                                    <span className="font-mono text-xs text-white">{shortWallet(data.season2.topWallet)} · {fmt(data.season2.topXp)} XP</span>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            )}
        </div>
    )
}

// ── Tab: Cards ────────────────────────────────────────────────────────────────

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

// ── Tab: Flight ───────────────────────────────────────────────────────────────

function FlightTab() {
    const [win, setWin] = useState<Window>('24h')
    const [data, setData] = useState<any>(null)
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)
    const load = useCallback(async () => {
        setLoading(true); setErr('')
        try { setData(await jsonFetch(`/api/admin/stats/flight?window=${win}`)) }
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
                        <Card><Stat label="Rounds" value={fmt(data.rounds)} /></Card>
                        <Card><Stat label="Bets" value={fmt(data.betsCount)} hint={`${fmt(data.uniquePlayers)} players · avg ${fmt(data.volume.avgBet, 2)}`} accent="blue" /></Card>
                        <Card><Stat label="Volume" value={`${fmt(data.volume.totalBets, 2)} APE`} hint={`Payout ${fmt(data.volume.totalPayout, 2)}`} /></Card>
                        <Card>
                            <Stat
                                label="House edge realised"
                                value={`${fmt(data.volume.houseEdgeRealised, 2)} APE`}
                                hint={`${data.volume.edgePct.toFixed(2)}% of volume · win rate ${data.outcome.winRate?.toFixed(1)}%`}
                                accent={data.volume.houseEdgeRealised >= 0 ? 'green' : 'red'}
                            />
                        </Card>
                    </div>

                    {/* ── Vault liability ─────────────────────────────── */}
                    {data.liability && (
                        <Card title="Vault liability (snapshot — independent of window)" className="border-yellow-500/20 bg-yellow-500/5">
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
                                <Stat label="Total APE owed" value={`${fmt(data.liability.total_balance, 4)} APE`} accent="orange" />
                                <Stat label="Players holding APE" value={fmt(data.liability.players)} />
                                <Stat label="Largest single balance" value={`${fmt(data.liability.max_balance, 4)} APE`} />
                                <Stat label="Mean balance" value={`${fmt(data.liability.mean_balance, 4)} APE`} />
                            </div>
                            <p className="text-[9px] text-white/30 mt-3 font-mono">Compare with vault wallet's actual balance on-chain to verify solvency.</p>
                        </Card>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        <Card title="Outcome">
                            <div className="flex flex-col gap-2 mt-2">
                                <div className="flex items-center justify-between"><span className="text-emerald-400 text-sm font-bold">Winners</span><span className="font-mono">{fmt(data.outcome.winners)}</span></div>
                                <div className="flex items-center justify-between"><span className="text-red-400 text-sm font-bold">Losers</span><span className="font-mono">{fmt(data.outcome.losers)}</span></div>
                            </div>
                        </Card>
                        <Card title="Money flow">
                            <div className="flex flex-col gap-2 mt-2 text-sm">
                                <div className="flex items-center justify-between"><span className="text-white/50">Deposits</span><span className="font-mono text-emerald-400">+{fmt(data.money.deposits, 2)}</span></div>
                                <div className="flex items-center justify-between"><span className="text-white/50">Withdrawals</span><span className="font-mono text-red-400">−{fmt(data.money.withdrawals, 2)}</span></div>
                                <div className="border-t border-white/10 pt-2 flex items-center justify-between font-bold"><span>Net</span><span className={`font-mono ${data.money.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{data.money.net >= 0 ? '+' : ''}{fmt(data.money.net, 2)}</span></div>
                            </div>
                        </Card>
                        <Card title="Queue" className={(data.queue.pendingInvestigation.length > 0 || data.queue.pendingWithdrawals.length > 5) ? 'border-orange-500/30' : ''}>
                            <div className="flex flex-col gap-2 mt-2 text-sm">
                                <div className="flex items-center justify-between"><span className="text-white/50">Pending withdrawals</span><span className={`font-mono font-bold ${data.queue.pendingWithdrawals.length > 5 ? 'text-orange-400' : 'text-white/60'}`}>{data.queue.pendingWithdrawals.length}</span></div>
                                <div className="flex items-center justify-between"><span className="text-white/50">Pending investigation</span><span className={`font-mono font-bold ${data.queue.pendingInvestigation.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{data.queue.pendingInvestigation.length}</span></div>
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <Card title="Top profits">
                            <Table headers={['Wallet', 'Profit', 'Mult']} rows={data.topProfits.slice(0, 10).map((r: any) => [
                                shortWallet(r.wallet_address),
                                <span key="p" className="font-mono text-emerald-400">+{fmt(r.profit, 4)}</span>,
                                <span key="m" className="font-mono text-white/60">{r.cashout_at?.toFixed(2)}x</span>,
                            ])} />
                        </Card>
                        <Card title="Biggest losses">
                            <Table headers={['Wallet', 'Bet']} rows={data.biggestLosses.slice(0, 10).map((r: any) => [
                                shortWallet(r.wallet_address),
                                <span key="b" className="font-mono text-red-400">−{fmt(r.bet_amount, 2)}</span>,
                            ])} />
                        </Card>
                    </div>

                    {/* ── Crash histogram ─────────────────────────────── */}
                    {data.crashHistogram && data.crashHistogram.length > 0 && (
                        <Card title="Crash-point distribution (provably fair audit)">
                            <Histogram
                                data={data.crashHistogram.map((b: any) => ({ label: b.bucket.replace('x', ''), value: Number(b.cnt) }))}
                                accent="#f97316"
                                height={120}
                            />
                            <p className="text-[9px] text-white/30 mt-3 font-mono">Buckets: 1.00-1.09x · 1.10-1.49x · 1.50-1.99x · 2.00-2.99x · 3-5x · 5-10x · 10-20x · 20+x</p>
                        </Card>
                    )}

                    {data.queue.pendingInvestigation.length > 0 && (
                        <Card title="🚨 Pending investigation — review needed" className="border-red-500/30">
                            <Table headers={['Wallet', 'Type', 'Amount', 'TX', 'Created']} rows={data.queue.pendingInvestigation.map((r: any) => [
                                shortWallet(r.wallet_address),
                                <span key="ty" className="text-[10px] uppercase tracking-widest text-white/50">{r.type}</span>,
                                <span key="a" className="font-mono">{fmt(r.amount, 4)}</span>,
                                r.tx_hash ? <a key="t" href={`https://apescan.io/tx/${r.tx_hash}`} target="_blank" rel="noreferrer" className="font-mono text-[#3b82f6] hover:underline">{r.tx_hash.slice(0, 12)}…</a> : <span key="t" className="text-white/30">—</span>,
                                new Date(r.created_at).toLocaleString(),
                            ])} />
                        </Card>
                    )}
                </>
            )}
        </div>
    )
}

// ── Tab: Season ───────────────────────────────────────────────────────────────

function SeasonTab() {
    const [data, setData] = useState<any>(null)
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)
    const load = useCallback(async () => {
        setLoading(true); setErr('')
        try { setData(await jsonFetch('/api/admin/stats/season')) }
        catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])
    useEffect(() => { load() }, [load])

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-end">
                <button onClick={load} className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-white/40 hover:text-white"><RefreshCcw size={12} /> Refresh</button>
            </div>
            {loading && !data ? <Loading /> : err ? <ErrorBox msg={err} /> : data && (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Card><Stat label="Total S2 XP" value={fmt(data.totalSeasonXp)} accent="blue" /></Card>
                        <Card><Stat label="Registered" value={fmt(data.registeredUsers)} /></Card>
                        <Card><Stat label="DAU 24h" value={fmt(data.dau.last24h)} hint={`7d: ${fmt(data.dau.last7d)}, 30d: ${fmt(data.dau.last30d)}`} /></Card>
                        <Card><Stat label="Quests today" value={fmt(data.questsToday.total)} hint={`${fmt(data.questsToday.xpDistributed)} XP given`} accent="green" /></Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <Card title="Quests today — breakdown">
                            <div className="flex flex-col gap-2 mt-2">
                                {data.questsToday.breakdown.length === 0 && <p className="text-xs text-white/30">No quests claimed today</p>}
                                {data.questsToday.breakdown.map((row: any) => (
                                    <Bar key={row.quest} label={row.quest} value={row.count} max={data.questsToday.breakdown[0]?.count ?? 1} accent="#10b981" />
                                ))}
                            </div>
                        </Card>

                        <Card title={`Streaks — week ${data.streaksThisWeek.weekMonday}`}>
                            <div className="flex flex-col gap-2 mt-2">
                                {data.streaksThisWeek.distribution.length === 0 && <p className="text-xs text-white/30">No streak claims this week</p>}
                                {data.streaksThisWeek.distribution.map((row: any) => (
                                    <Bar key={row.day} label={`Day ${row.day}`} value={row.count} max={data.streaksThisWeek.distribution[0]?.count ?? 1} accent="#f97316" />
                                ))}
                            </div>
                        </Card>
                    </div>

                    {/* ── XP tier distribution + 7d XP trend ───────────────── */}
                    {(data.xpTiers && data.xpTiers.length > 0) && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <Card title="XP tier distribution (all-time)">
                                <Histogram
                                    data={data.xpTiers.map((t: any) => ({ label: t.tier, value: Number(t.cnt) }))}
                                    accent="#3b82f6"
                                    height={120}
                                />
                                <p className="text-[9px] text-white/30 mt-3 font-mono">Each bar = users at that XP range. Wider top tiers = strong engagement.</p>
                            </Card>

                            <Card title="XP distributed via quests (last 7d)">
                                {data.xpDistributedTrend7d && data.xpDistributedTrend7d.length > 0 ? (
                                    <>
                                        <Sparkline data={data.xpDistributedTrend7d.map((d: any) => Number(d.xp))} accent="#10b981" />
                                        <div className="text-[10px] text-white/30 font-mono mt-2">7d total: {fmt(data.xpDistributedTrend7d.reduce((s: number, d: any) => s + Number(d.xp), 0))} XP</div>
                                    </>
                                ) : <p className="text-xs text-white/30">No data</p>}
                            </Card>
                        </div>
                    )}

                    <Card title="Top 50 leaderboard">
                        <Table headers={['#', 'Wallet', 'XP', 'Plays', 'Last seen']} rows={data.top50.map((r: any, i: number) => [
                            <span key="r" className="font-mono text-white/40">{i + 1}</span>,
                            <span key="w" className="font-mono text-white">{shortWallet(r.wallet_address)}</span>,
                            <span key="x" className="font-mono text-[#3b82f6] font-bold">{fmt(r.season_xp)}</span>,
                            <span key="p" className="font-mono text-white/40">{fmt(r.games_played)}</span>,
                            <span key="t" className="font-mono text-[10px] text-white/30">{r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '—'}</span>,
                        ])} />
                    </Card>
                </>
            )}
        </div>
    )
}

// ── Tab: Prizes ───────────────────────────────────────────────────────────────

function PrizesTab() {
    const [prizes, setPrizes] = useState<any[]>([])
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [showInv, setShowInv] = useState(false)
    const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

    const load = useCallback(async () => {
        setLoading(true); setErr('')
        try { setPrizes((await jsonFetch('/api/admin/prizes')).prizes ?? []) }
        catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])
    useEffect(() => { load() }, [load])

    const flash = (kind: 'success' | 'error', text: string) => {
        setMsg({ kind, text })
        window.setTimeout(() => setMsg(null), 3500)
    }

    const toggleActive = async (id: string, active: boolean) => {
        try {
            await jsonFetch(`/api/admin/prizes/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: active }),
            })
            flash('success', `${id} → ${active ? 'active' : 'disabled'}`)
            load()
        } catch (e: any) { flash('error', e.message) }
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-black uppercase tracking-widest">Prize catalogue</h2>
                <div className="flex items-center gap-2">
                    <button onClick={() => setShowInv(s => !s)} className="text-[10px] font-black uppercase tracking-widest text-white/60 hover:text-white px-3 py-2 border border-white/10 rounded-xl flex items-center gap-1.5"><BoxSelect size={12} /> Inventory</button>
                    <button onClick={() => setShowForm(s => !s)} className="text-[10px] font-black uppercase tracking-widest text-white px-3 py-2 bg-[#3b82f6] hover:bg-[#2c63c4] rounded-xl flex items-center gap-1.5"><Plus size={12} /> New prize</button>
                    <button onClick={load} className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white"><RefreshCcw size={12} /></button>
                </div>
            </div>

            {msg && <div className={`px-3 py-2 rounded-xl text-xs ${msg.kind === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>{msg.text}</div>}

            {showForm && <PrizeForm onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); load(); flash('success', 'Prize created') }} />}
            {showInv && <InventoryPanel prizes={prizes} onMsg={flash} />}

            {loading ? <Loading /> : err ? <ErrorBox msg={err} /> : (
                <Card>
                    <Table headers={['ID', 'Name', 'Type', 'Drop %', 'XP', 'Amount', 'Active', '']} rows={prizes.map((p: any) => [
                        <span key="i" className="font-mono text-xs">{p.id}</span>,
                        p.name,
                        <span key="t" className="text-[10px] uppercase tracking-widest text-white/50">{p.type}</span>,
                        <span key="d" className="font-mono text-white/70">{p.drop_chance}</span>,
                        <span key="x" className="font-mono text-[#3b82f6]">{p.xp_reward ?? 0}</span>,
                        <span key="a" className="font-mono text-white/50">{p.amount ?? '—'}</span>,
                        <button key="ac" onClick={() => toggleActive(p.id, !p.is_active)} className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${p.is_active ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-white/5 text-white/30 border border-white/10'}`}>{p.is_active ? 'Active' : 'Disabled'}</button>,
                        <span key="z" />,
                    ])} />
                </Card>
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

function InventoryPanel({ prizes, onMsg }: { prizes: any[]; onMsg: (k: 'success' | 'error', t: string) => void }) {
    const [prizeId, setPrizeId] = useState(prizes.find((p: any) => p.type === 'nft')?.id ?? '')
    const [contract, setContract] = useState('')
    const [name, setName] = useState('')
    const [imageUrl, setImageUrl] = useState('')
    const [bulk, setBulk] = useState(false)
    const [tokenId, setTokenId] = useState('')
    const [count, setCount] = useState('1')
    const [startId, setStartId] = useState('')
    const [busy, setBusy] = useState(false)

    const suggestNext = useCallback(async () => {
        if (!prizeId) return
        try {
            const url = new URL('/api/admin/inventory', window.location.origin)
            url.searchParams.set('next', '1')
            url.searchParams.set('prize_type_id', prizeId)
            if (contract) url.searchParams.set('contract', contract)
            const d = await jsonFetch(url.toString())
            if (bulk) setStartId(d.nextTokenId)
            else setTokenId(d.nextTokenId)
            onMsg('success', `Next token_id = ${d.nextTokenId} (current max ${d.currentMax}, ${d.count} existing)`)
        } catch (e: any) { onMsg('error', e.message) }
    }, [prizeId, contract, bulk, onMsg])

    const submit = async () => {
        if (!prizeId || !contract || !name) return
        setBusy(true)
        try {
            const body: any = { prize_type_id: prizeId, contract_address: contract.trim(), name: name.trim(), image_url: imageUrl || undefined }
            if (bulk) {
                body.count = Number(count)
                if (startId) body.startTokenId = Number(startId)
            } else {
                body.token_id = tokenId
            }
            const r = await jsonFetch('/api/admin/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            onMsg('success', bulk ? `Inserted ${r.inserted} items` : 'Item added')
            setTokenId(''); setStartId('')
        } catch (e: any) { onMsg('error', e.message) }
        finally { setBusy(false) }
    }

    return (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-black uppercase tracking-widest">Inventory — add NFT</h3>
                <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={bulk} onChange={e => setBulk(e.target.checked)} /> Bulk
                </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Prize">
                    <select value={prizeId} onChange={e => setPrizeId(e.target.value)} className="bg-black/40 border border-white/10 rounded-xl h-10 px-3 text-sm focus:outline-none focus:border-emerald-400">
                        <option value="">— select —</option>
                        {prizes.filter((p: any) => p.type === 'nft').map((p: any) => <option key={p.id} value={p.id}>{p.id}</option>)}
                    </select>
                </FormField>
                <FormField label="Contract address (0x…)" value={contract} onChange={setContract} placeholder="0x..." />
                <FormField label="Name (auto-suffix #id if missing)" value={name} onChange={setName} placeholder="Epic Droid" className="sm:col-span-2" />
                <FormField label="Image URL" value={imageUrl} onChange={setImageUrl} placeholder="https://..." className="sm:col-span-2" />
                {!bulk ? (
                    <FormField label="Token ID">
                        <div className="flex items-center gap-2">
                            <input value={tokenId} onChange={e => setTokenId(e.target.value)} className="flex-1 bg-black/40 border border-white/10 rounded-xl h-10 px-3 text-sm focus:outline-none focus:border-emerald-400" placeholder="42" />
                            <button onClick={suggestNext} className="h-10 px-3 text-[10px] font-bold uppercase tracking-widest bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl">auto-fill next</button>
                        </div>
                    </FormField>
                ) : (
                    <>
                        <FormField label="Count" value={count} onChange={setCount} placeholder="10" />
                        <FormField label="Start token ID (blank = auto)">
                            <div className="flex items-center gap-2">
                                <input value={startId} onChange={e => setStartId(e.target.value)} className="flex-1 bg-black/40 border border-white/10 rounded-xl h-10 px-3 text-sm focus:outline-none focus:border-emerald-400" placeholder="auto" />
                                <button onClick={suggestNext} className="h-10 px-3 text-[10px] font-bold uppercase tracking-widest bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl">auto</button>
                            </div>
                        </FormField>
                    </>
                )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
                <button onClick={submit} disabled={busy || !prizeId || !contract || !name} className="px-4 h-9 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 rounded-xl text-[10px] uppercase font-black tracking-widest text-white flex items-center gap-2">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} {bulk ? `Insert ${count}` : 'Add'}
                </button>
            </div>
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

function HealthTab() {
    const [data, setData] = useState<any>(null)
    const [err, setErr] = useState('')
    const [loading, setLoading] = useState(true)
    const load = useCallback(async () => {
        setLoading(true); setErr('')
        try { setData(await jsonFetch('/api/admin/health')) }
        catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])
    useEffect(() => { load() }, [load])

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/30">{data?.generatedAt && new Date(data.generatedAt).toLocaleString()}</span>
                <button onClick={load} className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-white/40 hover:text-white"><RefreshCcw size={12} /> Refresh</button>
            </div>

            {loading && !data ? <Loading /> : err ? <ErrorBox msg={err} /> : data && (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Card><Stat label="Pending invest." value={fmt(data.stats.pendingInvestigationCount)} accent={data.stats.pendingInvestigationCount > 0 ? 'red' : 'green'} /></Card>
                        <Card><Stat label="Stuck withdrawals" value={fmt(data.stats.stuckWithdrawalsCount)} accent={data.stats.stuckWithdrawalsCount > 0 ? 'red' : 'green'} /></Card>
                        <Card><Stat label="Cards errors 24h" value={fmt(data.stats.cardsErrors24hCount)} accent={data.stats.cardsErrors24hCount > 5 ? 'orange' : 'white'} /></Card>
                        <Card><Stat label="Multi-account flags" value={fmt(data.stats.multiAccountFlags)} accent={data.stats.multiAccountFlags > 0 ? 'orange' : 'white'} /></Card>
                    </div>

                    {data.alerts.length === 0 ? (
                        <Card><p className="text-center text-emerald-400 py-8 text-sm">✓ No anomalies detected</p></Card>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {data.alerts.map((a: any, i: number) => <AlertCard key={a.kind ?? i} alert={a} onResolved={load} />)}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

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
                    {alert.detail && <button onClick={() => setOpen(o => !o)} className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white">{open ? 'Hide' : 'Detail'}</button>}
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
    const [view, setView] = useState<'top' | 'profits' | 'losers' | 'recent'>('top')

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
                    {drillDown && <button onClick={() => { setDrillDown(null); setSearch('') }} className="h-10 px-3 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white">Clear</button>}
                </div>
                {drillError && <p className="text-xs text-red-400 mt-2">{drillError}</p>}
            </Card>

            {drillDown ? <WalletDrillDown data={drillDown} /> : (
                <>
                    <div className="flex items-center justify-between">
                        <div className="flex bg-white/5 rounded-xl border border-white/10 p-0.5">
                            {([['top', 'Top spenders'], ['profits', 'Top profits'], ['losers', 'Worst losers'], ['recent', 'Recent signups']] as const).map(([id, label]) => (
                                <button key={id} onClick={() => setView(id as any)} className={`px-3 h-7 text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors ${view === id ? 'bg-[#3b82f6] text-white' : 'text-white/40 hover:text-white'}`}>{label}</button>
                            ))}
                        </div>
                        <button onClick={load} className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-white/40 hover:text-white"><RefreshCcw size={12} /> Refresh</button>
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

                            {view === 'profits' && (
                                <Card title="Top 50 Flight profits (all-time)">
                                    <Table headers={['#', 'Wallet', 'Profit', 'Volume', 'Wins/Losses']} rows={(data.topProfits ?? []).map((u: any, i: number) => [
                                        <span key="r" className="font-mono text-white/40">{i + 1}</span>,
                                        <button key="w" onClick={() => { setSearch(u.wallet_address); performSearch(u.wallet_address) }} className="font-mono text-[#3b82f6] hover:underline">{shortWallet(u.wallet_address)}</button>,
                                        <span key="p" className={`font-mono font-bold ${Number(u.total_profit) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{Number(u.total_profit) >= 0 ? '+' : ''}{fmt(u.total_profit, 4)}</span>,
                                        <span key="v" className="font-mono text-white/60">{fmt(u.total_volume, 2)}</span>,
                                        <span key="wl" className="font-mono text-[10px]"><span className="text-emerald-400">{u.wins}W</span>/<span className="text-red-400">{u.losses}L</span></span>,
                                    ])} />
                                </Card>
                            )}

                            {view === 'losers' && (
                                <Card title="Top 50 Flight losses (all-time)">
                                    <Table headers={['#', 'Wallet', 'Total lost', 'Volume', 'Plays']} rows={(data.worstLosers ?? []).map((u: any, i: number) => [
                                        <span key="r" className="font-mono text-white/40">{i + 1}</span>,
                                        <button key="w" onClick={() => { setSearch(u.wallet_address); performSearch(u.wallet_address) }} className="font-mono text-[#3b82f6] hover:underline">{shortWallet(u.wallet_address)}</button>,
                                        <span key="l" className="font-mono text-red-400 font-bold">−{fmt(u.total_loss, 4)}</span>,
                                        <span key="v" className="font-mono text-white/60">{fmt(u.total_volume, 2)}</span>,
                                        <span key="p" className="font-mono text-white/40">{u.plays}</span>,
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
                    <Stat label="Tickets balance" value={fmt(s.games_balance)} hint={`Flight: ${fmt(s.flight_balance, 4)} APE`} accent="green" />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-white/10">
                    <Stat label="Cards plays" value={fmt(s.cards_plays)} hint={`${fmt(s.cards_nfts_won)} NFTs won`} />
                    <Stat label="Cards spent" value={`${fmt(s.cards_ape_spent, 2)} APE`} accent="green" />
                    <Stat label="Flight bets" value={fmt(s.flight_bets)} hint={`Profit ${fmt(s.flight_total_profit, 4)} APE`} accent={Number(s.flight_total_profit) >= 0 ? 'green' : 'red'} />
                    <Stat label="Flight in/out" value={`+${fmt(s.flight_deposits, 2)}/−${fmt(s.flight_withdrawals, 2)}`} accent="blue" />
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

                <Card title="Recent Flight bets (last 30)">
                    <Table headers={['Bet', 'Mult', 'Profit', 'When']} rows={(data.recentFlight ?? []).slice(0, 15).map((r: any) => [
                        <span key="b" className="font-mono">{fmt(r.bet_amount, 2)}</span>,
                        <span key="m" className="font-mono text-white/60">{r.cashout_at ? `${Number(r.cashout_at).toFixed(2)}x` : '✗ lost'}</span>,
                        <span key="p" className={`font-mono ${Number(r.profit) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{r.profit != null ? (Number(r.profit) >= 0 ? '+' : '') + fmt(r.profit, 4) : '—'}</span>,
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
                    <button onClick={load} className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white">
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
            <button onClick={onRefresh} className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-white/40 hover:text-white"><RefreshCcw size={12} /> Refresh</button>
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
                        {headers.map(h => <th key={h} className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 pb-2 px-2">{h}</th>)}
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
            case 'flight':   return <FlightTab />
            case 'season':   return <SeasonTab />
            case 'users':    return <UsersTab />
            case 'prizes':   return <PrizesTab />
            case 'quests':   return <QuestsTab />
            case 'health':   return <HealthTab />
        }
    }, [tab])

    return (
        <div className="min-h-screen flex flex-col">
            <header className="border-b border-white/10 sticky top-0 bg-black/95 backdrop-blur z-40">
                <div className="max-w-[1400px] mx-auto flex items-center gap-4 px-5 h-14">
                    <Sparkles size={16} className="text-[#3b82f6]" />
                    <h1 className="text-sm font-black uppercase tracking-widest">SPLTPNL</h1>
                    <span className="text-[9px] font-mono text-white/30">admin · season 2</span>
                    <div className="ml-auto flex items-center gap-3">
                        <a href="/" className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white">Site →</a>
                        <button onClick={logout} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white"><LogOut size={12} /> Logout</button>
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
