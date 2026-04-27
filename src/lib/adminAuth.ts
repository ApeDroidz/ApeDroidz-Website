/**
 * Admin auth for the maintenance gate.
 *
 * The middleware that fronts every request runs in the Edge runtime, which
 * does NOT have Node's `crypto.createHmac` or `Buffer`. So this module uses
 * Web Crypto + plain string utilities — works in both Edge middleware AND
 * Node API routes without conditional imports.
 *
 * Token format (HMAC-SHA256-signed cookie):
 *   <base64url(payload)>.<base64url(HMAC(secret, payload))>
 *   payload = JSON { exp: number(ms) }
 */

export const ADMIN_COOKIE_NAME = 'ag_admin'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
export const ADMIN_COOKIE_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000)

// ── Base64url helpers (Edge-safe — no Buffer) ─────────────────────────────────

function bytesToBase64Url(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(s: string): Uint8Array {
    let p = s.replace(/-/g, '+').replace(/_/g, '/')
    while (p.length % 4) p += '='
    const bin = atob(p)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
    return bytesToBase64Url(new Uint8Array(sig))
}

// Constant-time string compare without Node Buffer.
function timingSafeStrEq(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let mismatch = 0
    for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return mismatch === 0
}

// ── Config ────────────────────────────────────────────────────────────────────

function getSecret(): string | null {
    // Reuse the wallet session secret; admins can override with ADMIN_SESSION_SECRET.
    const s = process.env.ADMIN_SESSION_SECRET ?? process.env.WALLET_SESSION_SECRET
    return typeof s === 'string' && s.length >= 32 ? s : null
}

/**
 * Verify admin credentials against env-supplied values.
 * Both `ADMIN_USERNAME` and `ADMIN_PASSWORD` must be set; otherwise login fails.
 */
export function verifyAdminCredentials(username: unknown, password: unknown): boolean {
    if (typeof username !== 'string' || typeof password !== 'string') return false
    const expectedU = process.env.ADMIN_USERNAME ?? ''
    const expectedP = process.env.ADMIN_PASSWORD ?? ''
    if (!expectedU || !expectedP) return false
    return timingSafeStrEq(username, expectedU) && timingSafeStrEq(password, expectedP)
}

/** Mint a signed cookie value. Returns null if the secret is missing. */
export async function createAdminToken(): Promise<string | null> {
    const secret = getSecret()
    if (!secret) return null
    const payloadJson = JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })
    const payload = bytesToBase64Url(new TextEncoder().encode(payloadJson))
    const sig = await hmacSha256(secret, payload)
    return `${payload}.${sig}`
}

/** True iff the token is well-formed, signed by our secret, and not expired. */
export async function isAdminTokenValid(token: string | null | undefined): Promise<boolean> {
    if (!token || typeof token !== 'string') return false
    const secret = getSecret()
    if (!secret) return false

    const parts = token.split('.')
    if (parts.length !== 2) return false
    const [payload, providedSig] = parts
    if (!payload || !providedSig) return false

    let expected: string
    try {
        expected = await hmacSha256(secret, payload)
    } catch {
        return false
    }
    if (!timingSafeStrEq(providedSig, expected)) return false

    try {
        const json = new TextDecoder().decode(base64UrlToBytes(payload))
        const obj = JSON.parse(json) as { exp?: unknown }
        return typeof obj.exp === 'number' && obj.exp > Date.now()
    } catch {
        return false
    }
}

/** True iff the maintenance gate should run. Default: ON. Set MAINTENANCE_MODE=0 to disable. */
export function isMaintenanceModeEnabled(): boolean {
    return process.env.MAINTENANCE_MODE !== '0'
}
