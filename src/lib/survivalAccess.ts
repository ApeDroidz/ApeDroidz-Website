/**
 * Beta access gate for Droidz Survival.
 *
 * The game ships as a static Phaser build under /droidz_survival/play. Only wallets on the
 * `survival_allowlist` table may load it, so there are two separate questions and they need two
 * different mechanisms:
 *
 *   1. "Is this really your wallet?" — answered by the existing signed session (`walletAuth.ts`,
 *      cookie `glitch_session`). Without a signature the gate is decoration: anyone could type a
 *      friend's allowlisted address.
 *
 *   2. "Is that wallet in the beta?" — one DB round trip via `survival_has_access(wallet)`. Doing
 *      that per request would mean a query for every JS chunk the game loads, so the answer is
 *      minted into a short-lived HMAC cookie (`survival_play`) and the middleware only verifies
 *      the signature. Access revoked in the table takes effect within PLAY_TTL, not instantly —
 *      that is the price of not querying Postgres for every asset, and six hours is an acceptable
 *      tail for a closed beta.
 *
 * Everything here is Web Crypto, not node:crypto, because the middleware runs on Edge — same
 * constraint and same solution as `adminAuth.ts`.
 */

export const PLAY_COOKIE_NAME = 'survival_play'
export const PLAY_PATH = '/droidz_survival'
const PLAY_TTL_MS = 6 * 60 * 60 * 1000

// ── Base64url + HMAC, Edge-safe (no Buffer, no node:crypto) ───────────────────

function bytesToBase64Url(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToString(s: string): string {
    let p = s.replace(/-/g, '+').replace(/_/g, '/')
    while (p.length % 4) p += '='
    return atob(p)
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    )
    return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload))))
}

function timingSafeStrEq(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let mismatch = 0
    for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return mismatch === 0
}

function getSecret(): string | null {
    const s = process.env.WALLET_SESSION_SECRET
    return typeof s === 'string' && s.length >= 32 ? s : null
}

// ── Play token ────────────────────────────────────────────────────────────────

/** Mint the signed play cookie for an allowlisted wallet. Null if the secret is missing. */
export async function createPlayToken(wallet: string): Promise<string | null> {
    const secret = getSecret()
    if (!secret) return null
    const payload = bytesToBase64Url(
        new TextEncoder().encode(JSON.stringify({ w: wallet.toLowerCase(), exp: Date.now() + PLAY_TTL_MS })),
    )
    return `${payload}.${await hmacSha256(secret, payload)}`
}

/** Returns the wallet the token was minted for, or null if it is absent, forged or expired. */
export async function readPlayToken(token: string | null | undefined): Promise<string | null> {
    if (!token) return null
    const secret = getSecret()
    if (!secret) return null

    const dot = token.indexOf('.')
    if (dot <= 0) return null
    const payload = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    if (!timingSafeStrEq(sig, await hmacSha256(secret, payload))) return null

    try {
        const claims = JSON.parse(base64UrlToString(payload)) as { w?: unknown; exp?: unknown }
        if (typeof claims.w !== 'string' || !/^0x[0-9a-f]{40}$/.test(claims.w)) return null
        if (typeof claims.exp !== 'number' || claims.exp < Date.now()) return null
        return claims.w
    } catch {
        return null
    }
}

export const PLAY_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    // Scoped to the game so the cookie is not sent with every request to the rest of the site.
    path: PLAY_PATH,
    maxAge: Math.floor(PLAY_TTL_MS / 1000),
}
