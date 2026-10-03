import { supabaseAdmin } from '@/lib/supabase'

/**
 * The Droidz Survival funnel, server side (owner, 03.10.2026: «простая воронка: лендинг → PLAY →
 * кошелёк → подпись → первый забег → покупка»). The page's half (lib/survivalFunnel.ts) posts the
 * first four steps to /api/survival/funnel with an anonymous browser id; the last two are written
 * here by the server itself — first_run from run/finish, first_purchase from the payment booking —
 * because only the server knows a run or a payment really happened.
 *
 * Every step is a survival_events line `funnel.<step>`, written at most ONCE: per (step, anon id)
 * for the page's steps, per (step, wallet) for the server's. The check below keeps it so before
 * the migration's unique indexes exist (20261003_survival_profile.sql); with them, a racing
 * duplicate fails with 23505 and is dropped. Never throws.
 */

export const CLIENT_STEPS = ['landing_view', 'play_click', 'wallet_connected', 'signed_in'] as const
export const SERVER_STEPS = ['first_run', 'first_purchase'] as const
export const FUNNEL_STEPS = [...CLIENT_STEPS, ...SERVER_STEPS] as const
export type ClientStep = typeof CLIENT_STEPS[number]
export type ServerStep = typeof SERVER_STEPS[number]
export type FunnelStep = typeof FUNNEL_STEPS[number]

export const ANON_ID = /^[a-z0-9-]{8,64}$/i

/**
 * Only the deployed site writes the funnel. The local dev server (localhost:3737) runs against the
 * production database, and a QA bot opening the landing page there must not count as a visitor
 * (four such lines landed on 03.10 before this guard). SURVIVAL_FUNNEL_DEV=1 turns it on locally.
 */
export const funnelEnabled = (): boolean => process.env.NODE_ENV === 'production' || process.env.SURVIVAL_FUNNEL_DEV === '1'

type Db = { error: { message: string; code?: string } | null }

/** One funnel line for a page step; 'dup' when this visitor already has it. */
export async function recordClientStep(step: ClientStep, anon: string, wallet: string | null, ipHash: string | null): Promise<'ok' | 'dup' | 'error' | 'off'> {
    if (!funnelEnabled()) return 'off'
    if (!supabaseAdmin) return 'error'
    const kind = `funnel.${step}`
    const { data: seen, error: sErr } = await supabaseAdmin.from('survival_events').select('id')
        .eq('kind', kind).eq('data->>anon', anon).limit(1)
    if (sErr) return 'error'
    if ((seen as unknown[] | null)?.length) return 'dup'
    const r: Db = await supabaseAdmin.from('survival_events').insert({
        source: 'client', level: 'info', kind, wallet, message: '', data: { anon }, ip_hash: ipHash,
    })
    if (r.error) return r.error.code === '23505' ? 'dup' : 'error'
    return 'ok'
}

/**
 * The wallet's first run / first purchase. `isFirst` answers whether what just happened is the
 * wallet's first (the caller's own count); the line is written only then, and only once.
 * The promise never rejects. Callers start it early and await it before replying (a Vercel function
 * may be frozen once its response is sent, and a pending write with it) — by then it is done.
 */
export function recordServerStep(step: ServerStep, wallet: string, isFirst: () => Promise<boolean>, data: Record<string, unknown> = {}): Promise<void> {
    if (!supabaseAdmin || !funnelEnabled()) return Promise.resolve()
    return (async () => {
        try {
            if (!(await isFirst())) return
            const kind = `funnel.${step}`
            const { data: seen, error } = await supabaseAdmin.from('survival_events').select('id').eq('kind', kind).eq('wallet', wallet).limit(1)
            if (error || (seen as unknown[] | null)?.length) return
            const r: Db = await supabaseAdmin.from('survival_events').insert({ source: 'server', level: 'info', kind, wallet, message: '', data })
            if (r.error && r.error.code !== '23505') console.warn('[survival/funnel]', step, r.error.message)
        } catch (e) {
            console.warn('[survival/funnel]', step, (e as Error).message)
        }
    })()
}

/** first_run: the run just closed is the only closed run this wallet has. */
export function markFirstRun(wallet: string, runId: string): Promise<void> {
    return recordServerStep('first_run', wallet, async () => {
        const { count, error } = await supabaseAdmin.from('survival_runs').select('id', { count: 'exact', head: true })
            .eq('wallet', wallet).not('finished_at', 'is', null)
        return !error && (count ?? 0) <= 1
    }, { runId })
}

/** first_purchase: the payment just booked is the only one this wallet has. */
export function markFirstPurchase(wallet: string, sku: string): Promise<void> {
    return recordServerStep('first_purchase', wallet, async () => {
        const { count, error } = await supabaseAdmin.from('survival_payments').select('id', { count: 'exact', head: true }).eq('wallet', wallet)
        return !error && (count ?? 0) <= 1
    }, { sku })
}
