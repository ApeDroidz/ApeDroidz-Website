import { NextRequest, NextResponse } from 'next/server'
import { authCaller, noServer } from '@/lib/survivalRuns'
import { linkPageUrl, loadCode, MAX_ACCOUNT_WALLETS, newLinkCode, normCode } from '@/lib/survivalAccount'

/**
 * The game's half of a link (lib/survivalAccount.ts; owner, 17.10.2026).
 *
 *   POST → { ok, code, url, expiresAt }   a fresh code under the wallet the game is signed in with;
 *                                          the OTHER wallet redeems it on the site (/droidz_survival/link)
 *   GET ?code= → { ok, state: 'waiting' | 'linked' | 'expired' }   the game polls its own code
 *
 * The code is made under the SIGNED wallet, not the account: at redeem time the server resolves
 * both sides again, so a code made before some other link is still read correctly.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { 'cache-control': 'no-store' }

export async function POST(req: NextRequest) {
    const caller = await authCaller(req, { recheck: true })
    if (caller instanceof NextResponse) return caller
    if (caller.wallets.length >= MAX_ACCOUNT_WALLETS) return NextResponse.json({ ok: false, state: 'full' }, { headers: NO_STORE })
    const made = await newLinkCode(caller.session)
    if (made === null) return noServer('link.code')
    if (made === 'too_many_codes') return NextResponse.json({ ok: false, state: made }, { headers: NO_STORE })
    return NextResponse.json({ ok: true, code: made.code, url: linkPageUrl(made.code), expiresAt: made.expiresAt }, { headers: NO_STORE })
}

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    const code = normCode(req.nextUrl.searchParams.get('code'))
    if (!code) return NextResponse.json({ ok: false, state: 'bad_code' }, { status: 400, headers: NO_STORE })
    const row = await loadCode(code)
    if (row === 'error') return noServer('link.code')
    // Only its maker may watch a code.
    if (!row || row.wallet !== caller.session) return NextResponse.json({ ok: false, state: 'bad_code' }, { headers: NO_STORE })
    const state = row.used_at ? 'linked' : Date.parse(row.expires_at) < Date.now() ? 'expired' : 'waiting'
    return NextResponse.json({ ok: true, state }, { headers: NO_STORE })
}
