import { supabaseAdmin } from '@/lib/supabase'

/**
 * Droidz Survival — what can be bought, and how a payment is recognised on chain.
 *
 * Every purchase is an ORDER the server creates (api/survival/order) and the player pays through
 * the cashier contract (contracts/src/DroidzCashier.sol): `pay(player, order, mode)` with the
 * price as value. The contract splits the money on the spot — half to the pool vault of the mode
 * (solo / co-op), half to the team wallet, fixed at deploy — and emits
 *     Paid(address indexed player, bytes32 indexed order, address indexed payer, uint8 mode, uint256 amount, uint256 toPool)
 * The server credits an order only for that event, from that contract, naming that player, that
 * order and that mode, for at least the price — or 90% of it when the payer is the Otherside Hub's
 * FeeSplitter, which takes its platform fee (default 1.5%, at most 10% by its contract) before
 * forwarding. Nothing else about the transaction matters, so the same check passes for a MetaMask
 * payment on the site and a Glyph payment in Otherside.
 */

export type Mode = 'solo' | 'coop'
export type CatalogKind = 'runs' | 'season_pass' | 'item' | 'box' | 'bundle' | 'ticket'

/**
 * One thing that can be bought — survival_catalog, edited by the owner in spltpnl (owner,
 * 25.09.2026: «цену забега хочу менять»). An order copies the row, so a price change never touches
 * an order already in flight. Runs become credits; everything else becomes an entitlement the game
 * applies (lib/survivalSettle.ts, api/survival/entitlements).
 */
export type CatalogItem = {
    sku: string; kind: CatalogKind; title: string; description: string; price_ape: number
    credits: number; mode: Mode; grant_spec: Record<string, unknown>; active: boolean; sort: number
    /** Off for ApeDroidz holders, 0–90 (the season pass: 30 — owner, 25.09.2026). */
    holder_discount_pct: number
}

export async function loadCatalog(activeOnly = true): Promise<CatalogItem[]> {
    let q = supabaseAdmin.from('survival_catalog').select('sku, kind, title, description, price_ape, credits, mode, grant_spec, active, sort, holder_discount_pct').order('sort')
    if (activeOnly) q = q.eq('active', true)
    const { data, error } = await q
    if (error) { console.error('[survival/catalog]', error.message); return [] }
    return ((data as CatalogItem[] | null) ?? []).map((c) => ({ ...c, price_ape: Number(c.price_ape), holder_discount_pct: Number(c.holder_discount_pct ?? 0) }))
}

/** What this wallet pays: the holder discount, rounded to 0.01 APE. */
export const priceFor = (item: CatalogItem, holder: boolean): number =>
    holder && item.holder_discount_pct > 0 ? Math.round(item.price_ape * (100 - item.holder_discount_pct)) / 100 : item.price_ape

/**
 * What the game needs to show a price list: no internals. `priceApe` is what THIS wallet pays;
 * `fullPriceApe` and `holderDiscountPct` let the game strike the full price through for a holder,
 * and tell everyone else that holders pay less.
 */
export const publicCatalog = (items: CatalogItem[], holder = false) =>
    items.map((i) => ({
        sku: i.sku, kind: i.kind, title: i.title, description: i.description, priceApe: priceFor(i, holder), fullPriceApe: i.price_ape,
        holderDiscountPct: i.holder_discount_pct, count: Number((i.grant_spec as { count?: number })?.count ?? 1), credits: i.credits, mode: i.mode,
    }))

export const MODE_ID: Record<Mode, number> = { solo: 0, coop: 1 }
export const isMode = (v: unknown): v is Mode => v === 'solo' || v === 'coop'
/** Co-op is not built yet: no co-op purchases until it is (SURVIVAL_COOP_OPEN=1). */
export const modeOpen = (m: Mode) => m === 'solo' || process.env.SURVIVAL_COOP_OPEN === '1'

/** The Otherside Hub's FeeSplitter — a payment it forwarded had the Hub's fee taken first. */
export const HUB_FEE_SPLITTER = '0x8e756ca736da338d78c436c47a41ac18ce72cf63'

/** The cashier contract; '' until it is deployed and configured. */
export const CASHIER = (process.env.SURVIVAL_CASHIER ?? process.env.NEXT_PUBLIC_SURVIVAL_CASHIER ?? '').toLowerCase()

/** keccak256("pay(address,bytes32,uint8)")[:4] */
const PAY_SELECTOR = '0xcaa26fb3'
/** keccak256("Paid(address,bytes32,address,uint8,uint256,uint256)") */
export const PAID_TOPIC = '0xc3c0f3fe0b4ba1a78b393b5d695a6a32a0e7a74b2d805f4fef4eb23a9eef7eca'

// The site compiles to ES2017: no bigint literals, BigInt() instead.
const MICRO = BigInt(10) ** BigInt(12)
export const apeToWei = (ape: number): bigint => BigInt(Math.round(ape * 1e6)) * MICRO
export const weiToApe = (wei: bigint): number => Number(wei / MICRO) / 1e6

/** An order's uuid as the bytes32 the contract carries: the 16 bytes, left-aligned. */
export const orderRef = (orderId: string): string => `0x${orderId.replace(/-/g, '').toLowerCase().padEnd(64, '0')}`

/** The order uuid back from the bytes32 in an event. */
export const orderIdFromRef = (ref: string): string => {
    const h = ref.replace(/^0x/, '').slice(0, 32)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

const word = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')

/** Calldata for `pay(player, orderRef(orderId), mode)`. */
export function encodePay(player: string, orderId: string, mode: Mode): string {
    return `${PAY_SELECTOR}${word(player)}${word(orderRef(orderId))}${word(MODE_ID[mode].toString(16))}`
}

export type PaidEvent = { player: string; order: string; payer: string; mode: Mode | null; amount: bigint; toPool: bigint; logIndex: number; blockNumber: bigint }

type Log = { address: string; topics: readonly string[]; data: string; logIndex?: number | bigint | null; blockNumber?: bigint | null }

/** Every Paid event the cashier emitted in these logs. */
export function paidEvents(logs: readonly Log[]): PaidEvent[] {
    const out: PaidEvent[] = []
    for (const l of logs) {
        if (!CASHIER || l.address.toLowerCase() !== CASHIER) continue
        if ((l.topics[0] ?? '').toLowerCase() !== PAID_TOPIC || l.topics.length !== 4) continue
        const data = l.data.replace(/^0x/, '')
        if (data.length !== 192) continue
        const m = Number(BigInt(`0x${data.slice(0, 64)}`))
        out.push({
            player: `0x${l.topics[1].slice(-40)}`.toLowerCase(),
            order: l.topics[2].toLowerCase(),
            payer: `0x${l.topics[3].slice(-40)}`.toLowerCase(),
            mode: m === 0 ? 'solo' : m === 1 ? 'coop' : null,
            amount: BigInt(`0x${data.slice(64, 128)}`),
            toPool: BigInt(`0x${data.slice(128, 192)}`),
            logIndex: Number(l.logIndex ?? 0),
            blockNumber: BigInt(l.blockNumber ?? 0),
        })
    }
    return out
}

export function describe(item: CatalogItem, mode: Mode): string {
    const m = mode === 'coop' ? 'co-op' : 'solo'
    return `Droidz Survival — ${item.title} (${m}) for ${item.price_ape} APE. Half goes to the ${m} season prize pool.`
}
