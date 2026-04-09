import { createHmac, createHash, randomBytes } from 'crypto'

export function generateServerSeed(): string {
    return randomBytes(32).toString('hex')
}

export function hashServerSeed(seed: string): string {
    return createHash('sha256').update(seed).digest('hex')
}

/**
 * Provably fair crash point.
 * Client can verify after round: hash(serverSeed) === serverSeedHash shown before round,
 * then computeCrashPoint(serverSeed) === crash_point shown after.
 */
export function computeCrashPoint(serverSeed: string): number {
    const houseEdge = parseFloat(process.env.HOUSE_EDGE ?? '0.04')

    const hmac = createHmac('sha256', serverSeed).update('crash').digest('hex')
    const h = parseInt(hmac.slice(0, 8), 16)
    const e = Math.pow(2, 32)

    // House edge: ~4% of rounds instant crash at 1.00x
    if (h % Math.round(1 / houseEdge) === 0) return 1.00

    const raw = Math.floor((100 * e - h) / (e - h)) / 100
    return Math.max(1.00, raw)
}
