'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCcw } from 'lucide-react'

/**
 * Droidz Survival → Funnel (owner, 03.10.2026: «простая воронка без усложнений»): landing → PLAY →
 * wallet → signature → first run → first purchase. Six numbers for 24 h and 7 days, and each step's
 * share of the one before it. Visitors are counted by the browser's anonymous id (the first four
 * steps), players by wallet (the last two) — see /api/admin/survival/funnel.
 */

type Step = { step: string; d1: number; d7: number }

const LABELS: Record<string, string> = {
    landing_view: 'Landing view',
    play_click: 'PLAY click',
    wallet_connected: 'Wallet connected',
    signed_in: 'Signed in',
    first_run: 'First run',
    first_purchase: 'First purchase',
}

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 1000) / 10}%` : '—')

export function SurvivalFunnel() {
    const [steps, setSteps] = useState<Step[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [truncated, setTruncated] = useState(false)

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const res = await fetch('/api/admin/survival/funnel', { credentials: 'include', cache: 'no-store' })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
            setSteps(data.steps ?? []); setTruncated(!!data.truncated)
        } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
    }, [])
    useEffect(() => { void load() }, [load])

    return (
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3 mb-3">
                <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40">Funnel</h3>
                <span className="flex items-center gap-3 text-[10px] text-white/30 font-mono">
                    first time each visitor / wallet reached the step · % of the step before{truncated ? ' · 7d capped' : ''}
                    <button onClick={() => void load()} title="Refresh" className="text-white/40 hover:text-white"><RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
                </span>
            </div>
            {error && <div className="text-red-400 text-xs font-mono">{error}</div>}
            {!steps ? <div className="flex items-center gap-2 text-white/40 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div> : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[520px]">
                        <thead><tr className="text-white/30 text-[9px] uppercase tracking-widest">
                            <th className="text-left py-1">Step</th><th className="text-right">24 h</th><th className="text-right">→</th><th className="text-right">7 days</th><th className="text-right">→</th><th className="text-right">of landing (7d)</th>
                        </tr></thead>
                        <tbody>{steps.map((s, i) => {
                            const prev = i > 0 ? steps[i - 1] : null
                            return (
                                <tr key={s.step} className="border-t border-white/5">
                                    <td className="py-1.5 font-black uppercase tracking-wide text-[10px]">{i + 1}. {LABELS[s.step] ?? s.step}{i >= 4 ? <span className="text-white/30 font-normal normal-case tracking-normal"> · wallets</span> : null}</td>
                                    <td className="text-right font-black text-base">{s.d1.toLocaleString()}</td>
                                    <td className="text-right text-white/45 font-mono">{prev ? pct(s.d1, prev.d1) : ''}</td>
                                    <td className="text-right font-black text-base text-[#3b82f6]">{s.d7.toLocaleString()}</td>
                                    <td className="text-right text-white/45 font-mono">{prev ? pct(s.d7, prev.d7) : ''}</td>
                                    <td className="text-right text-white/30 font-mono">{i > 0 ? pct(s.d7, steps[0].d7) : ''}</td>
                                </tr>
                            )
                        })}</tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
