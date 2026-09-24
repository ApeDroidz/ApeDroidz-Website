/**
 * How many ApeDroidz a wallet holds — thirdweb Insight, like the rest of the site (no RPC quota, no
 * domain allowlist; see /api/owned-droids). The `droidz` table cannot answer this: its owner column
 * is empty, it is a metadata showcase, not an ownership registry.
 *
 * Used by the panel's beta list and by the shop: the season pass is 30% off for a holder (owner,
 * 25.09.2026: «с дроидом скидка 30%»). Cached for ten minutes per wallet — the price list is read
 * on every visit to the game, and a holder does not stop being one between two screens.
 *
 * null = the indexer did not answer. That is NOT «no droids»: the shop then charges the full price
 * and the panel shows «?».
 */

const DROID_CONTRACT = (process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || '').toLowerCase()
const CHAIN_ID = 33139 // ApeChain
const CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || ''
const SECRET_KEY = process.env.THIRDWEB_SECRET_KEY || ''
const INSIGHT_BASE = 'https://insight.thirdweb.com/v1/nfts'
/** «Holder or not» is the question, not «how many»: a hundred is plenty. */
const PAGE = 100
const TTL_MS = 10 * 60_000

const cache = new Map<string, { n: number; at: number }>()

export async function droidCount(wallet: string): Promise<number | null> {
    const w = wallet.toLowerCase()
    const hit = cache.get(w)
    if (hit && Date.now() - hit.at < TTL_MS) return hit.n
    if (!DROID_CONTRACT) return null
    const headers: Record<string, string> = SECRET_KEY
        ? { 'x-secret-key': SECRET_KEY }
        : { 'x-client-id': CLIENT_ID, 'Origin': 'https://apedroidz.com' }
    try {
        const url = `${INSIGHT_BASE}?chain=${CHAIN_ID}&owner_address=${w}&contract_address=${DROID_CONTRACT}&limit=${PAGE}&page=0`
        const res = await fetch(url, { headers, cache: 'no-store' })
        if (!res.ok) return null
        const json = await res.json()
        const n = Array.isArray(json?.data) ? json.data.length : 0
        cache.set(w, { n, at: Date.now() })
        return n
    } catch {
        return null
    }
}

export const isDroidHolder = async (wallet: string): Promise<boolean> => ((await droidCount(wallet)) ?? 0) > 0
