import { createHmac, createHash, randomBytes } from 'crypto'

export function generateServerSeed(): string {
    return randomBytes(32).toString('hex')
}

export function hashServerSeed(seed: string): string {
    return createHash('sha256').update(seed).digest('hex')
}

/**
 * Provably fair crash point with multi-tier cap.
 *
 * Client can verify after round:
 *   1. hash(serverSeed) === serverSeedHash shown before round
 *   2. computeCrashPoint(serverSeed) === crash_point shown after
 *
 * Cap tiers (applied when raw > 47.4x):
 *   70% → 47.4x  (most common ceiling)
 *   22% → 56.2x  (medium ceiling)
 *    8% → 65.51x (rare ceiling)
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

    // Multi-tier cap — prevents extreme outliers, keeps top end varied
    // Uses second HMAC slice so tier selection is also provably fair
    if (base <= 47.4) return base

    const capRoll = parseInt(hmac.slice(8, 16), 16) % 100
    if (capRoll < 70) return 47.4    // 70% of capped rounds → most common ceiling
    if (capRoll < 92) return 56.2    // 22% → medium ceiling
    return 65.51                     //  8% → rare ceiling
}

