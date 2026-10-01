/**
 * Admin auth for the maintenance gate.
 *
 * The middleware that fronts every request runs in the Edge runtime, which
 * does NOT have Node's `crypto.createHmac` or `Buffer`. So this module uses
 * Web Crypto + plain string utilities — works in both Edge middleware AND
 * Node API routes without conditional imports.
 *
 * Token format (HMAC-SHA256-signed cookie):
 *   <base64url(payload)>.<base64url(HMAC(adminKey, payload))>
 *   payload = JSON { typ: 'admin', v: string, iat: number(ms), exp: number(ms) }
 *
 * The player cookies (glitch_session, survival_play) have the same
 * <payload>.<sig> shape and, without ADMIN_SESSION_SECRET, the same base
 * secret. Two things keep them from ever passing as an admin token:
 *   - adminKey is not the raw secret but HMAC(secret, 'admin-session-v1'),
 *     so a player cookie's signature never verifies here;
 *   - the payload must carry typ:'admin' and the current version.
 * Still, set a separate ADMIN_SESSION_SECRET (≥32 chars) in production.
 *
 * Revoking: the token is stateless and logout only clears the cookie in the
 * browser. To kill EVERY admin session (e.g. a cookie leaked), change
 * ADMIN_SESSION_VERSION in Vercel (any new string, default '1') and redeploy.
 * Players are not logged out by this.
 */

export const ADMIN_COOKIE_NAME = 'ag_admin'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours
const TOKEN_TYPE = 'admin'
const KEY_CONTEXT = 'admin-session-v1'
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

function getBaseSecret(): string | null {
    // Prefer a dedicated ADMIN_SESSION_SECRET; falls back to the wallet session secret.
    const s = process.env.ADMIN_SESSION_SECRET ?? process.env.WALLET_SESSION_SECRET
    return typeof s === 'string' && s.length >= 32 ? s : null
}

/**
 * The key admin tokens are signed with: derived from the base secret, never the
 * base secret itself, so tokens signed by walletAuth / survivalAccess with the
 * same WALLET_SESSION_SECRET can't verify as admin.
 */
async function getAdminKey(): Promise<string | null> {
    const base = getBaseSecret()
    if (!base) return null
    return hmacSha256(base, KEY_CONTEXT)
}

/** Bump ADMIN_SESSION_VERSION to invalidate every issued admin cookie. */
function adminVersion(): string {
    const v = process.env.ADMIN_SESSION_VERSION
    return typeof v === 'string' && v.trim() ? v.trim() : '1'
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
    const key = await getAdminKey()
    if (!key) return null
    const now = Date.now()
    const payloadJson = JSON.stringify({ typ: TOKEN_TYPE, v: adminVersion(), iat: now, exp: now + SESSION_TTL_MS })
    const payload = bytesToBase64Url(new TextEncoder().encode(payloadJson))
    const sig = await hmacSha256(key, payload)
    return `${payload}.${sig}`
}

/**
 * True iff the token is well-formed, signed with the admin key, typed as an
 * admin token of the current version, and not expired.
 */
export async function isAdminTokenValid(token: string | null | undefined): Promise<boolean> {
    if (!token || typeof token !== 'string') return false
    let key: string | null
    try {
        key = await getAdminKey()
    } catch {
        return false
    }
    if (!key) return false

    const parts = token.split('.')
    if (parts.length !== 2) return false
    const [payload, providedSig] = parts
    if (!payload || !providedSig) return false

    let expected: string
    try {
        expected = await hmacSha256(key, payload)
    } catch {
        return false
    }
    if (!timingSafeStrEq(providedSig, expected)) return false

    try {
        const json = new TextDecoder().decode(base64UrlToBytes(payload))
        const obj = JSON.parse(json) as Record<string, unknown> | null
        if (!obj || typeof obj !== 'object') return false
        // Player tokens carry a wallet — never an admin.
        if ('wallet' in obj || 'w' in obj) return false
        if (obj.typ !== TOKEN_TYPE || obj.v !== adminVersion()) return false
        const { iat, exp } = obj
        return typeof iat === 'number' && typeof exp === 'number' &&
            exp > Date.now() && exp - iat <= SESSION_TTL_MS
    } catch {
        return false
    }
}

/** True iff the maintenance gate should run. Default: ON. Set MAINTENANCE_MODE=0 to disable. */
export function isMaintenanceModeEnabled(): boolean {
    return process.env.MAINTENANCE_MODE !== '0'
}

// ── API route guard ───────────────────────────────────────────────────────────

/**
 * Same shape as `requireWalletAuth`: returns a `Response` to bail with, or
 * `null` to continue. Use at the top of every /api/admin/* route handler.
 *
 *   const denied = await requireAdmin(req)
 *   if (denied) return denied
 */
export async function requireAdmin(req: Request): Promise<Response | null> {
    const cookieHeader = req.headers.get('cookie') ?? ''
    const re = new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE_NAME}=([^;]+)`)
    const match = cookieHeader.match(re)
    const token = match ? decodeURIComponent(match[1]) : null
    const ok = await isAdminTokenValid(token)
    if (!ok) {
        return new Response(JSON.stringify({ error: 'Admin authentication required' }), {
            status: 401,
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        })
    }
    return null
}
