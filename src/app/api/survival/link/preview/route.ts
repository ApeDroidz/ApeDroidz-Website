import { NextRequest, NextResponse } from 'next/server'
import { authCaller } from '@/lib/survivalRuns'
import { readSides } from '@/lib/survivalLinkRedeem'

/**
 * GET /api/survival/link/preview?code= — what linking would join, for the site's /droidz_survival/link:
 * both accounts side by side (Ape Mini, runs, the season's best and tier, the pass), so the player can
 * choose whose progress stays. Nothing changes here.
 *
 *   → { ok, theirs: AccountSummary, mine: AccountSummary }
 *   → { ok: false, state: bad_code | used | expired | same_wallet | same_account | both_grouped | full | cooldown | banned | too_many_tries }
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    const sides = await readSides(caller, req.nextUrl.searchParams.get('code'))
    if (sides instanceof NextResponse) return sides
    return NextResponse.json({ ok: true, theirs: sides.theirs, mine: sides.mine }, { headers: { 'cache-control': 'no-store' } })
}
