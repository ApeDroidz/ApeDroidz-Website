import { NextRequest, NextResponse } from 'next/server'
import { eth_getTransactionByHash, eth_getTransactionReceipt, getRpcClient } from 'thirdweb/rpc'
import { supabaseAdmin } from '@/lib/supabase'
import { apeChainServer, createServerThirdwebClient } from '@/lib/apechain'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { logEvent } from '@/lib/survivalLog'

/**
 * POST /api/survival/pay { txHash, kind: 'continue' | 'run' }
 *
 * The paid door in the game (CONTINUE for 1 APE, a new run for 1 APE). The page sends the
 * APE from the player's wallet to the treasury and hands the hash here; nothing is granted
 * on the client's word. Verified exactly like the Glitch Cards ticket purchase: the tx
 * exists, it was sent by the session's wallet, to the treasury, for exactly the price, and
 * it succeeded. Recorded in survival_payments (tx_hash is unique, so a hash can only ever
 * buy once) and in the journal.
 *
 * Replies: { ok: true } · { ok: false, state: 'mismatch' | 'not_found' | 'failed' | 'used' | 'no_season' }
 */
export const dynamic = 'force-dynamic'

const SURVIVAL_TREASURY = (process.env.SURVIVAL_TREASURY_WALLET ?? '0x1DcF1d22A1dbDd20AE875beDEEe3A259b1D608db').toLowerCase()
const PRICE_APE: Record<string, number> = { continue: 1, run: 1 }

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    const txHash = typeof body.txHash === 'string' ? body.txHash.toLowerCase() : ''
    const kind = typeof body.kind === 'string' && PRICE_APE[body.kind] ? body.kind : ''
    if (!/^0x[0-9a-f]{64}$/.test(txHash) || !kind) return NextResponse.json({ ok: false, state: 'malformed' })

    const { data: season } = await supabaseAdmin.from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle()
    if (!season) return NextResponse.json({ ok: false, state: 'no_season' })

    const { data: used } = await supabaseAdmin.from('survival_payments').select('id').eq('tx_hash', txHash).maybeSingle()
    if (used) return NextResponse.json({ ok: false, state: 'used' })

    try {
        const rpc = getRpcClient({ client: createServerThirdwebClient(), chain: apeChainServer })
        const tx = await eth_getTransactionByHash(rpc, { hash: txHash as `0x${string}` })
        if (!tx) return NextResponse.json({ ok: false, state: 'not_found' })
        const expected = BigInt(Math.round(PRICE_APE[kind] * 1e6)) * BigInt(1e12)
        if (tx.from.toLowerCase() !== caller.wallet || !tx.to || tx.to.toLowerCase() !== SURVIVAL_TREASURY || BigInt(tx.value) !== expected) {
            logEvent({ level: 'warn', kind: 'pay.mismatch', wallet: caller.wallet, message: kind, data: { txHash, from: tx.from, to: tx.to, value: String(tx.value) } })
            return NextResponse.json({ ok: false, state: 'mismatch' })
        }
        const receipt = await eth_getTransactionReceipt(rpc, { hash: txHash as `0x${string}` })
        if (!receipt || receipt.status !== 'success') return NextResponse.json({ ok: false, state: 'failed' })
    } catch (e) {
        console.error('[survival/pay] chain', (e as Error).message)
        return NextResponse.json({ ok: false, state: 'not_found' })
    }

    await supabaseAdmin.from('survival_players').upsert({ wallet: caller.wallet, last_seen: new Date().toISOString() }, { onConflict: 'wallet' })
    const { error } = await supabaseAdmin.from('survival_payments').insert({
        tx_hash: txHash, wallet: caller.wallet, season_id: season.id, amount_ape: PRICE_APE[kind],
        confirmed_at: new Date().toISOString(), credits_granted: kind === 'run' ? 1 : 0,
    })
    if (error) {
        if ((error as { code?: string }).code === '23505') return NextResponse.json({ ok: false, state: 'used' })
        console.error('[survival/pay] insert', error.message)
        return noServer()
    }
    logEvent({ level: 'info', kind: `pay.${kind}`, wallet: caller.wallet, message: txHash, data: { amountApe: PRICE_APE[kind] } })
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
}
