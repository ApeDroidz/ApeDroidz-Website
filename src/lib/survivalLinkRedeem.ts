import { NextResponse } from 'next/server'
import type { Caller } from '@/lib/survivalRuns'
import { accountOf, accountSummary, loadCode, MAX_ACCOUNT_WALLETS, normCode, UNLINK_COOLDOWN_DAYS, type AccountSummary } from '@/lib/survivalAccount'
import { liveSeasonId } from '@/lib/survivalEconomyStore'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * The site's half of a link: the redeeming wallet (signed in on apedroidz.com) and the code made in
 * the game by the other one — both read the same way by the preview and the redeem.
 *
 * A wrong code is counted per redeeming wallet (and the middleware caps the routes per IP): eight of
 * 32 characters for ten minutes is far past guessing, and this keeps it so.
 */

const misses = new Map<string, { n: number; reset: number }>()
const MISS_MAX = 10
const MISS_WINDOW = 10 * 60_000

function missed(wallet: string): void {
    const now = Date.now()
    const m = misses.get(wallet)
    if (!m || now > m.reset) misses.set(wallet, { n: 1, reset: now + MISS_WINDOW })
    else m.n += 1
}
const blocked = (wallet: string): boolean => { const m = misses.get(wallet); return !!m && Date.now() < m.reset && m.n >= MISS_MAX }

export interface LinkSides {
    code: string
    /** The code's side — the wallet that made it in the game, and its account. */
    theirs: AccountSummary
    /** The redeeming side — the wallet signed in on the site, and its account. */
    mine: AccountSummary
}

const NO_STORE = { 'cache-control': 'no-store' }
const say = (state: string, status = 200) => NextResponse.json({ ok: false, state }, { status, headers: NO_STORE })

export async function readSides(caller: Caller, rawCode: unknown): Promise<LinkSides | NextResponse> {
    if (blocked(caller.session)) return say('too_many_tries', 429)
    const code = normCode(rawCode)
    if (!code) { missed(caller.session); return say('bad_code') }
    const row = await loadCode(code)
    if (row === 'error') return say('no_server', 503)
    if (!row) { missed(caller.session); return say('bad_code') }
    if (row.used_at) return say('used')
    if (Date.parse(row.expires_at) < Date.now()) return say('expired')
    if (row.wallet === caller.session) return say('same_wallet')
    const accA = await accountOf(row.wallet)
    if (!accA) return say('no_server', 503)
    if (accA.account === caller.wallet) return say('same_account')
    if (accA.wallets.length > 1 && caller.wallets.length > 1) return say('both_grouped')
    if (accA.wallets.length + caller.wallets.length > MAX_ACCOUNT_WALLETS) return say('full')
    // A joining wallet (a side that is a single wallet — when both are, either) must not have left an
    // account in the last week (the same rule as survival_link_redeem).
    const joining = [...(accA.wallets.length === 1 ? [row.wallet] : []), ...(caller.wallets.length === 1 ? [caller.session] : [])]
    if (supabaseAdmin) {
        const since = new Date(Date.now() - UNLINK_COOLDOWN_DAYS * 86_400_000).toISOString()
        const { data } = await supabaseAdmin.from('survival_wallet_unlinks').select('id').in('wallet', joining).gte('unlinked_at', since).limit(1)
        if ((data ?? []).length) return say('cooldown')
    }
    const sid = await liveSeasonId().catch(() => null)
    const [theirs, mine] = await Promise.all([accountSummary(accA, sid), accountSummary({ account: caller.wallet, wallets: caller.wallets }, sid)])
    if (!theirs || !mine) return say('no_server', 503)
    if (theirs.banned || mine.banned) return say('banned')
    return { code, theirs, mine }
}
