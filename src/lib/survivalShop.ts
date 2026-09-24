/**
 * Droidz Survival — what can be bought, and how a payment is recognised on chain.
 *
 * Every purchase is an ORDER the server creates (api/survival/order) and the player pays through
 * the cashier contract (contracts/src/DroidzCashier.sol): `pay(player, order)` with the price as
 * value. The contract splits the money on the spot (half to the prize-pool wallet, half to the
 * treasury, set at deploy) and emits
 *     Paid(address indexed player, bytes32 indexed order, address indexed payer, uint256 amount, uint256 toPool)
 * The server credits an order only for that event, from that contract, naming that player and that
 * order, for at least `minWei`. Nothing else about the transaction matters — which is what lets
 * the same check pass for a MetaMask payment on the site and a Glyph payment in Otherside, where
 * the Hub routes the call through its FeeSplitter and takes 1.5% first.
 */

export type Sku = 'run' | 'run10' | 'continue'

export const SKUS: Record<Sku, { priceApe: number; credits: number; label: string }> = {
    run: { priceApe: 1, credits: 1, label: '1 run' },
    run10: { priceApe: 9, credits: 10, label: '10 runs' },
    continue: { priceApe: 1, credits: 0, label: 'Continue this run' },
}

export const isSku = (v: unknown): v is Sku => typeof v === 'string' && v in SKUS

/** The Otherside Hub's platform fee on native value (partner guide: default 150 bps). */
export const HUB_FEE_BPS = BigInt(150)

/** The cashier contract; '' until it is deployed and configured. */
export const CASHIER = (process.env.SURVIVAL_CASHIER ?? process.env.NEXT_PUBLIC_SURVIVAL_CASHIER ?? '').toLowerCase()

/** keccak256("pay(address,bytes32)")[:4] */
const PAY_SELECTOR = '0x46f8f304'
/** keccak256("Paid(address,bytes32,address,uint256,uint256)") */
export const PAID_TOPIC = '0x10fa550e6cee394dcb546ce24d453ae92dabb7bcc15a4c80b6cd40394f11d51f'

// The site compiles to ES2017: no bigint literals, BigInt() instead.
const MICRO = BigInt(10) ** BigInt(12)
const BPS = BigInt(10_000)
export const apeToWei = (ape: number): bigint => BigInt(Math.round(ape * 1e6)) * MICRO
export const weiToApe = (wei: bigint): number => Number(wei / MICRO) / 1e6

/** The least the cashier must receive for a price: net of the Hub fee, so a Glyph payment counts. */
export const minWeiFor = (priceApe: number): bigint => (apeToWei(priceApe) * (BPS - HUB_FEE_BPS)) / BPS

/** An order's uuid as the bytes32 the contract carries: the 16 bytes, left-aligned. */
export const orderRef = (orderId: string): string => `0x${orderId.replace(/-/g, '').toLowerCase().padEnd(64, '0')}`

const word = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')

/** Calldata for `pay(player, orderRef(orderId))`. */
export function encodePay(player: string, orderId: string): string {
    return `${PAY_SELECTOR}${word(player)}${word(orderRef(orderId))}`
}

export type PaidEvent = { player: string; order: string; payer: string; amount: bigint; toPool: bigint; logIndex: number; blockNumber: bigint }

type Log = { address: string; topics: readonly string[]; data: string; logIndex?: number | bigint | null; blockNumber?: bigint | null }

/** Every Paid event the cashier emitted in these logs. */
export function paidEvents(logs: readonly Log[]): PaidEvent[] {
    const out: PaidEvent[] = []
    for (const l of logs) {
        if (!CASHIER || l.address.toLowerCase() !== CASHIER) continue
        if ((l.topics[0] ?? '').toLowerCase() !== PAID_TOPIC || l.topics.length !== 4) continue
        const data = l.data.replace(/^0x/, '')
        if (data.length !== 128) continue
        out.push({
            player: `0x${l.topics[1].slice(-40)}`.toLowerCase(),
            order: l.topics[2].toLowerCase(),
            payer: `0x${l.topics[3].slice(-40)}`.toLowerCase(),
            amount: BigInt(`0x${data.slice(0, 64)}`),
            toPool: BigInt(`0x${data.slice(64, 128)}`),
            logIndex: Number(l.logIndex ?? 0),
            blockNumber: BigInt(l.blockNumber ?? 0),
        })
    }
    return out
}

export function describe(sku: Sku): string {
    const s = SKUS[sku]
    return `Droidz Survival — ${s.label} for ${s.priceApe} APE. Half goes to the season prize pool.`
}
