/**
 * OpenSea metadata refresh — programmatic version of the "Refresh metadata"
 * button in their UI.
 *
 * OpenSea aggressively caches NFT metadata in their own infra and ignores
 * upstream Cache-Control headers. After we update a droid (level, traits,
 * image URL), the only ways to get OpenSea to re-fetch are:
 *
 *   1. ERC-4906 `MetadataUpdate(uint256)` event from the contract (best, but
 *      requires the contract to support it).
 *   2. POST to /api/v2/chain/{chain}/contract/{address}/nfts/{tokenId}/refresh
 *      with an OpenSea API key. Triggers their indexer to re-pull within
 *      seconds-to-minutes.
 *
 * This module implements (2) as a fire-and-forget side effect after our
 * upgrade route persists changes. Failures are logged but never block the
 * upgrade response — OpenSea is a downstream consumer, not the source of
 * truth for our app.
 *
 * Environment:
 *   OPENSEA_API_KEY — required. Free tier is enough for our volumes.
 *
 * Chain identifier: ApeChain → 'ape_chain' on OpenSea.
 */

const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2'
// OpenSea's chain slug for ApeChain. As of writing it's `ape_chain` but
// they sometimes ship with hyphenated/concatenated variants. If the default
// returns 404, set OPENSEA_CHAIN_SLUG to the correct value (e.g. 'apechain'
// or 'ape-chain') without redeploying.
const OPENSEA_CHAIN = (process.env.OPENSEA_CHAIN_SLUG ?? 'ape_chain').trim()

export interface OpenseaRefreshResult {
    ok: boolean
    /** HTTP status (when we got a response) */
    status?: number
    /** Raw response body, truncated. Useful for diagnosing 4xx errors. */
    body?: string
    /** Full URL we hit — useful when probing the right chain slug. */
    url?: string
    /** Error message when no response was obtained at all (timeout, DNS, …). */
    error?: string
    /** Which chain slug was used. */
    chain?: string
}

export async function refreshOpenseaNft(opts: {
    contract: string
    tokenId: number | string
    chain?: string  // override default chain slug for ad-hoc probing
}): Promise<OpenseaRefreshResult> {
    const apiKey = process.env.OPENSEA_API_KEY
    if (!apiKey) {
        return { ok: false, error: 'OPENSEA_API_KEY not configured' }
    }

    const contract = String(opts.contract).toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(contract)) {
        return { ok: false, error: 'Invalid contract address' }
    }
    const tokenId = String(opts.tokenId).trim()
    if (!/^\d+$/.test(tokenId)) {
        return { ok: false, error: 'Invalid token id' }
    }

    const chain = (opts.chain ?? OPENSEA_CHAIN).trim()
    const url = `${OPENSEA_API_BASE}/chain/${chain}/contract/${contract}/nfts/${tokenId}/refresh`
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'x-api-key': apiKey,
            },
            // Keep this tight — if OpenSea is slow, the upgrade route
            // shouldn't sit waiting on them.
            signal: AbortSignal.timeout(8000),
        })
        const body = await res.text().catch(() => '')
        return {
            ok: res.ok,
            status: res.status,
            body: body.slice(0, 400),
            url,
            chain,
        }
    } catch (e: any) {
        return { ok: false, error: e?.message ?? 'fetch failed', url, chain }
    }
}
