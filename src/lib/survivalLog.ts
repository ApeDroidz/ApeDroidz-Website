import { supabaseAdmin } from '@/lib/supabase'

/**
 * The journal (survival_events). One call, never throws, never awaited on the hot path —
 * a log line must not be able to fail a request. Read it in the panel (spltpnl → Droidz
 * Survival) or from the terminal: `node --env-file=.env.local scripts/survival-log.mjs`.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEvent {
    level: LogLevel
    kind: string
    message?: string
    wallet?: string | null
    data?: Record<string, unknown>
    runId?: string | null
    clientVersion?: string | null
    source?: 'client' | 'server'
    ipHash?: string | null
}

export function logEvent(ev: LogEvent): void {
    if (!supabaseAdmin) return
    void supabaseAdmin.from('survival_events').insert({
        wallet: ev.wallet ?? null,
        source: ev.source ?? 'server',
        level: ev.level,
        kind: ev.kind.slice(0, 64),
        message: (ev.message ?? '').slice(0, 500),
        data: ev.data ?? {},
        run_id: ev.runId ?? null,
        client_version: ev.clientVersion?.slice(0, 64) ?? null,
        ip_hash: ev.ipHash ?? null,
    }).then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn('[survival/log]', error.message)
    })
}
