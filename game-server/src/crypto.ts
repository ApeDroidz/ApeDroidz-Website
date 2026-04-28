import { createHmac, createHash, randomBytes } from 'crypto'

export function generateServerSeed(): string {
    return randomBytes(32).toString('hex')
}

export function hashServerSeed(seed: string): string {
    return createHash('sha256').update(seed).digest('hex')
}

// ── Env-driven cap tiers ──────────────────────────────────────────────────────
// Tiers can be lowered when the bank is small to keep payouts inside vault
// liquidity. CAP_TIER_3 should be ≥ CAP_TIER_2 ≥ CAP_TIER_1, and the highest
// tier must match CRASH_CAP_MAX in gameLoop.ts so the protection math stays
// honest.
//
// Defaults restore the previous behaviour (47.4 / 56.2 / 65.51).
const CAP_TIER_1 = parseFloat(process.env.CRASH_CAP_TIER_1 ?? '47.4')
const CAP_TIER_2 = parseFloat(process.env.CRASH_CAP_TIER_2 ?? '56.2')
const CAP_TIER_3 = parseFloat(process.env.CRASH_CAP_TIER_3 ?? '65.51')
const CAP_TIER_2_PCT = parseInt(process.env.CRASH_CAP_TIER_2_PCT ?? '70', 10)   // P(bucket = TIER_1)
const CAP_TIER_3_PCT = parseInt(process.env.CRASH_CAP_TIER_3_PCT ?? '92', 10)   // cumulative P(bucket ≤ TIER_2)

/**
 * Provably fair crash point with multi-tier cap.
 *
 * Cap tiers (applied when raw > CAP_TIER_1):
 *   <CAP_TIER_2_PCT>%             → CAP_TIER_1   (most common ceiling)
 *   <CAP_TIER_3_PCT − …>%         → CAP_TIER_2
 *   remainder                     → CAP_TIER_3
 *
 * Defaults: 70% → 47.4x, 22% → 56.2x, 8% → 65.51x.
 *
 * Tweaked at deploy time via env so a fresh deploy with a small vault can
 * launch with much shorter ceilings (e.g. 8/12/15) without redeploying code.
 */
export function computeCrashPoint(serverSeed: string): number {
    const houseEdge = parseFloat(process.env.HOUSE_EDGE ?? '0.1')

    const hmac = createHmac('sha256', serverSeed).update('crash').digest('hex')
    const h    = parseInt(hmac.slice(0, 8), 16)
    const e    = Math.pow(2, 32)

    // Primary house edge — % of rounds instant-crash at 1.00x
    if (h % Math.round(1 / houseEdge) === 0) return 1.00

    const raw  = Math.floor((100 * e - h) / (e - h)) / 100
    const base = Math.max(1.00, raw)

    // Multi-tier cap — prevents extreme outliers, keeps top end varied.
    // Uses second HMAC slice so tier selection is also provably fair.
    if (base <= CAP_TIER_1) return base

    const capRoll = parseInt(hmac.slice(8, 16), 16) % 100
    if (capRoll < CAP_TIER_2_PCT) return CAP_TIER_1
    if (capRoll < CAP_TIER_3_PCT) return CAP_TIER_2
    return CAP_TIER_3
}
