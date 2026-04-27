'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, AlertTriangle, BarChart3, BoxSelect, Coins, Gamepad2, Loader2, LogOut, Package, Plane, Plus, RefreshCcw, ShieldAlert, Sparkles, Trophy } from 'lucide-react'

// ── Types (loose — coming from server JSON) ───────────────────────────────────

type Window = '24h' | '7d' | '30d'

const TABS = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'cards', label: 'Cards', icon: Gamepad2 },
    { id: 'flight', label: 'Flight', icon: Plane },
    { id: 'season', label: 'Season 2', icon: Trophy },
    { id: 'prizes', label: 'Prizes', icon: Package },
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

            {/* 4-up stat row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card><Stat label="Cards plays 24h" value={fmt(data.cards.playsToday)} hint={`${fmt(data.cards.plays7d)} in 7d`} /></Card>
                <Card><Stat label="Flight bets 24h" value={fmt(data.flight.betsToday)} hint={`${fmt(data.flight.bets7d)} in 7d`} accent="blue" /></Card>
                <Card><Stat label="Cards revenue 24h" value={`${fmt(data.cards.revenueApeToday, 2)} APE`} hint={`${fmt(data.cards.ticketsBoughtToday)} purchases`} accent="green" /></Card>
                <Card>
                    <Stat
                        label="Flight net 24h"
                        value={`${data.flight.netToday >= 0 ? '+' : ''}${fmt(data.flight.netToday, 2)} APE`}
                        hint={`Net 7d: ${data.flight.net7d >= 0 ? '+' : ''}${fmt(data.flight.net7d, 2)}`}
                        accent={data.flight.netToday >= 0 ? 'green' : 'red'}
                    />
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <Card title="Money flow 24h">
                    <div className="flex flex-col gap-3 mt-2">
                        <div className="flex items-center justify-between text-sm"><span className="text-white/50">Deposits</span><span className="font-mono text-emerald-400">+{fmt(data.flight.depositsApeToday, 2)} APE</span></div>
                        <div className="flex items-center justify-between text-sm"><span className="text-white/50">Withdrawals</span><span className="font-mono text-red-400">−{fmt(data.flight.withdrawalsApeToday, 2)} APE</span></div>
                        <div className="border-t border-white/10 pt-3 flex items-center justify-between text-sm"><span className="text-white font-bold">Net</span><span className={`font-mono font-black ${data.flight.netToday >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{data.flight.netToday >= 0 ? '+' : ''}{fmt(data.flight.netToday, 2)}</span></div>
                    </div>
                </Card>

                <Card title="Users">
                    <div className="flex flex-col gap-3 mt-2">
                        <Stat label="Total wallets" value={fmt(data.users.total)} />
                        <Stat label="Glitch users" value={fmt(data.users.glitchUsers)} hint="Have ticket balance / X handle" />
                    </div>
                </Card>

                <Card title="Health" className={(data.health.pendingInvestigation > 0 || data.health.errorsToday > 5) ? 'border-red-500/30' : ''}>
                    <div className="flex flex-col gap-3 mt-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-white/50">Pending investigation</span>
                            <span className={`font-mono font-bold ${data.health.pendingInvestigation > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{fmt(data.health.pendingInvestigation)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-white/50">Cards errors 24h</span>
                            <span className={`font-mono font-bold ${data.health.errorsToday > 5 ? 'text-orange-400' : 'text-white/60'}`}>{fmt(data.health.errorsToday)}</span>
                        </div>
                        {data.season2.topWallet && (
                            <div className="border-t border-white/10 pt-3 flex flex-col gap-1">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">S2 leader</span>
                                <span className="font-mono text-xs text-white">{shortWallet(data.season2.topWallet)} · {fmt(data.season2.topXp)} XP</span>
                            </div>
                        )}
                    </div>
                </Card>
            </div>
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
                        <Card><Stat label="Errors" value={fmt(data.errorsCount)} accent={data.errorsCount > 5 ? 'red' : 'white'} /></Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <Card title="Prize distribution">
                            <div className="flex flex-col gap-2 mt-2">
                                {data.prizeDistribution.length === 0 && <p className="text-xs text-white/30">No data</p>}
                                {data.prizeDistribution.slice(0, 12).map((row: any) => (
                                    <Bar key={row.prize} label={row.prize} value={row.count} max={data.prizeDistribution[0]?.count ?? 1} />
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
                                        <span className="text-white/30 font-mono text-[10px]">{new Date(w.won_at).toLocaleDateString()}</span>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </div>

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
                        <Card><Stat label="Bets" value={fmt(data.betsCount)} hint={`${fmt(data.uniquePlayers)} players`} accent="blue" /></Card>
                        <Card><Stat label="Volume" value={`${fmt(data.volume.totalBets, 2)} APE`} hint={`Payout ${fmt(data.volume.totalPayout, 2)}`} /></Card>
                        <Card>
                            <Stat
                                label="House edge realised"
                                value={`${fmt(data.volume.houseEdgeRealised, 2)} APE`}
                                hint={`${data.volume.edgePct.toFixed(2)}% of volume`}
                                accent={data.volume.houseEdgeRealised >= 0 ? 'green' : 'red'}
                            />
                        </Card>
                    </div>

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

                    {data.queue.pendingInvestigation.length > 0 && (
                        <Card title="🚨 Pending investigation — review needed" className="border-red-500/30">
                            <Table headers={['Wallet', 'Amount', 'TX', 'Created']} rows={data.queue.pendingInvestigation.map((r: any) => [
                                shortWallet(r.wallet_address),
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

                    <Card title="Top 50 leaderboard">
                        <Table headers={['#', 'Wallet', 'XP', 'Plays']} rows={data.top50.map((r: any, i: number) => [
                            <span key="r" className="font-mono text-white/40">{i + 1}</span>,
                            <span key="w" className="font-mono text-white">{shortWallet(r.wallet_address)}</span>,
                            <span key="x" className="font-mono text-[#3b82f6] font-bold">{fmt(r.season_xp)}</span>,
                            <span key="p" className="font-mono text-white/40">{fmt(r.games_played)}</span>,
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
                            {data.alerts.map((a: any, i: number) => <AlertCard key={i} alert={a} />)}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

function AlertCard({ alert }: { alert: { severity: string; kind: string; message: string; detail?: any } }) {
    const [open, setOpen] = useState(false)
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
    return (
        <div className={`border rounded-2xl p-4 ${c[alert.severity] ?? ''}`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                    <AlertTriangle size={16} className={txt[alert.severity] ?? ''} />
                    <span className={`text-[10px] uppercase font-black tracking-widest ${txt[alert.severity] ?? ''}`}>{alert.severity}</span>
                    <span className="text-[10px] font-mono text-white/30 truncate">{alert.kind}</span>
                </div>
                {alert.detail && <button onClick={() => setOpen(o => !o)} className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white">{open ? 'Hide' : 'Detail'}</button>}
            </div>
            <p className="text-sm text-white mt-1">{alert.message}</p>
            {open && alert.detail && (
                <pre className="mt-3 max-h-72 overflow-auto bg-black/40 border border-white/10 rounded-lg p-3 text-[10px] text-white/60 font-mono">{JSON.stringify(alert.detail, null, 2)}</pre>
            )}
        </div>
    )
}

// ── Window switcher ───────────────────────────────────────────────────────────

function WindowSwitcher({ value, onChange, onRefresh }: { value: Window; onChange: (v: Window) => void; onRefresh: () => void }) {
    return (
        <div className="flex items-center gap-2 justify-end">
            <div className="flex bg-white/5 rounded-xl border border-white/10 p-0.5">
                {(['24h', '7d', '30d'] as Window[]).map(w => (
                    <button key={w} onClick={() => onChange(w)} className={`px-3 h-7 text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors ${value === w ? 'bg-[#3b82f6] text-white' : 'text-white/40 hover:text-white'}`}>{w}</button>
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
            case 'prizes':   return <PrizesTab />
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
