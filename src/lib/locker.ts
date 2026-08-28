/**
 * Locker — permanent locking of ApeDroidz in exchange for Gnanas freemints.
 *
 * Shared between the page, the API routes and the admin reporting so the multiplier table and
 * the freemint arithmetic exist in exactly one place. Every number here is an integer: the
 * multiplier is stored as hundredths (100 / 110 / 150) precisely so a payout figure can never
 * pick up a floating-point rounding error on its way to a holder.
 */

/** Raw JSON-RPC endpoint, used for the direct `eth_call` / log reads this module needs. */
export const APECHAIN_RPC_URL = process.env.APECHAIN_RPC_URL || 'https://rpc.apechain.com/http'

export const DROID_CONTRACT = (process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || '').toLowerCase()

/** DroidLockRegistry. Empty until the contract is deployed — the UI degrades to a notice. */
export const LOCK_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_LOCK_REGISTRY_ADDRESS || '').toLowerCase()

/** keccak256("I UNDERSTAND THIS LOCK IS PERMANENT AND CAN NEVER BE UNDONE") */
export const LOCK_ACKNOWLEDGEMENT = '0x261425bacc8de9eeb501208930e4874450a408e7d64c87f77069bd6cab55a12d'

// ── multipliers ──────────────────────────────────────────────────────────────────────────────

export type DroidTier = 'lvl1' | 'lvl2' | 'lvl2super'

export const TIER_MULTIPLIER_X100: Record<DroidTier, number> = {
    lvl1: 100,
    lvl2: 110,
    lvl2super: 150,
}

export const TIER_LABEL: Record<DroidTier, string> = {
    lvl1: 'Droid',
    lvl2: 'Level 2',
    lvl2super: 'Level 2 Super',
}

/**
 * Mirrors the level/super detection the inventory filter already uses.
 *
 * Note on provenance: a droid's level is **not** chain state. It lives in `droidz.level` /
 * `is_super`, the token's metadata is served from our own API, and nothing on-chain records which
 * droid a burned battery upgraded. The lock is unforgeable; the multiplier applied to it is our
 * own bookkeeping, which is why `locker_locks.multiplier_x100` is snapshotted and frozen at lock
 * time rather than recomputed later.
 */
export function tierOf(droid: { level?: number | null; is_super?: boolean | null }): DroidTier {
    const level = droid.level ?? 1
    if (level >= 2 && droid.is_super) return 'lvl2super'
    if (level >= 2) return 'lvl2'
    return 'lvl1'
}

export function multiplierX100Of(droid: { level?: number | null; is_super?: boolean | null }): number {
    return TIER_MULTIPLIER_X100[tierOf(droid)]
}

export const formatMultiplier = (x100: number) => `${(x100 / 100).toFixed(x100 % 100 === 0 ? 0 : 1)}x`

// ── freemint arithmetic ──────────────────────────────────────────────────────────────────────

/**
 * Freemints are the floor of the wallet's **lifetime** point total, not of one batch.
 *
 * This is the only variant that cannot be gamed. Round each batch separately and a holder with
 * two Supers earns 2 + 2 = 4 by locking them one at a time versus 3 together, so splitting pays.
 * Flooring the running total makes batching irrelevant, and the leftover fraction is never
 * burned — it sits on the account and counts toward the next lock.
 */
export const freemintsFromPoints = (pointsX100: number) => Math.floor(pointsX100 / 100)

/** What a given set of droids would add, and what the wallet would hold afterwards. */
export function projectLock(existingPointsX100: number, droids: Array<{ level?: number | null; is_super?: boolean | null }>) {
    const addedPointsX100 = droids.reduce((sum, d) => sum + multiplierX100Of(d), 0)
    const totalPointsX100 = existingPointsX100 + addedPointsX100
    const freemintsBefore = freemintsFromPoints(existingPointsX100)
    const freemintsAfter = freemintsFromPoints(totalPointsX100)

    return {
        addedPointsX100,
        totalPointsX100,
        freemintsBefore,
        freemintsAfter,
        freemintsGained: freemintsAfter - freemintsBefore,
        /** Fraction carried to the next lock, in hundredths (0–99). */
        remainderX100: totalPointsX100 % 100,
    }
}

// ── minimal JSON-RPC helpers ─────────────────────────────────────────────────────────────────

export async function rpcCall<T = string>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(APECHAIN_RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        cache: 'no-store',
    })
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`)
    const json = await res.json()
    if (json.error) throw new Error(`RPC ${method}: ${json.error.message || JSON.stringify(json.error)}`)
    return json.result as T
}

const padAddress = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0')
const padUint = (n: number | bigint) => BigInt(n).toString(16).padStart(64, '0')
const addressFromWord = (word: string) => '0x' + word.slice(-40).toLowerCase()

/**
 * Selectors and topics, precomputed with `cast sig` / `cast keccak` so nothing has to hash at
 * runtime. Regenerate with, e.g., `cast sig "lockOf(uint256)"` if a signature ever changes.
 */
export const LOCK_OF_SELECTOR = '632a4861' // lockOf(uint256)
export const IS_LOCKED_SELECTOR = 'f6aacfb1' // isLocked(uint256)
export const LOCK_FOREVER_SELECTOR = 'f6d9c7c4' // lockForever(uint256,bytes32)
export const LOCK_FOREVER_BATCH_SELECTOR = 'abd0d01e' // lockForeverBatch(uint256[],bytes32)

/** ApprovalForAll(address indexed owner, address indexed operator, bool approved) */
export const APPROVAL_FOR_ALL_TOPIC = '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31'

/** DroidLockedForever(uint256 indexed tokenId, address indexed owner, uint64 lockedAt) */
export const DROID_LOCKED_TOPIC = '0x40278ffa75ef9788ede28ab591847bfba4aa14e89861e0c88b15ee8b4e9b2487'

/**
 * `lockOf(uint256)` returns the struct {address owner, uint64 lockedAt}. We only need those two
 * fields and encoding one uint256 argument is trivial, so the call is assembled by hand rather
 * than pulling in a full ABI coder.
 *
 * Returns null when the token was never locked — the registry leaves `owner` as the zero address.
 */
export async function readLock(tokenId: number): Promise<{ owner: string; lockedAt: number } | null> {
    if (!LOCK_REGISTRY_ADDRESS) return null

    const data = '0x' + LOCK_OF_SELECTOR + padUint(tokenId)
    const result = await rpcCall<string>('eth_call', [{ to: LOCK_REGISTRY_ADDRESS, data }, 'latest'])
    if (!result || result === '0x') return null

    const words: string[] = result.slice(2).match(/.{64}/g) || []
    if (words.length < 2) return null

    const owner = addressFromWord(words[0]!)
    if (/^0x0{40}$/.test(owner)) return null
    return { owner, lockedAt: Number(BigInt('0x' + words[1]!)) }
}

/**
 * Every operator this wallet has ever approved for the droid collection, filtered down to those
 * still active right now.
 *
 * Read from `ApprovalForAll` logs rather than from any marketplace API, which is what makes the
 * pre-lock check complete: it catches venues we have never integrated with — including ones that
 * do not exist yet — because every one of them needs this approval to move a droid.
 */
export async function activeOperatorsFor(wallet: string): Promise<string[]> {
    if (!DROID_CONTRACT) return []

    const logs = await rpcCall<Array<{ topics: string[] }>>('eth_getLogs', [{
        address: DROID_CONTRACT,
        topics: [APPROVAL_FOR_ALL_TOPIC, '0x' + padAddress(wallet)],
        fromBlock: '0x0',
        toBlock: 'latest',
    }])

    const seen = new Set<string>()
    for (const log of logs || []) {
        if (log.topics?.[2]) seen.add(addressFromWord(log.topics[2]))
    }
    if (seen.size === 0) return []

    // isApprovedForAll(address,address) = 0xe985e9c5
    const active: string[] = []
    for (const operator of seen) {
        const data = '0xe985e9c5' + padAddress(wallet) + padAddress(operator)
        try {
            const res = await rpcCall<string>('eth_call', [{ to: DROID_CONTRACT, data }, 'latest'])
            if (res && BigInt(res) === BigInt(1)) active.push(operator)
        } catch {
            // A failed read must not silently look like "no approval" — surface it as still
            // approved so the UI errs toward asking the holder to revoke.
            active.push(operator)
        }
    }
    return active
}

/** Human labels for the operators seen on ApeDroidz so far, for a friendlier revoke list. */
export const KNOWN_OPERATORS: Record<string, string> = {
    '0x1e0049783f008a0085193e00003d00cd54003c71': 'OpenSea',
    '0x2052f8a2ff46283b30084e5d84c89a2fdbe7f74b': 'OpenSea (legacy conduit)',
    '0x9a1d00000000fc540e2000560054812452eb5366': 'PaymentProcessor (Magic Eden and others)',
}

export const operatorLabel = (address: string) =>
    KNOWN_OPERATORS[address.toLowerCase()] || `${address.slice(0, 6)}…${address.slice(-4)}`
