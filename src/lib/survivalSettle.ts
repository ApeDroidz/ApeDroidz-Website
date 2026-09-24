import { eth_getLogs, eth_getTransactionReceipt, getRpcClient } from 'thirdweb/rpc'
import { supabaseAdmin } from '@/lib/supabase'
import { apeChainServer, createServerThirdwebClient } from '@/lib/apechain'
import { CASHIER, orderRef, PAID_TOPIC, paidEvents } from '@/lib/survivalShop'
import { logEvent } from '@/lib/survivalLog'

/**
 * Booking a payment against its order — the one place that decides whether money arrived.
 * The chain is read for the cashier's Paid event naming this player and this order; the booking
 * itself is survival_settle_order (one transaction: order, payment, credits, pool ledger).
 */

export type OrderRow = { id: string; wallet: string; sku: string; status: string; tx_hash: string | null; platform: string; from_block: number | null; created_at: string }

export const rpc = () => getRpcClient({ client: createServerThirdwebClient(), chain: apeChainServer })

export type SettleState = 'paid' | 'used' | 'underpaid' | 'no_order' | 'not_found' | 'failed' | 'mismatch' | 'no_server'

async function book(order: OrderRow, txHash: string, amount: bigint, toPool: bigint, block: bigint): Promise<SettleState> {
    const { data, error } = await supabaseAdmin.rpc('survival_settle_order', {
        p_order: order.id, p_wallet: order.wallet, p_tx: txHash, p_paid_wei: amount.toString(),
        p_to_pool_wei: toPool.toString(), p_block: Number(block), p_platform: order.platform,
    })
    if (error) { console.error('[survival/settle]', error.message); return 'no_server' }
    const state = data as SettleState
    logEvent({
        level: state === 'paid' ? 'info' : 'warn', kind: `pay.${state}`, wallet: order.wallet, message: `${order.sku} ${txHash}`,
        data: { orderId: order.id, sku: order.sku, amountWei: amount.toString(), toPoolWei: toPool.toString(), platform: order.platform },
    })
    return state
}

/** The client came back with a hash: find the order's Paid event in that transaction. */
export async function settleByTx(order: OrderRow, txHash: string): Promise<SettleState> {
    if (order.status === 'paid') return order.tx_hash === txHash ? 'paid' : 'used'
    const receipt = await eth_getTransactionReceipt(rpc(), { hash: txHash as `0x${string}` }).catch(() => null)
    if (!receipt) return 'not_found'
    if (receipt.status !== 'success') return 'failed'
    const ev = paidEvents(receipt.logs as never).find((e) => e.order === orderRef(order.id) && e.player === order.wallet)
    if (!ev) {
        logEvent({ level: 'warn', kind: 'pay.mismatch', wallet: order.wallet, message: txHash, data: { orderId: order.id } })
        return 'mismatch'
    }
    return book(order, txHash, ev.amount, ev.toPool, ev.blockNumber)
}

/**
 * The client never came back (tab closed mid-payment, network drop): look for each pending
 * order's Paid event on chain by its indexed player + order, from the height the order was made.
 * Called whenever the player's credits are read, so a paid order is never left unbooked.
 */
export async function settlePending(wallet: string): Promise<number> {
    if (!CASHIER) return 0
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
    const { data } = await supabaseAdmin.from('survival_orders')
        .select('id, wallet, sku, status, tx_hash, platform, from_block, created_at')
        .eq('wallet', wallet).eq('status', 'pending').gte('created_at', since).not('from_block', 'is', null).limit(20)
    let booked = 0
    for (const order of (data as OrderRow[] | null) ?? []) {
        const logs = await eth_getLogs(rpc(), {
            address: CASHIER as `0x${string}`,
            topics: [PAID_TOPIC as `0x${string}`, `0x${wallet.slice(2).padStart(64, '0')}` as `0x${string}`, orderRef(order.id) as `0x${string}`],
            fromBlock: BigInt(order.from_block ?? 0),
        }).catch(() => [])
        const ev = paidEvents(logs as never)[0]
        const tx = (logs[0] as { transactionHash?: string } | undefined)?.transactionHash
        if (!ev || !tx) continue
        if ((await book(order, tx.toLowerCase(), ev.amount, ev.toPool, ev.blockNumber)) === 'paid') booked++
    }
    return booked
}
