import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer } from '@/lib/survivalRuns'
import { logEvent } from '@/lib/survivalLog'
import { MAX_ACCOUNT_WALLETS, walletsOf } from '@/lib/survivalAccount'

/**
 * POST /api/survival/link/unlink { wallet } — a linked wallet leaves the account
 * (lib/survivalAccount.ts). Any wallet of the account may do it, for any linked wallet; the main one
 * cannot leave (it IS the account). The account keeps everything — the save, the runs, the purchases
 * (the pass included: no handing a pass from one person to the next); the wallet goes back to its own
 * old save, if it had one, and may join an account again in 7 days.
 *
 *   → { ok, wallets: [{ wallet, main, you }], max }   the account as it is now
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { 'cache-control': 'no-store' }

export async function POST(req: NextRequest) {
    const caller = await authCaller(req, { recheck: true })
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await req.json().catch(() => ({})) as { wallet?: unknown }
    const target = typeof body.wallet === 'string' ? body.wallet.toLowerCase() : ''
    if (target === caller.wallet) return NextResponse.json({ ok: false, state: 'last_wallet' }, { headers: NO_STORE })
    if (!caller.wallets.includes(target)) return NextResponse.json({ ok: false, state: 'not_linked' }, { headers: NO_STORE })
    const { data, error } = await supabaseAdmin.rpc('survival_link_remove', { p_account: caller.wallet, p_wallet: target })
    if (error) return noServer('link.unlink', error)
    if (data !== 'ok') return NextResponse.json({ ok: false, state: String(data) }, { headers: NO_STORE })
    logEvent({ level: 'info', kind: 'account.unlink', wallet: caller.wallet, data: { wallet: target, by: caller.session } })
    const now = await walletsOf(caller.wallet)
    const wallets = now?.wallets ?? caller.wallets.filter((w) => w !== target)
    return NextResponse.json({
        ok: true,
        wallets: wallets.map((w) => ({ wallet: w, main: w === caller.wallet, you: w === caller.session })),
        max: MAX_ACCOUNT_WALLETS,
    }, { headers: NO_STORE })
}
