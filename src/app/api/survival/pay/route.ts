import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { ORDER_COLUMNS, settleByTx, type OrderRow } from '@/lib/survivalSettle'

/**
 * POST /api/survival/pay { txHash, orderId }
 *
 * The page paid an order (api/survival/order) and hands the hash here. Nothing is granted on the
 * client's word: the order is booked only if that transaction carries the cashier's Paid event
 * for THIS player and THIS order, for at least the order's price net of the Hub fee
 * (lib/survivalSettle.ts). The booking is one transaction — payment, credits, pool ledger.
 *
 * Until 24.09.2026 this route accepted a plain transfer to the treasury and compared tx.from /
 * tx.to / tx.value. In the Otherside Hub none of those hold (the Hub's FeeSplitter is `to`, a
 * sponsored call has an ERC-4337 `from`, 1.5% is taken off the value), so that path is gone.
 *
 * Replies: { ok: true } · { ok: false, state: 'malformed' | 'no_order' | 'not_found' | 'failed' |
 *          'mismatch' | 'underpaid' | 'wrong_mode' | 'used' }. 'not_found' = not mined yet: ask again shortly.
 */
export const dynamic = 'force-dynamic'
const noStore = { 'cache-control': 'no-store' }

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    const txHash = typeof body.txHash === 'string' ? body.txHash.toLowerCase() : ''
    const orderId = typeof body.orderId === 'string' ? body.orderId.toLowerCase() : ''
    if (!/^0x[0-9a-f]{64}$/.test(txHash) || !/^[0-9a-f-]{36}$/.test(orderId)) return NextResponse.json({ ok: false, state: 'malformed' }, { headers: noStore })

    const { data: order } = await supabaseAdmin.from('survival_orders')
        .select(ORDER_COLUMNS).eq('id', orderId).maybeSingle()
    if (!order || (order as OrderRow).wallet !== caller.wallet) return NextResponse.json({ ok: false, state: 'no_order' }, { headers: noStore })

    const state = await settleByTx(order as OrderRow, txHash)
    if (state === 'no_server') return noServer()
    return NextResponse.json(state === 'paid' ? { ok: true } : { ok: false, state }, { headers: noStore })
}
