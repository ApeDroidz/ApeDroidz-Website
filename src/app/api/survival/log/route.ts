import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { readSessionFromRequest } from '@/lib/walletAuth'
import { logEvent, type LogLevel } from '@/lib/survivalLog'
import { readBody } from '@/lib/survivalRuns'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/survival/log { level, kind, message, data?, runId?, clientVersion? }
 *
 * The game's line into the journal: uncaught errors, run verdicts, anything the client
 * thinks is worth a look. A signed session attributes the line to a wallet; without one it
 * is still taken (an error on the landing page is an error), keyed by a hashed IP. Bounded:
 * short strings, small data, and the middleware rate-limits the path.
 */
export const dynamic = 'force-dynamic'

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

/**
 * What the game itself writes (grep Telemetry.log / log( in the game's src). Anything else is kept
 * as `client.other` at info, its kind in data — a client line must never look like one of the
 * server's own (pay.*, server.*, profile.*): the panel's alerts and payment lists are built on those.
 */
const CLIENT_KINDS = new Set([
    'client.error', 'client.rejection', 'spawn_ceiling_stall', 'stray_stuck', 'stray_recycled', 'stray_removed',
    'run.verdict', 'run.strays', 'run.outbox_sent', 'boot.slow', 'boot.files_stalled',
    'save.fresh_wallet', 'save.local_ahead', 'save.stale', 'daily.claimed', 'feedback.rated', 'feedback.sent',
    'purchase.applied', 'ticket.opened', 'ticket.opened_batch', 'trial.start', 'trial.end', 'sandbox.start',
    'webgl.context_lost', 'perf.quality_auto',
])
/** Without a signed session only the lines an unsigned page can have: a crash, a slow boot. */
const ANON_KINDS = new Set(['client.error', 'client.rejection', 'boot.slow', 'boot.files_stalled', 'webgl.context_lost'])
/** Bytes, not characters: a line of 4 000 CJK characters is 12 KB. */
const DATA_MAX = 2048
const ANON_DATA_MAX = 512
/** Rows per hour, counted in the table (the middleware's per-IP limit lives in one instance's memory). */
const PER_WALLET_HOUR = 120
const ANON_HOUR = 200

export async function POST(req: NextRequest) {
    const body = await readBody(req)
    const session = readSessionFromRequest(req)
    const asked = typeof body.kind === 'string' && /^[a-z0-9_.]{1,48}$/.test(body.kind) ? body.kind : 'client'
    // The QA scripts write qa.* lines; they are nobody's alert.
    const known = CLIENT_KINDS.has(asked) || asked.startsWith('qa.')
    if (!session && !ANON_KINDS.has(asked) && !asked.startsWith('qa.')) return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
    const kind = known ? asked : 'client.other'
    const level = known && LEVELS.includes(body.level as LogLevel) ? (body.level as LogLevel) : 'info'
    const message = typeof body.message === 'string' ? body.message.slice(0, session ? 300 : 200) : ''
    let data: Record<string, unknown> = known ? {} : { kind: asked }
    if (body.data && typeof body.data === 'object') {
        const raw = JSON.stringify(body.data)
        const bytes = Buffer.byteLength(raw)
        data = { ...(bytes <= (session ? DATA_MAX : ANON_DATA_MAX) ? (body.data as Record<string, unknown>) : { truncated: true, bytes }), ...data }
    }
    // A ceiling in the table itself, across every instance: the journal is not a free disk.
    if (supabaseAdmin) {
        const since = new Date(Date.now() - 3_600_000).toISOString()
        const q = supabaseAdmin.from('survival_events').select('id', { count: 'exact', head: true }).eq('source', 'client').gte('at', since)
        const { count } = await (session ? q.eq('wallet', session.wallet) : q.is('wallet', null))
        if ((count ?? 0) >= (session ? PER_WALLET_HOUR : ANON_HOUR)) return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
    }
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
    logEvent({
        source: 'client', level, kind, message, data,
        wallet: session?.wallet ?? null,
        runId: typeof body.runId === 'string' && /^[0-9a-f-]{36}$/i.test(body.runId) ? body.runId : null,
        clientVersion: typeof body.clientVersion === 'string' ? body.clientVersion : null,
        ipHash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 16) : null,
    })
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
}
