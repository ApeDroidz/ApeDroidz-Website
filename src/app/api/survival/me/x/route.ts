import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { NO_STORE, X_HANDLE_RE, xHandleOf } from '@/lib/survivalMe'

/**
 * POST /api/survival/me/x { x } — the player's X handle, typed by hand (owner, 03.10.2026: «X —
 * вписать руками, как на сайте»). The site's own rule and store (/api/user/update-x): the handle goes
 * to glitch_users.x_handle as '@name' through set_glitch_user_x_handle, which writes it ONLY while
 * the wallet has none — so it cannot be overwritten later by anyone, the player included.
 *
 *   → { ok: true, x }                                   — stored (or the same handle was already there)
 *   → 400 { error: 'invalid' }                          — not 1–15 of [A-Za-z0-9_] (an @ in front is fine)
 *   → 409 { error: 'already_set', x }                   — the wallet has another handle already
 *   → 503 { ok: false, state: 'no_server' }
 *
 * Unlike update-x there is no blind-upsert fallback when the RPC fails: that fallback would
 * overwrite a handle already set; here a failure is a 503.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const wallet = caller.wallet
    const body = await readBody(req)
    const raw = typeof body.x === 'string' ? body.x.trim() : ''
    if (!X_HANDLE_RE.test(raw)) return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE })
    const handle = '@' + raw.replace(/^@/, '')

    const before = await xHandleOf(wallet)
    if (before) {
        return before.toLowerCase() === handle.toLowerCase()
            ? NextResponse.json({ ok: true, x: before }, { headers: NO_STORE })
            : NextResponse.json({ error: 'already_set', x: before }, { status: 409, headers: NO_STORE })
    }
    const { error } = await supabaseAdmin.rpc('set_glitch_user_x_handle', { p_wallet: wallet, p_handle: handle })
    if (error) return noServer('me.x', error.message)
    const after = await xHandleOf(wallet)
    if (after && after.toLowerCase() !== handle.toLowerCase()) {
        return NextResponse.json({ error: 'already_set', x: after }, { status: 409, headers: NO_STORE })
    }
    return NextResponse.json({ ok: true, x: after ?? handle }, { headers: NO_STORE })
}
