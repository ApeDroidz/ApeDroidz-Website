import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { readSessionFromRequest } from '@/lib/walletAuth'
import { logEvent, type LogLevel } from '@/lib/survivalLog'
import { readBody } from '@/lib/survivalRuns'

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

export async function POST(req: NextRequest) {
    const body = await readBody(req)
    const level = LEVELS.includes(body.level as LogLevel) ? (body.level as LogLevel) : 'info'
    const kind = typeof body.kind === 'string' && body.kind ? body.kind : 'client'
    const message = typeof body.message === 'string' ? body.message : ''
    let data: Record<string, unknown> = {}
    if (body.data && typeof body.data === 'object') {
        const raw = JSON.stringify(body.data)
        data = raw.length <= 4096 ? (body.data as Record<string, unknown>) : { truncated: raw.slice(0, 4000) }
    }
    const session = readSessionFromRequest(req)
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
