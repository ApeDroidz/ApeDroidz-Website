import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer } from '@/lib/survivalRuns'
import { readSides } from '@/lib/survivalLinkRedeem'
import { MAX_ACCOUNT_WALLETS } from '@/lib/survivalAccount'
import { logEvent } from '@/lib/survivalLog'

/**
 * POST /api/survival/link/redeem { code, keep: 'theirs' | 'mine' } — the two accounts become one
 * (supabase/migrations/20261017_survival_wallet_links.sql, survival_link_redeem — all or nothing).
 * `keep` names whose progress stays: that account's main wallet is the main one from now on; the
 * other save is not deleted, only no longer read. Purchases (the pass) move to the account.
 *
 *   → { ok, account }
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { 'cache-control': 'no-store' }

export async function POST(req: NextRequest) {
    const caller = await authCaller(req, { recheck: true })
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await req.json().catch(() => ({})) as { code?: unknown; keep?: unknown }
    if (body.keep !== 'theirs' && body.keep !== 'mine') return NextResponse.json({ ok: false, state: 'bad_keep' }, { status: 400, headers: NO_STORE })
    const sides = await readSides(caller, body.code)
    if (sides instanceof NextResponse) return sides
    const keep = body.keep === 'theirs' ? sides.theirs.account : sides.mine.account
    const { data, error } = await supabaseAdmin.rpc('survival_link_redeem', {
        p_code: sides.code, p_redeemer: caller.session, p_keep: keep, p_max: MAX_ACCOUNT_WALLETS,
    })
    if (error) return noServer('link.redeem', error)
    if (data !== 'ok') return NextResponse.json({ ok: false, state: String(data) }, { headers: NO_STORE })
    logEvent({
        level: 'info', kind: 'account.link', wallet: keep,
        data: { theirs: sides.theirs.wallets, mine: sides.mine.wallets, kept: body.keep, by: caller.session },
    })
    return NextResponse.json({ ok: true, account: keep }, { headers: NO_STORE })
}
