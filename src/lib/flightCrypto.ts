import { createHmac, createHash, randomBytes } from 'crypto'

/**
 * Provably fair crash point calculation.
 * Same algorithm used in open-source crash games.
 *
 * Formula: crash = max(1.00, e^(h / 2^52)) where h = first 8 bytes of HMAC-SHA256(serverSeed)
 * House edge is baked into HOUSE_EDGE env var.
 */
export function generateServerSeed(): string {
    return randomBytes(32).toString('hex')
}

export function hashServerSeed(serverSeed: string): string {
    return createHash('sha256').update(serverSeed).digest('hex')
}

export function computeCrashPoint(serverSeed: string): number {
    const houseEdge = parseFloat(process.env.HOUSE_EDGE ?? '0.1')

    const hmac = createHmac('sha256', serverSeed).update('crash').digest('hex')
    // Take the first 8 hex chars → 32-bit unsigned int
    const h = parseInt(hmac.slice(0, 8), 16)
    const e = Math.pow(2, 32)

    // Apply house edge: if h < edge bucket → instant crash at 1.00
    if (h % Math.round(1 / houseEdge) === 0) return 1.00

    // Otherwise: crash = e^(h / 2^32) scaled to a reasonable range
    // We use a simple formula that gives a nice distribution
    const raw = Math.floor((100 * e - h) / (e - h)) / 100
    return Math.max(1.00, raw)
}
