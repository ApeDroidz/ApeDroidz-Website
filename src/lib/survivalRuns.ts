import { NextRequest, NextResponse } from 'next/server'
import { readSessionFromRequest } from '@/lib/walletAuth'
import { supabaseAdmin } from '@/lib/supabase'
import { PLAY_COOKIE_NAME, readPlayToken } from '@/lib/survivalAccess'

/**
 * Shared plumbing for /api/survival/run/* — who is asking, and the run row they are asking about.
 *
 * Two proofs are required on every call, the same two the game itself needed to load:
 *   1. the signed wallet session (`glitch_session`) — this is whose run it is;
 *   2. the beta play cookie (`survival_play`) — minted only for an allowlisted wallet, and it must
 *      be for the SAME wallet as the session.
 * Both are httpOnly cookies on apedroidz.com; the game runs on the same origin, so they travel
 * with its fetches on their own. The standalone build (localhost:5173) has neither, gets 401,
 * and RunLedger.ts treats that as "no server" — the run plays, nothing is recorded.
 *
 * Every reply is HTTP 200 with `{ ok, state }` unless the caller is not authenticated, so the
 * game can render a state rather than parse an error.
 */

export interface Caller { wallet: string }

export async function authCaller(req: NextRequest): Promise<Caller | NextResponse> {
    const session = readSessionFromRequest(req)
    if (!session) return NextResponse.json({ ok: false, state: 'unauthenticated' }, { status: 401 })
    const play = await readPlayToken(req.cookies.get(PLAY_COOKIE_NAME)?.value)
    if (!play || play !== session.wallet) return NextResponse.json({ ok: false, state: 'no_access' }, { status: 401 })
    return { wallet: session.wallet }
}

export function noServer(): NextResponse {
    return NextResponse.json({ ok: false, state: 'no_server' }, { status: 503 })
}

export interface RunRow {
    id: string
    wallet: string
    season_id: string
    status: 'started' | 'finished' | 'rejected' | 'void'
    started_at: string
    last_pulse_wave: number | null
    last_pulse_kills: number | null
    last_pulse_score: number | null
    pulse_count: number
}

/** The caller's own run, or a reply explaining why there is none. */
export async function loadRun(runId: unknown, wallet: string): Promise<RunRow | NextResponse> {
    if (typeof runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(runId)) {
        return NextResponse.json({ ok: false, state: 'no_run' })
    }
    const { data, error } = await supabaseAdmin
        .from('survival_runs')
        .select('id, wallet, season_id, status, started_at, last_pulse_wave, last_pulse_kills, last_pulse_score, pulse_count')
        .eq('id', runId)
        .maybeSingle()
    if (error) { console.error('[survival/run] load', error.message); return noServer() }
    if (!data || data.wallet !== wallet) return NextResponse.json({ ok: false, state: 'no_run' })
    return data as RunRow
}

/** Integers from an untrusted JSON body, or null if any is not one. */
export function ints(body: Record<string, unknown>, keys: string[]): Record<string, number> | null {
    const out: Record<string, number> = {}
    for (const k of keys) {
        const v = body[k]
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1e9) return null
        out[k] = v
    }
    return out
}

export async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
    try {
        const b: unknown = await req.json()
        return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
    } catch {
        return {}
    }
}
