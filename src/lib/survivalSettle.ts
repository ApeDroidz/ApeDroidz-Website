import { eth_blockNumber, eth_getBlockByNumber, eth_getLogs, eth_getTransactionReceipt, getRpcClient } from 'thirdweb/rpc'
import { supabaseAdmin } from '@/lib/supabase'
import { apeChainServer, createServerThirdwebClient } from '@/lib/apechain'
import { apeToWei, CASHIER, HUB_FEE_SPLITTER, hubFeeFor, loadCatalog, orderIdFromRef, orderRef, PAID_TOPIC, paidEvents, priceFor, type Log, type PaidEvent } from '@/lib/survivalShop'
import { isDroidHolder } from '@/lib/droidHolder'
import { logEvent } from '@/lib/survivalLog'
import { deliverTicketNfts } from '@/lib/survivalTicketNft'
import { markFirstPurchase } from '@/lib/survivalFunnelServer'

/**
 * Booking a payment against its order — the one place that decides whether money arrived.
 * The chain is read for the cashier's Paid event naming this player and this order; the booking
 * itself is survival_settle_order (one transaction: order, payment, credits, pool ledger), which
 * also checks the mode and the price floor (full price, or 90% at the cashier when it came through
 * the Hub — and then book() has already checked that the cashier's share plus the Hub's own fee
 * receipt make the full price).
 */

export type OrderRow = { id: string; wallet: string; sku: string; kind: string; mode: string; status: string; tx_hash: string | null; platform: string; from_block: number | null; created_at: string; min_wei: string | number; dismissed_at?: string | null }
export const ORDER_COLUMNS = 'id, wallet, sku, kind, mode, status, tx_hash, platform, from_block, created_at, min_wei, dismissed_at'

export const rpc = () => getRpcClient({ client: createServerThirdwebClient(), chain: apeChainServer })

/**
 * `late` — the order was paid more than ORDER_TTL_MS after it was made, for less than today's
 * price (a sale price «frozen» in an order and paid after the sale): the money is on chain, the
 * order stays pending, nothing is granted; support settles it by hand (Payments in spltpnl).
 */
export type SettleState = 'paid' | 'used' | 'underpaid' | 'wrong_mode' | 'no_order' | 'not_found' | 'failed' | 'mismatch' | 'no_server' | 'late'

/** A promise, or `fallback` if it takes longer than `ms` (the work itself goes on). */
export const within = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

/**
 * How long an order holds its price. An order copies the price of the moment (a running sale, the
 * holder discount); paid later than this — by the BLOCK's clock, not ours, since a payment may be
 * booked a day after it was made — it must meet the price of the day instead.
 */
const ORDER_TTL_MS = 60 * 60 * 1000

/** When the block was made (ms), or null if the chain would not say. */
async function blockTime(block: bigint): Promise<number | null> {
    const b = await eth_getBlockByNumber(rpc(), { blockNumber: block }).catch(() => null)
    return b?.timestamp != null ? Number(b.timestamp) * 1000 : null
}

/** What this order's item costs this wallet today (null: not on sale any more). */
async function priceToday(order: OrderRow): Promise<bigint | null> {
    const item = (await loadCatalog(true)).find((c) => c.sku === order.sku)
    if (!item) return null
    const price = item.holder_discount_pct > 0 ? priceFor(item, await isDroidHolder(order.wallet).catch(() => false)) : item.price_ape
    return apeToWei(price)
}

/** The settle function with the event's log index (v7); an older database without it answers as v6. */
async function settleRpc(args: Record<string, unknown>, logIndex: number): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
    const v7 = await supabaseAdmin.rpc('survival_settle_order', { ...args, p_log_index: logIndex })
    const missing = v7.error && (v7.error.code === 'PGRST202' || /could not find the function/i.test(v7.error.message))
    return missing ? supabaseAdmin.rpc('survival_settle_order', args) : v7
}

async function book(order: OrderRow, txHash: string, ev: PaidEvent, logs?: readonly Log[]): Promise<SettleState> {
    if (!ev.mode) return 'wrong_mode'
    const viaHub = ev.payer === HUB_FEE_SPLITTER
    const say = (state: SettleState, extra: Record<string, unknown> = {}): SettleState => {
        logEvent({
            level: state === 'paid' ? 'info' : 'warn', kind: `pay.${state}`, wallet: order.wallet, message: `${order.sku} ${txHash}`,
            data: { orderId: order.id, sku: order.sku, mode: ev.mode, payer: ev.payer, amountWei: ev.amount.toString(), toPoolWei: ev.toPool.toString(), platform: order.platform, ...extra },
        })
        return state
    }
    // What the player sent. Through the Hub the cashier gets the price less the Hub's fee, and the
    // fee is read from the Hub's own receipt of it: the FeeSplitter takes calls from anyone, with any
    // fee, so «it came through the Hub» alone would let 90% of the price pass as a full payment.
    let sent = ev.amount
    if (viaHub) {
        let all = logs
        if (!all) {
            const receipt = await eth_getTransactionReceipt(rpc(), { hash: txHash as `0x${string}` }).catch(() => null)
            if (!receipt) return 'no_server'
            all = receipt.logs as unknown as Log[]
        }
        const fee = hubFeeFor(all, ev)
        if (fee === null || ev.amount + fee < BigInt(String(order.min_wei))) return say('underpaid', { hubFee: fee?.toString() ?? null, minWei: String(order.min_wei) })
        sent = ev.amount + fee
    }
    // An order paid long after it was made meets today's price, not the one it was made at.
    const paidAt = await blockTime(ev.blockNumber)
    if (paidAt !== null && paidAt > Date.parse(order.created_at) + ORDER_TTL_MS) {
        const today = order.kind === 'season_pass' ? null : await priceToday(order)
        if (today === null || sent < today) return say('late', { paidAt: new Date(paidAt).toISOString(), todayWei: today?.toString() ?? null, sentWei: sent.toString() })
    }
    const { data, error } = await settleRpc({
        p_order: order.id, p_wallet: order.wallet, p_tx: txHash, p_paid_wei: ev.amount.toString(),
        p_to_pool_wei: ev.toPool.toString(), p_block: Number(ev.blockNumber), p_platform: order.platform,
        p_mode: ev.mode, p_payer: ev.payer, p_via_hub: viaHub,
    }, ev.logIndex)
    if (error) { console.error('[survival/settle]', error.message); return 'no_server' }
    const state = data as SettleState
    // The funnel's «first purchase» (lib/survivalFunnelServer.ts): started now, awaited below.
    const first = state === 'paid' ? markFirstPurchase(order.wallet, order.sku) : null
    // A lucky ticket (one, or a pack of them) that drew an NFT reserved it for this player: send it
    // now — bounded, so a slow send never costs the payment's own answer; the alert and «Retry
    // send» in the panel pick up whatever is left reserved.
    if (state === 'paid' && order.kind === 'ticket') await within(deliverTicketNfts({ wallet: order.wallet }).catch(() => []), 6000, [])
    if (first) await within(first, 3000, undefined)
    return say(state)
}

/** The client came back with a hash: find the order's Paid event in that transaction. */
export async function settleByTx(order: OrderRow, txHash: string): Promise<SettleState> {
    if (order.status === 'paid') return order.tx_hash === txHash ? 'paid' : 'used'
    const receipt = await eth_getTransactionReceipt(rpc(), { hash: txHash as `0x${string}` }).catch(() => null)
    if (!receipt) return 'not_found'
    if (receipt.status !== 'success') return 'failed'
    const logs = receipt.logs as unknown as Log[]
    const ev = paidEvents(logs).find((e) => e.order === orderRef(order.id) && e.player === order.wallet)
    if (!ev) {
        logEvent({ level: 'warn', kind: 'pay.mismatch', wallet: order.wallet, message: txHash, data: { orderId: order.id } })
        return 'mismatch'
    }
    return book(order, txHash, ev, logs)
}

/** The public RPC answers eth_getLogs for up to ~500k blocks (~5 days at ~0.9 s a block). */
const LOG_SPAN = BigInt(400_000)

/**
 * When each wallet's pending orders were last looked for on chain (this instance). An order made in
 * the last few minutes is looked for on every call — that is the payment in flight; older ones
 * (a wallet opened and walked away from) at most every SCAN_EVERY_MS.
 */
const lastScan = new Map<string, number>()
const SCAN_EVERY_MS = 5 * 60 * 1000
const FRESH_ORDER_MS = 10 * 60 * 1000

/**
 * The client never came back (tab closed mid-payment, network drop): look for the pending orders'
 * Paid events on chain by the indexed player and the orders, in ONE request (the orders' refs as
 * alternatives), from the earliest height they were made at. Called whenever the player's credits
 * are read, so a paid order is never left unbooked.
 *
 * Open orders are looked at first, closed ones («Close» in the panel, cancelled in the wallet)
 * after — a closed order is still booked if its payment turns up. An order made without its
 * height (the RPC was down) is looked for back one span.
 */
export async function settlePending(wallet: string): Promise<number> {
    if (!CASHIER) return 0
    // Two days back is plenty: a paid order is booked on the pay report or the next reads; an order
    // left unpaid for days is not scanned for on every visit (each costs chain reads).
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const { data } = await supabaseAdmin.from('survival_orders').select(ORDER_COLUMNS)
        .eq('wallet', wallet).eq('status', 'pending').gte('created_at', since)
        .order('dismissed_at', { ascending: true, nullsFirst: true }).order('created_at', { ascending: false }).limit(8)
    const orders = (data as OrderRow[] | null) ?? []
    if (orders.length === 0) return 0
    const now = Date.now()
    const fresh = orders.some((o) => now - Date.parse(o.created_at) < FRESH_ORDER_MS)
    if (!fresh && now - (lastScan.get(wallet) ?? 0) < SCAN_EVERY_MS) return 0
    lastScan.set(wallet, now)
    if (lastScan.size > 5000) lastScan.clear()
    const head = await eth_blockNumber(rpc()).catch(() => null)
    if (head === null) return 0
    const floor = head > LOG_SPAN ? head - LOG_SPAN : BigInt(0)
    const froms = orders.map((o) => (o.from_block != null ? BigInt(o.from_block) : floor))
    let from = froms.reduce((a, b) => (b < a ? b : a))
    if (from < floor) from = floor
    const topics = [PAID_TOPIC, `0x${wallet.slice(2).padStart(64, '0')}`, orders.map((o) => orderRef(o.id))] as unknown as `0x${string}`[]
    const logs = await eth_getLogs(rpc(), { address: CASHIER as `0x${string}`, topics, fromBlock: from, toBlock: head }).catch(() => null)
    if (logs === null) return 0
    let booked = 0
    for (const l of logs as unknown as Array<Log & { transactionHash?: string }>) {
        const ev = paidEvents([l])[0]
        const tx = l.transactionHash
        const order = ev && orders.find((o) => orderRef(o.id) === ev.order && o.wallet === ev.player)
        if (!ev || !order || !tx) continue
        if ((await book(order, tx.toLowerCase(), ev)) === 'paid') booked++
    }
    return booked
}

/**
 * One order's Paid event, looked for on chain by its indexed player + order from the height the
 * order was made, and booked if it is there. `not_paid` — the chain has no such event (the player
 * opened the wallet and walked away). Used by settlePending and by the panel's «Check chain».
 */
export async function scanOrder(order: OrderRow, head?: bigint): Promise<SettleState | 'not_paid' | 'no_rpc'> {
    if (!CASHIER) return 'no_server'
    if (order.status === 'paid') return 'paid'
    const top = head ?? await eth_blockNumber(rpc()).catch(() => null)
    if (top === null) return 'no_rpc'
    // An order made before from_block was recorded: look back one span from now.
    const start = order.from_block != null ? BigInt(order.from_block) : (top > LOG_SPAN ? top - LOG_SPAN : BigInt(0))
    const topics = [PAID_TOPIC, `0x${order.wallet.slice(2).padStart(64, '0')}`, orderRef(order.id)] as `0x${string}`[]
    for (let from = start; from <= top; from += LOG_SPAN) {
        const last = from + LOG_SPAN - BigInt(1)
        const logs = await eth_getLogs(rpc(), { address: CASHIER as `0x${string}`, topics, fromBlock: from, toBlock: last < top ? last : top }).catch(() => null)
        if (logs === null) return 'no_rpc'
        const ev = paidEvents(logs as never)[0]
        const tx = (logs[0] as { transactionHash?: string } | undefined)?.transactionHash
        if (!ev || !tx) continue
        return book(order, tx.toLowerCase(), ev)
    }
    return 'not_paid'
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
    const logs = receipt.logs as unknown as Log[]
    for (const ev of paidEvents(logs)) {
        const id = orderIdFromRef(ev.order)
        const { data } = await supabaseAdmin.from('survival_orders').select(ORDER_COLUMNS).eq('id', id).maybeSingle()
        const order = data as OrderRow | null
        if (!order || order.wallet !== ev.player) { out.push({ orderId: id, state: 'no_order' }); continue }
        if (order.status === 'paid') { out.push({ orderId: id, state: order.tx_hash === txHash ? 'paid' : 'used' }); continue }
        out.push({ orderId: id, state: await book(order, txHash, ev, logs) })
    }
    return out.length ? out : [{ orderId: '', state: 'mismatch' }]
}
