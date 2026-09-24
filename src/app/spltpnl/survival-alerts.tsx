'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clock, Siren } from 'lucide-react'

/**
 * «Needs a fix» — the call to action the Survival tab was missing (owner, 24.09.2026: «нет чёткого
 * CTA, когда надо что-то поправить»). Always on top of the tab, on every view. Each line is one
 * concrete problem with what to do about it (api/admin/survival/alerts); «Done» hides it until it
 * happens again, «Snooze» hides it for a day.
 */
type Alert = {
    fingerprint: string; severity: 'critical' | 'high' | 'medium'; area: string
    title: string; detail: string; action: string; count: number; wallets: number; lastSeen: string | null; sample?: unknown
}

const SEV: Record<Alert['severity'], { box: string; badge: string; label: string }> = {
    critical: { box: 'border-red-500/40 bg-red-500/10', badge: 'bg-red-500 text-white', label: 'Critical' },
    high: { box: 'border-orange-500/40 bg-orange-500/10', badge: 'bg-orange-500 text-black', label: 'Fix soon' },
    medium: { box: 'border-yellow-500/25 bg-yellow-500/5', badge: 'bg-yellow-500/80 text-black', label: 'Look at' },
}

/** The number of alerts that need attention, for the tab's badge. */
export function useSurvivalAlertCount(): number {
    const [n, setN] = useState(0)
    useEffect(() => {
        let alive = true
        const tick = () => fetch('/api/admin/survival/alerts', { credentials: 'include', cache: 'no-store' })
            .then((r) => r.json()).then((d) => { if (alive) setN((d.alerts ?? []).filter((a: Alert) => a.severity !== 'medium').length) }).catch(() => {})
        tick()
        const id = setInterval(tick, 5 * 60_000)
        return () => { alive = false; clearInterval(id) }
    }, [])
    return n
}

export function SurvivalAlerts() {
    const [alerts, setAlerts] = useState<Alert[] | null>(null)
    const [open, setOpen] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const load = useCallback(async () => {
        try {
            const r = await fetch('/api/admin/survival/alerts', { credentials: 'include', cache: 'no-store' })
            const d = await r.json()
            if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
            setAlerts(d.alerts ?? [])
        } catch (e) { setError((e as Error).message) }
    }, [])
    useEffect(() => { void load() }, [load])
    const act = async (fingerprint: string, action: 'done' | 'snooze') => {
        await fetch('/api/admin/survival/alerts', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fingerprint, action }) })
        setAlerts((a) => (a ?? []).filter((x) => x.fingerprint !== fingerprint))
    }

    if (error) return <div className="text-orange-400 text-xs font-mono">Alerts unavailable: {error}</div>
    if (!alerts) return null
    if (alerts.length === 0) return (
        <div className="flex items-center gap-2 text-xs text-emerald-300/80 bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-3 py-2">
            <Check className="h-4 w-4" /> Nothing needs fixing right now.
        </div>
    )
    const urgent = alerts.filter((a) => a.severity !== 'medium').length
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
                <Siren className={`h-4 w-4 ${urgent ? 'text-red-400' : 'text-yellow-400'}`} />
                <span className={urgent ? 'text-red-300' : 'text-yellow-300'}>{alerts.length} thing{alerts.length === 1 ? '' : 's'} to fix{urgent ? ` · ${urgent} urgent` : ''}</span>
            </div>
            {alerts.map((a) => (
                <div key={a.fingerprint} className={`rounded-xl border px-3 py-2 ${SEV[a.severity].box}`}>
                    <div className="flex items-start gap-2">
                        <button onClick={() => setOpen(open === a.fingerprint ? null : a.fingerprint)} className="mt-0.5 text-white/50 hover:text-white">
                            {open === a.fingerprint ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${SEV[a.severity].badge}`}>{SEV[a.severity].label}</span>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-black">{a.title}</div>
                            <div className="text-xs text-white/80 mt-0.5"><span className="text-white/40">Do: </span>{a.action}</div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => void act(a.fingerprint, 'done')} title="Fixed — hide until it happens again" className="flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-emerald-500/30 text-[10px] font-black uppercase tracking-widest"><Check className="h-3 w-3" /> Done</button>
                            <button onClick={() => void act(a.fingerprint, 'snooze')} title="Hide for 24 hours" className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/15 text-[10px] font-black uppercase tracking-widest text-white/50"><Clock className="h-3 w-3" /> 24h</button>
                        </div>
                    </div>
                    {open === a.fingerprint && (
                        <div className="mt-2 ml-6 space-y-1 text-xs text-white/60">
                            <div className="flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />{a.detail}</div>
                            <div className="font-mono text-[10px] text-white/35">{a.area} · {a.count}× · {a.wallets} player{a.wallets === 1 ? '' : 's'} · last {a.lastSeen ? new Date(a.lastSeen).toLocaleString() : '—'}</div>
                            {a.sample != null && <pre className="text-[10px] font-mono text-white/40 bg-black/40 rounded p-2 overflow-auto max-h-40">{JSON.stringify(a.sample, null, 2)}</pre>}
                        </div>
                    )}
                </div>
            ))}
        </div>
    )
}
