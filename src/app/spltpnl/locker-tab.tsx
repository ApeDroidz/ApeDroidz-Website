'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Download, ExternalLink, Loader2, RefreshCcw, ShieldCheck } from 'lucide-react'

type WalletRow = {
    wallet: string
    droidsLocked: number
    lvl1: number
    lvl2: number
    lvl2super: number
    points: number
    freemints: number
    freemintsRecomputed: number
    firstLockAt: string
    lastLockAt: string
}

type BatchRow = {
    txHash: string
    wallet: string
    tokenIds: number[]
    droidCount: number
    points: number
    freemintsBefore: number
    freemintsAfter: number
    blockNumber: number
    createdAt: string
}

type Reconcile = {
    clean: boolean
    checkedAt: string
    counts: { onChain: number; inDatabase: number }
    chainVsDb: {
        missingInDb: number[]
        notOnChain: number[]
        ownerMismatch: Array<{ tokenId: number; db: string; chain: string }>
    }
    auditChain: { ok: boolean; checked: number; firstBadId: number | null }
    levelCeiling: { ok: boolean; upgradedDroids: number; burnedBatteriesOnChain: number; headroom: number } | null
    error?: string
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '—')

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
    return (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-[9px] font-black uppercase tracking-widest text-white/35">{label}</div>
            <div className={`mt-1 text-xl font-black ${accent || 'text-white'}`}>{value}</div>
        </div>
    )
}

/**
 * Locker reporting.
 *
 * Every figure here is derived from `locker_locks`, which is only ever written after the server
 * has read the lock back off the chain. Nothing on this screen can be edited into existence — and
 * the Verify button re-checks the whole set against the registry contract plus the audit hash
 * chain, so a tampered row shows up rather than quietly changing a payout.
 */
export function LockerTab() {
    const [data, setData] = useState<{ summary: any; wallets: WalletRow[]; batches: BatchRow[] } | null>(null)
    const [loading, setLoading] = useState(true)
    const [reconcile, setReconcile] = useState<Reconcile | null>(null)
    const [verifying, setVerifying] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/admin/locker', { credentials: 'include', cache: 'no-store' })
            const json = await res.json()
            if (res.ok) setData(json)
        } catch (e) {
            console.error('[spltpnl/locker] load failed:', e)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const verify = async () => {
        setVerifying(true)
        setReconcile(null)
        try {
            const res = await fetch('/api/admin/locker/reconcile', { credentials: 'include', cache: 'no-store' })
            setReconcile(await res.json())
        } catch (e: any) {
            setReconcile({ error: e?.message || 'Verification failed' } as Reconcile)
        } finally {
            setVerifying(false)
        }
    }

    const summary = data?.summary
    const mismatchedWallets = (data?.wallets || []).filter((w) => w.freemints !== w.freemintsRecomputed)

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-sm font-black uppercase tracking-widest">Locker</h2>
                <button onClick={load} disabled={loading} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer">
                    <RefreshCcw size={13} className={loading ? 'animate-spin text-white icon-dim-30' : 'text-white icon-dim-50'} />
                </button>

                <div className="ml-auto flex items-center gap-2">
                    <a
                        href="/api/admin/locker?format=csv"
                        className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/15 text-[10px] font-black uppercase tracking-widest text-white/70 hover:bg-white/10 transition-colors"
                    >
                        <Download size={12} /> CSV
                    </a>
                    <button
                        onClick={verify}
                        disabled={verifying}
                        className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white text-black text-[10px] font-black uppercase tracking-widest hover:bg-[#3b82f6] hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
                    >
                        {verifying ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Verify against chain
                    </button>
                </div>
            </div>

            {/* ── Summary ────────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <Stat label="Wallets" value={summary?.wallets ?? '—'} />
                <Stat label="Droids locked" value={summary?.droidsLocked ?? '—'} />
                <Stat label="Level 1" value={summary?.lvl1 ?? '—'} />
                <Stat label="Level 2" value={summary?.lvl2 ?? '—'} />
                <Stat label="Level 2 Super" value={summary?.lvl2super ?? '—'} accent="text-orange-400" />
                <Stat label="Freemints owed" value={summary?.freemintsOwed ?? '—'} accent="text-yellow-300" />
            </div>

            {/* ── Verification result ────────────────────────────────────────────── */}
            {reconcile && (
                <div className={`rounded-xl border px-4 py-3 ${reconcile.clean ? 'border-green-400/25 bg-green-400/5' : 'border-red-500/30 bg-red-500/5'}`}>
                    {reconcile.error ? (
                        <div className="flex items-center gap-2 text-red-300 text-[11px] font-mono">
                            <AlertTriangle size={13} /> {reconcile.error}
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center gap-2">
                                {reconcile.clean
                                    ? <Check size={14} className="text-green-400" />
                                    : <AlertTriangle size={14} className="text-red-400" />}
                                <span className={`text-[11px] font-black uppercase tracking-widest ${reconcile.clean ? 'text-green-300' : 'text-red-300'}`}>
                                    {reconcile.clean ? 'Database matches the chain' : 'Discrepancy found'}
                                </span>
                                <span className="ml-auto text-[10px] font-mono text-white/30">
                                    {reconcile.counts.onChain} on-chain · {reconcile.counts.inDatabase} in database · audit chain{' '}
                                    {reconcile.auditChain.ok ? `intact (${reconcile.auditChain.checked})` : `BROKEN at #${reconcile.auditChain.firstBadId}`}
                                </span>
                            </div>
                            {reconcile.levelCeiling && (
                                <div className={`mt-2 text-[10px] font-mono ${reconcile.levelCeiling.ok ? 'text-white/35' : 'text-red-300'}`}>
                                    Level ceiling: {reconcile.levelCeiling.upgradedDroids} upgraded droids vs{' '}
                                    {reconcile.levelCeiling.burnedBatteriesOnChain} batteries burned on-chain
                                    {reconcile.levelCeiling.ok
                                        ? ` — within bounds (${reconcile.levelCeiling.headroom} spare)`
                                        : ' — MORE UPGRADED DROIDS THAN BURNED BATTERIES, levels may have been inflated'}
                                </div>
                            )}
                            <div className="hidden">
                            </div>
                            {!reconcile.clean && (
                                <div className="mt-2 space-y-1 text-[10px] font-mono text-red-300/80">
                                    {reconcile.chainVsDb.missingInDb.length > 0 && (
                                        <div>Locked on-chain but missing here (re-run commit): #{reconcile.chainVsDb.missingInDb.join(', #')}</div>
                                    )}
                                    {reconcile.chainVsDb.notOnChain.length > 0 && (
                                        <div>In the database but NOT locked on-chain — these rows should not exist: #{reconcile.chainVsDb.notOnChain.join(', #')}</div>
                                    )}
                                    {reconcile.chainVsDb.ownerMismatch.map((m) => (
                                        <div key={m.tokenId}>#{m.tokenId}: database says {short(m.db)}, chain says {short(m.chain)}</div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {mismatchedWallets.length > 0 && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-[11px] font-mono text-red-300">
                    <AlertTriangle size={13} className="inline mr-1.5 -mt-0.5" />
                    {mismatchedWallets.length} wallet(s) where the stored total disagrees with a fresh recomputation. Investigate before paying out.
                </div>
            )}

            {/* ── Wallets ────────────────────────────────────────────────────────── */}
            <div>
                <h3 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2">Freemint entitlement by wallet</h3>
                <div className="rounded-xl border border-white/10 overflow-x-auto">
                    <table className="w-full text-[11px]">
                        <thead className="bg-white/5 text-white/40">
                            <tr className="text-left">
                                <th className="px-3 py-2 font-black uppercase tracking-widest text-[9px]">Wallet</th>
                                <th className="px-3 py-2 font-black uppercase tracking-widest text-[9px]">Locked</th>
                                <th className="px-3 py-2 font-black uppercase tracking-widest text-[9px]">L1 / L2 / Super</th>
                                <th className="px-3 py-2 font-black uppercase tracking-widest text-[9px]">Points</th>
                                <th className="px-3 py-2 font-black uppercase tracking-widest text-[9px]">Freemints</th>
                                <th className="px-3 py-2 font-black uppercase tracking-widest text-[9px]">Last lock</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono">
                            {(data?.wallets || []).map((w) => (
                                <tr key={w.wallet} className="border-t border-white/5">
                                    <td className="px-3 py-2">
                                        <a href={`https://apescan.io/address/${w.wallet}`} target="_blank" rel="noreferrer" className="text-white/80 hover:text-white inline-flex items-center gap-1">
                                            {short(w.wallet)} <ExternalLink size={9} className="opacity-40" />
                                        </a>
                                    </td>
                                    <td className="px-3 py-2 text-white/70">{w.droidsLocked}</td>
                                    <td className="px-3 py-2 text-white/50">{w.lvl1} / {w.lvl2} / <span className="text-orange-400">{w.lvl2super}</span></td>
                                    <td className="px-3 py-2 text-white/70">{w.points.toFixed(2)}</td>
                                    <td className={`px-3 py-2 font-black ${w.freemints !== w.freemintsRecomputed ? 'text-red-400' : 'text-yellow-300'}`}>
                                        {w.freemints}
                                    </td>
                                    <td className="px-3 py-2 text-white/40">{when(w.lastLockAt)}</td>
                                </tr>
                            ))}
                            {!loading && (data?.wallets || []).length === 0 && (
                                <tr><td colSpan={6} className="px-3 py-6 text-center text-white/30">No locks yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Transactions ───────────────────────────────────────────────────── */}
            <div>
                <h3 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2">Lock transactions</h3>
                <div className="rounded-xl border border-white/10 overflow-x-auto">
                    <table className="w-full text-[11px]">
                        <thead className="bg-white/5 text-white/40">
                            <tr className="text-left">
                                <th className="px-3 py-2 font-black uppercase tracking-widest text-[9px]">When</th>
                                <th className="px-3 py-2 font-black uppercase tracking-widest text-[9px]">Wallet</th>
                                <th className="px-3 py-2 font-black uppercase tracking-widest text-[9px]">Droids</th>
                                <th className="px-3 py-2 font-black uppercase tracking-widest text-[9px]">Freemints</th>
                                <th className="px-3 py-2 font-black uppercase tracking-widest text-[9px]">Tx</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono">
                            {(data?.batches || []).map((b) => (
                                <tr key={b.txHash} className="border-t border-white/5">
                                    <td className="px-3 py-2 text-white/40">{when(b.createdAt)}</td>
                                    <td className="px-3 py-2 text-white/70">{short(b.wallet)}</td>
                                    <td className="px-3 py-2 text-white/50" title={b.tokenIds.join(', ')}>
                                        {b.droidCount} <span className="text-white/25">#{b.tokenIds.slice(0, 4).join(', #')}{b.tokenIds.length > 4 ? '…' : ''}</span>
                                    </td>
                                    <td className="px-3 py-2 text-yellow-300">{b.freemintsBefore} → {b.freemintsAfter}</td>
                                    <td className="px-3 py-2">
                                        <a href={`https://apescan.io/tx/${b.txHash}`} target="_blank" rel="noreferrer" className="text-white/60 hover:text-white inline-flex items-center gap-1">
                                            {b.txHash.slice(0, 10)}… <ExternalLink size={9} className="opacity-40" />
                                        </a>
                                    </td>
                                </tr>
                            ))}
                            {!loading && (data?.batches || []).length === 0 && (
                                <tr><td colSpan={5} className="px-3 py-6 text-center text-white/30">No lock transactions yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="text-[10px] font-mono text-white/25 leading-relaxed max-w-3xl space-y-2">
                <p>
                    Which droids are locked, and by whom, mirrors the DroidLockRegistry contract — this table is never
                    the source of truth for that. Rows are append-only at the database level and every write is recorded
                    in a hash-chained audit log ({summary?.auditEvents ?? 0} entries), so an edit made outside the app
                    shows up in Verify rather than silently changing what someone is owed.
                </p>
                <p className="text-amber-400/40">
                    One caveat worth remembering: a droid&apos;s <strong>level is not chain state</strong>. It lives in
                    the <code>droidz</code> table, and nothing on-chain records which droid a burned battery upgraded. So
                    Verify proves the locks, not the multipliers. Multipliers are frozen at lock time, which stops a
                    later level change from rewriting past credit — but they rest on our own records.
                </p>
            </div>
        </div>
    )
}
