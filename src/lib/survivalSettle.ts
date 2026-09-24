import { eth_blockNumber, eth_getLogs, eth_getTransactionReceipt, getRpcClient } from 'thirdweb/rpc'
import { supabaseAdmin } from '@/lib/supabase'
import { apeChainServer, createServerThirdwebClient } from '@/lib/apechain'
import { CASHIER, HUB_FEE_SPLITTER, orderIdFromRef, orderRef, PAID_TOPIC, paidEvents, type PaidEvent } from '@/lib/survivalShop'
import { logEvent } from '@/lib/survivalLog'
import { deliverTicketNfts } from '@/lib/survivalTicketNft'

/**
 * Booking a payment against its order — the one place that decides whether money arrived.
 * The chain is read for the cashier's Paid event naming this player and this order; the booking
 * itself is survival_settle_order (one transaction: order, payment, credits, pool ledger), which
 * also checks the mode and the price floor (full price, or 90% when it came through the Hub).
 */

export type OrderRow = { id: string; wallet: string; sku: string; mode: string; status: string; tx_hash: string | null; platform: string; from_block: number | null; created_at: string }
export const ORDER_COLUMNS = 'id, wallet, sku, mode, status, tx_hash, platform, from_block, created_at'

export const rpc = () => getRpcClient({ client: createServerThirdwebClient(), chain: apeChainServer })

export type SettleState = 'paid' | 'used' | 'underpaid' | 'wrong_mode' | 'no_order' | 'not_found' | 'failed' | 'mismatch' | 'no_server'

async function book(order: OrderRow, txHash: string, ev: PaidEvent): Promise<SettleState> {
    if (!ev.mode) return 'wrong_mode'
    const { data, error } = await supabaseAdmin.rpc('survival_settle_order', {
        p_order: order.id, p_wallet: order.wallet, p_tx: txHash, p_paid_wei: ev.amount.toString(),
        p_to_pool_wei: ev.toPool.toString(), p_block: Number(ev.blockNumber), p_platform: order.platform,
        p_mode: ev.mode, p_payer: ev.payer, p_via_hub: ev.payer === HUB_FEE_SPLITTER,
    })
    if (error) { console.error('[survival/settle]', error.message); return 'no_server' }
    const state = data as SettleState
    // A lucky ticket that drew an NFT reserved it for this player: send it now.
    if (state === 'paid' && order.sku === 'ticket') await deliverTicketNfts({ wallet: order.wallet }).catch(() => [])
    logEvent({
        level: state === 'paid' ? 'info' : 'warn', kind: `pay.${state}`, wallet: order.wallet, message: `${order.sku} ${txHash}`,
        data: { orderId: order.id, sku: order.sku, mode: ev.mode, payer: ev.payer, amountWei: ev.amount.toString(), toPoolWei: ev.toPool.toString(), platform: order.platform },
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
    return book(order, txHash, ev)
}

/** The public RPC answers eth_getLogs for up to ~500k blocks (~5 days at ~0.9 s a block). */
const LOG_SPAN = BigInt(400_000)

/**
 * The client never came back (tab closed mid-payment, network drop): look for each pending
 * order's Paid event on chain by its indexed player + order, from the height the order was made.
 * Called whenever the player's credits are read, so a paid order is never left unbooked.
 */
export async function settlePending(wallet: string): Promise<number> {
    if (!CASHIER) return 0
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const { data } = await supabaseAdmin.from('survival_orders').select(ORDER_COLUMNS)
        .eq('wallet', wallet).eq('status', 'pending').gte('created_at', since).not('from_block', 'is', null)
        .order('created_at', { ascending: false }).limit(10)
    const orders = (data as OrderRow[] | null) ?? []
    if (orders.length === 0) return 0
    const head = await eth_blockNumber(rpc()).catch(() => null)
    if (head === null) return 0
    let booked = 0
    for (const order of orders) {
        const topics = [PAID_TOPIC, `0x${wallet.slice(2).padStart(64, '0')}`, orderRef(order.id)] as `0x${string}`[]
        for (let from = BigInt(order.from_block ?? 0); from <= head; from += LOG_SPAN) {
            const last = from + LOG_SPAN - BigInt(1)
            const logs = await eth_getLogs(rpc(), { address: CASHIER as `0x${string}`, topics, fromBlock: from, toBlock: last < head ? last : head }).catch(() => [])
            const ev = paidEvents(logs as never)[0]
            const tx = (logs[0] as { transactionHash?: string } | undefined)?.transactionHash
            if (!ev || !tx) continue
            if ((await book(order, tx.toLowerCase(), ev)) === 'paid') booked++
            break
        }
    }
    return booked
}

/**
 * Support: book whatever orders this transaction paid, for whoever they belong to (the Payments tab
 * in the panel). Same rules as a player's own report — the event decides, never the operator.
 */
export async function settleAnyInTx(txHash: string): Promise<Array<{ orderId: string; state: SettleState }>> {
    const receipt = await eth_getTransactionReceipt(rpc(), { hash: txHash as `0x${string}` }).catch(() => null)
    if (!receipt) return [{ orderId: '', state: 'not_found' }]
    if (receipt.status !== 'success') return [{ orderId: '', state: 'failed' }]
    const out: Array<{ orderId: string; state: SettleState }> = []
    for (const ev of paidEvents(receipt.logs as never)) {
        const id = orderIdFromRef(ev.order)
        const { data } = await supabaseAdmin.from('survival_orders').select(ORDER_COLUMNS).eq('id', id).maybeSingle()
        const order = data as OrderRow | null
        if (!order || order.wallet !== ev.player) { out.push({ orderId: id, state: 'no_order' }); continue }
        if (order.status === 'paid') { out.push({ orderId: id, state: order.tx_hash === txHash ? 'paid' : 'used' }); continue }
        out.push({ orderId: id, state: await book(order, txHash, ev) })
    }
    return out.length ? out : [{ orderId: '', state: 'mismatch' }]
}
