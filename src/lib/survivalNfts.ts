import { APECHAIN_RPC_URL } from '@/lib/apechain'

/**
 * A wallet's NFTs on ApeChain, any collection — for the Droidz Survival profile's avatar picker
 * (owner, 03.10.2026: «аватар — любая NFT из кошелька»). Read from thirdweb Insight, the indexer
 * the site already uses for droids (/api/owned-droids, lib/droidHolder.ts): no RPC quota, and the
 * server sends a fixed allowlisted origin (or THIRDWEB_SECRET_KEY when set).
 *
 * Insight resolves most metadata itself (name, image_url through its IPFS gateway); about a quarter
 * of the tokens come without an image (metadata it never fetched) — those are left out of the
 * picker: an avatar is a picture. `token_id=` is NOT a filter Insight honours (checked 03.10: it
 * answers the wallet's other token), so ownership of one token is found by paging the wallet's
 * tokens of that contract, and confirmed on chain (ownerOf / ERC-1155 balanceOf) when the indexer
 * has not caught up yet.
 */

const CHAIN_ID = 33139
const INSIGHT = 'https://insight.thirdweb.com/v1/nfts'
const CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || ''
const SECRET_KEY = process.env.THIRDWEB_SECRET_KEY || ''
const DROID_CONTRACT = (process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || '').toLowerCase()
const PAGE = 100
export const MAX_NFTS = 200
const LIST_TTL_MS = 60_000

export interface WalletNft {
    contract: string
    tokenId: string
    name: string
    image: string
    collection: string | null
}

/** What is stored in survival_players.avatar and handed to the game and the board. */
export interface Avatar {
    contract: string
    tokenId: string
    name: string
    image: string
}

export const CONTRACT_RE = /^0x[0-9a-f]{40}$/
export const TOKEN_ID_RE = /^\d{1,78}$/

const headers = (): Record<string, string> => (SECRET_KEY
    ? { 'x-secret-key': SECRET_KEY }
    : { 'x-client-id': CLIENT_ID, 'Origin': 'https://apedroidz.com' })

/** A token id as a canonical decimal string (no leading zeros), or null. */
export function normTokenId(v: unknown): string | null {
    const s = typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : typeof v === 'string' ? v.trim() : ''
    if (!TOKEN_ID_RE.test(s)) return null
    try { return BigInt(s).toString() } catch { return null }
}

/**
 * An image URL a browser can load: http(s) as is, ipfs:// and ar:// through public gateways.
 * Anything else (data:, an inline SVG, javascript:) — null.
 */
export function imageUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null
    const u = raw.trim()
    if (!u || u.length > 1000) return null
    if (u.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${u.slice(7).replace(/^ipfs\//, '')}`
    if (u.startsWith('ar://')) return `https://arweave.net/${u.slice(5)}`
    if (/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u.replace(/^http:\/\//i, 'https://')
    return null
}

type InsightNft = {
    contract_address?: string; token_id?: string; name?: string | null; image_url?: string | null
    collection?: { name?: string | null } | null; contract?: { name?: string | null } | null
}

function toNft(row: InsightNft): WalletNft | null {
    const contract = String(row.contract_address ?? '').toLowerCase()
    const tokenId = normTokenId(row.token_id)
    const image = imageUrl(row.image_url)
    if (!CONTRACT_RE.test(contract) || !tokenId || !image) return null
    const collection = (row.collection?.name || row.contract?.name || '').trim().slice(0, 80) || null
    const shortId = tokenId.length > 12 ? `${tokenId.slice(0, 6)}…${tokenId.slice(-4)}` : tokenId
    const name = (typeof row.name === 'string' && row.name.trim() ? row.name.trim() : `${collection ?? 'NFT'} #${shortId}`).slice(0, 80)
    return { contract, tokenId, name, image, collection }
}

/**
 * One page of Insight. Its latency swings (0.3–18 s measured 03.10, worst on an empty or exhausted
 * page), so the picker waits long, and the ownership check short — the chain backs it up.
 */
async function insightPage(params: string, timeoutMs: number): Promise<InsightNft[] | null> {
    try {
        const res = await fetch(`${INSIGHT}?chain=${CHAIN_ID}&${params}`, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
        if (!res.ok) {
            console.error('[survival/nfts] insight', res.status, (await res.text().catch(() => '')).slice(0, 200))
            return null
        }
        const json = await res.json()
        return Array.isArray(json?.data) ? json.data as InsightNft[] : []
    } catch (e) {
        console.error('[survival/nfts] insight', (e as Error).message)
        return null
    }
}

const listMemo = new Map<string, { until: number; list: Promise<WalletNft[] | null> }>()

/**
 * Up to MAX_NFTS pictures of the wallet's NFTs, ApeDroidz first. null = the indexer did not answer
 * (not «no NFTs»). Memoized per wallet for a minute on this instance.
 */
export function listWalletNfts(wallet: string): Promise<WalletNft[] | null> {
    const w = wallet.toLowerCase()
    const now = Date.now()
    const hit = listMemo.get(w)
    if (hit && hit.until > now) return hit.list
    if (listMemo.size > 2000) for (const [k, v] of listMemo) if (v.until <= now) listMemo.delete(k)
    let partial = false
    const list = (async () => {
        // Page 0 first; a full page means more — the next two together (tokens without a picture
        // are skipped, so up to 300 tokens are read for 200 pictures). Sequential pages took 10 s.
        const first = await insightPage(`owner_address=${w}&limit=${PAGE}&page=0`, 20_000)
        if (first === null) return null
        const pages = [first]
        if (first.length === PAGE) {
            const more = await Promise.all([1, 2].map((p) => insightPage(`owner_address=${w}&limit=${PAGE}&page=${p}`, 12_000)))
            for (const m of more) { if (m === null) { partial = true; break } pages.push(m); if (m.length < PAGE) break }
        }
        const seen = new Set<string>()
        const out: WalletNft[] = []
        for (const r of pages.flat()) {
            const n = toNft(r)
            if (!n) continue
            const k = `${n.contract}:${n.tokenId}`
            if (seen.has(k)) continue
            seen.add(k); out.push(n)
        }
        const droids = out.filter((n) => n.contract === DROID_CONTRACT)
        return [...droids, ...out.filter((n) => n.contract !== DROID_CONTRACT)].slice(0, MAX_NFTS)
    })()
    listMemo.set(w, { until: now + LIST_TTL_MS, list })
    // Nothing (the indexer is down) is not kept; a list missing a page is kept for 10 s only.
    void list.then((l) => {
        if (l === null) listMemo.delete(w)
        else if (partial) { const m = listMemo.get(w); if (m?.list === list) m.until = Date.now() + 10_000 }
    })
    return list
}

// ── Ownership of one token ────────────────────────────────────────────────────

async function ethCall(to: string, data: string): Promise<string | null> {
    try {
        const res = await fetch(APECHAIN_RPC_URL, {
            method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(6000),
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
        })
        if (!res.ok) return null
        const json = await res.json()
        return typeof json?.result === 'string' ? json.result : null
    } catch {
        return null
    }
}

const word = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')

/**
 * ERC-721 ownerOf == wallet, else ERC-1155 balanceOf(wallet, id) > 0 — read on chain.
 * true / false when the chain answered, null when it did not (or the contract is neither).
 */
async function ownsOnChain(wallet: string, contract: string, tokenId: string): Promise<boolean | null> {
    const id = word(BigInt(tokenId).toString(16))
    const owner = await ethCall(contract, `0x6352211e${id}`) // ownerOf(uint256)
    if (owner && /^0x[0-9a-f]{64}$/i.test(owner)) return `0x${owner.slice(-40).toLowerCase()}` === wallet
    const bal = await ethCall(contract, `0x00fdd58e${word(wallet)}${id}`) // balanceOf(address,uint256)
    if (bal && /^0x[0-9a-f]{64}$/i.test(bal)) return BigInt(bal) > BigInt(0)
    return null
}

/** The token's name and picture from Insight's single-token read (metadata it holds). */
async function tokenMeta(contract: string, tokenId: string): Promise<WalletNft | null> {
    try {
        const res = await fetch(`${INSIGHT}/${contract}/${tokenId}?chain=${CHAIN_ID}`, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(8000) })
        if (!res.ok) return null
        const json = await res.json()
        const row = Array.isArray(json?.data) ? json.data[0] : null
        return row ? toNft({ ...row, contract_address: contract, token_id: tokenId }) : null
    } catch {
        return null
    }
}

/**
 * Does `wallet` own this token, and what does it look like?
 *   { owned: true, nft }       — owned, with a picture
 *   { owned: true, nft: null } — owned, but no picture could be found
 *   { owned: false }           — not this wallet's
 *   null                       — neither the indexer nor the chain answered
 */
export async function findOwnedNft(wallet: string, contract: string, tokenId: string): Promise<{ owned: true; nft: WalletNft | null } | { owned: false } | null> {
    const w = wallet.toLowerCase()
    const c = contract.toLowerCase()
    let indexerUp = false
    for (let page = 0; page < 5; page++) {
        const rows = await insightPage(`owner_address=${w}&contract_address=${c}&limit=${PAGE}&page=${page}`, 6000)
        if (rows === null) break
        indexerUp = true
        const row = rows.find((r) => normTokenId(r.token_id) === tokenId)
        if (row) return { owned: true, nft: toNft({ ...row, contract_address: c }) ?? await tokenMeta(c, tokenId) }
        if (rows.length < PAGE) break
    }
    // Not in the index (yet): the chain decides.
    const chain = await ownsOnChain(w, c, tokenId)
    if (chain === true) return { owned: true, nft: await tokenMeta(c, tokenId) }
    return chain === false || indexerUp ? { owned: false } : null
}

/** The stored avatar, read back defensively (it is jsonb). */
export function avatarOf(v: unknown): Avatar | null {
    if (!v || typeof v !== 'object') return null
    const a = v as Record<string, unknown>
    const contract = typeof a.contract === 'string' ? a.contract.toLowerCase() : ''
    const tokenId = normTokenId(a.tokenId)
    const image = imageUrl(a.image)
    if (!CONTRACT_RE.test(contract) || !tokenId || !image) return null
    return { contract, tokenId, name: typeof a.name === 'string' ? a.name.slice(0, 80) : '', image }
}
