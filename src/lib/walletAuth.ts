import { createHmac, timingSafeEqual } from 'crypto'
import { createThirdwebClient, defineChain } from 'thirdweb'
import { verifySignature } from 'thirdweb/auth'
import type { NextRequest } from 'next/server'

/**
 * Wallet authentication for Glitch Games.
 *
 * Flow:
 *  1. Client calls /api/auth/login with { wallet, nonce, signature } where the
 *     signature is over `Glitch Games Login\nWallet: <addr>\nNonce: <nonce>`.
 *  2. Server verifies the EIP-191 signature, mints a stateless HMAC token,
 *     stores it in an httpOnly+secure cookie (`glitch_session`).
 *  3. Subsequent mutating endpoints call `requireWalletAuth(req)` to read
 *     the cookie. The wallet from the cookie — never from the body — is
 *     used for any state-changing operation.
 *
 * Token format:
 *   <base64url(payload)>.<base64url(HMAC_SHA256(payload, secret))>
 *   payload = JSON { wallet, iat, exp }
 *
 * Lifetime: 24h. On wallet switch / logout, /api/auth/logout clears the cookie.
 */

const SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const SESSION_COOKIE_NAME = 'glitch_session'

const apeChain = defineChain(33139)
const thirdwebClient = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
})

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/

// ── Wallet validation ─────────────────────────────────────────────────────────

export function isValidWallet(w: unknown): w is string {
    return typeof w === 'string' && WALLET_REGEX.test(w)
}

/**
 * Throws if `w` is not a valid 0x-prefixed 40-hex address. Returns lowercased.
 * Use this BEFORE any `ilike` query — `ilike` treats `%` as a wildcard, so an
 * un-validated wallet param leaks data.
 */
export function assertWallet(w: unknown): string {
    if (!isValidWallet(w)) {
        throw new Error('Invalid wallet address')
    }
    return w.toLowerCase()
}

// ── Session token (stateless HMAC) ────────────────────────────────────────────

function ensureSecret(): string {
    const s = process.env.WALLET_SESSION_SECRET
    if (!s || s.length < 32) {
        throw new Error('WALLET_SESSION_SECRET not configured (>=32 chars required)')
    }
    return s
}

function b64urlEncode(buf: Buffer): string {
    return buf.toString('base64url')
}

function b64urlDecode(s: string): Buffer {
    return Buffer.from(s, 'base64url')
}

function signPayload(payload: string): string {
    return createHmac('sha256', ensureSecret()).update(payload).digest('base64url')
}

export interface WalletSession {
    wallet: string  // lowercase, validated
    iat: number     // ms
    exp: number     // ms
}

export function createSessionToken(wallet: string): { token: string; session: WalletSession } {
    const w = assertWallet(wallet)
    const session: WalletSession = {
        wallet: w,
        iat: Date.now(),
        exp: Date.now() + SESSION_TTL_MS,
    }
    const payload = b64urlEncode(Buffer.from(JSON.stringify(session), 'utf8'))
    const sig = signPayload(payload)
    return { token: `${payload}.${sig}`, session }
}

export function parseSessionToken(token: string | null | undefined): WalletSession | null {
    if (!token || typeof token !== 'string') return null
    const parts = token.split('.')
    if (parts.length !== 2) return null
    const [payload, providedSig] = parts
    if (!payload || !providedSig) return null

    // Wrap the whole verification — if the env secret is missing, signPayload
    // throws. Treating that as "invalid session" is safer than 500-ing the
    // route. The /api/auth/login route still surfaces the misconfiguration
    // explicitly via its try/catch.
    let expectedSig: string
    try {
        expectedSig = signPayload(payload)
    } catch {
        return null
    }

    const a = Buffer.from(providedSig, 'utf8')
    const b = Buffer.from(expectedSig, 'utf8')
    if (a.length !== b.length) return null
    let match = false
    try {
        match = timingSafeEqual(a, b)
    } catch {
        return null
    }
    if (!match) return null

    try {
        const session = JSON.parse(b64urlDecode(payload).toString('utf8')) as Partial<WalletSession>
        if (
            typeof session.wallet !== 'string' ||
            !WALLET_REGEX.test(session.wallet) ||
            typeof session.exp !== 'number' ||
            typeof session.iat !== 'number'
        ) return null
        if (session.exp < Date.now()) return null
        return { wallet: session.wallet.toLowerCase(), iat: session.iat, exp: session.exp }
    } catch {
        return null
    }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

export const SESSION_COOKIE_OPTIONS = {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
}

function readCookieFromHeader(req: Request | NextRequest): string | null {
    const cookieHeader = req.headers.get('cookie') ?? ''
    if (!cookieHeader) return null
    // Allow other cookies before/after ours.
    const re = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`)
    const match = cookieHeader.match(re)
    return match ? decodeURIComponent(match[1]) : null
}

export function readSessionFromRequest(req: Request | NextRequest): WalletSession | null {
    const token = readCookieFromHeader(req)
    return parseSessionToken(token)
}

// ── API guards ────────────────────────────────────────────────────────────────

export interface AuthedWallet {
    wallet: string  // lowercase, validated
    session: WalletSession
}

/**
 * Returns the authenticated wallet, or a `Response` to be returned by the route.
 *
 * Usage:
 *   const auth = requireWalletAuth(req)
 *   if (auth instanceof Response) return auth
 *   const { wallet } = auth
 */
export function requireWalletAuth(req: Request | NextRequest): AuthedWallet | Response {
    const session = readSessionFromRequest(req)
    if (!session) {
        return Response.json({ error: 'Authentication required — please sign in' }, { status: 401 })
    }
    return { wallet: session.wallet, session }
}

/**
 * Same as requireWalletAuth, but also enforces that a body-supplied wallet
 * matches the session wallet. Use when accepting an `address`/`wallet` field
 * to surface mismatches early (otherwise ignore the body and use session).
 */
export function requireWalletAuthMatch(
    req: Request | NextRequest,
    bodyWallet: unknown,
): AuthedWallet | Response {
    const auth = requireWalletAuth(req)
    if (auth instanceof Response) return auth
    if (typeof bodyWallet === 'string' && bodyWallet.length > 0) {
        if (!isValidWallet(bodyWallet) || bodyWallet.toLowerCase() !== auth.wallet) {
            return Response.json({ error: 'Wallet mismatch — please re-authenticate' }, { status: 403 })
        }
    }
    return auth
}

// ── EIP-191 signature verify ──────────────────────────────────────────────────

/**
 * Verify a wallet's EIP-191 signature for an arbitrary message.
 * Uses thirdweb's verifySignature which supports both EOA and ERC-1271 (smart
 * accounts).
 */
export async function verifyWalletSignature(opts: {
    wallet: string
    message: string
    signature: string
}): Promise<boolean> {
    if (!isValidWallet(opts.wallet)) return false
    if (!opts.signature || typeof opts.signature !== 'string') return false
    if (!opts.message || typeof opts.message !== 'string') return false
    try {
        return await verifySignature({
            client: thirdwebClient,
            chain: apeChain,
            address: opts.wallet,
            message: opts.message,
            signature: opts.signature,
        })
    } catch {
        return false
    }
}

/**
 * Login challenge message — single source of truth so client + server agree.
 */
export function loginMessage(wallet: string, nonce: string): string {
    return `Glitch Games Login\nWallet: ${wallet.toLowerCase()}\nNonce: ${nonce}`
}

/**
 * Validate a "{ts}.{rand}" nonce: timestamp within ±5min of now,
 * total length capped to prevent abuse.
 */
export function isFreshNonce(nonce: unknown): boolean {
    if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > 200) return false
    const tsStr = nonce.split('.')[0]
    const ts = parseInt(tsStr, 10)
    if (!Number.isFinite(ts)) return false
    const now = Date.now()
    // Reject nonces older than 5 minutes or more than 60s in the future.
    if (now - ts > 5 * 60 * 1000) return false
    if (ts - now > 60 * 1000) return false
    return true
}
