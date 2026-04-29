import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_COOKIE_NAME, isAdminTokenValid, isMaintenanceModeEnabled } from '@/lib/adminAuth'

/**
 * Combined middleware:
 *
 *   1. MAINTENANCE GATE — when MAINTENANCE_MODE != "0", every request needs
 *      a valid admin cookie. Pages without it are rewritten to /coming-soon
 *      and API routes return 503. Always-allowed paths: /coming-soon and
 *      its assets, /api/admin/*, /api/sys/debug.
 *
 *   2. RATE LIMITER — for /api/flight/*. Financial endpoints (/deposit,
 *      /withdraw) are keyed by wallet address (X-Wallet-Address header) so
 *      a bad actor cannot bypass by rotating IPs.
 *
 * NOTE: The hits Map is per-process. On Vercel with multiple edge instances
 * each has its own counter, so effective limits may be ~2-3x higher across
 * instances. For production scale, replace with Upstash Redis.
 */

// ── Maintenance gate config ───────────────────────────────────────────────────
// During MAINTENANCE_MODE only the public-facing site pages are gated. ALL
// `/api/*` routes stay open because:
//   • external indexers (OpenSea, Magic Eden) need /api/metadata to refresh
//     NFT metadata — blocking it pins their cache to whatever they had at
//     the moment maintenance flipped on
//   • mutation endpoints already require their own auth (wallet signature
//     or admin cookie); the maintenance gate isn't a substitute for that
//   • read endpoints (leaderboard, balance, etc.) are public anyway
//
// If you ever need to harden a specific API path during maintenance, do it
// at the route level (return 503 explicitly), not via this allow-list.

const MAINTENANCE_ALWAYS_ALLOW: Array<string | RegExp> = [
    '/coming-soon',
    /^\/api(\/|$)/,
]

function isAlwaysAllowed(pathname: string): boolean {
    for (const allowed of MAINTENANCE_ALWAYS_ALLOW) {
        if (typeof allowed === 'string') {
            if (pathname === allowed || pathname.startsWith(allowed + '/')) return true
        } else if (allowed.test(pathname)) {
            return true
        }
    }
    return false
}

// ── Rate limiter config ───────────────────────────────────────────────────────

interface Entry { count: number; reset: number }
const hits = new Map<string, Entry>()

let lastCleanup = Date.now()
function maybeCleanup() {
    if (Date.now() - lastCleanup < 60_000) return
    lastCleanup = Date.now()
    const now = Date.now()
    for (const [key, entry] of hits) {
        if (now > entry.reset) hits.delete(key)
    }
}

interface Limit { max: number; windowMs: number; keyBy?: 'ip' | 'wallet' }

const LIMITS: Record<string, Limit> = {
    '/api/flight/session/start':        { max: 60,  windowMs: 60_000 },
    '/api/flight/session/complete':     { max: 120, windowMs: 60_000 },
    '/api/flight/session/place-bet':    { max: 60,  windowMs: 60_000 },
    '/api/flight/session/cashout':      { max: 60,  windowMs: 60_000 },
    '/api/flight/session/mark-running': { max: 60,  windowMs: 60_000 },
    '/api/flight/balance':              { max: 20,  windowMs: 60_000 },
    '/api/flight/history':              { max: 20,  windowMs: 60_000 },
    '/api/flight/top-pilots':           { max: 20,  windowMs: 60_000 },
    '/api/flight/verify-ws-auth':       { max: 120, windowMs: 60_000 },
    '/api/flight/deposit':              { max: 10,  windowMs: 60_000,  keyBy: 'wallet' },
    '/api/flight/withdraw':             { max: 5,   windowMs: 60_000,  keyBy: 'wallet' },
}

function getKey(pathname: string, req: NextRequest, limit: Limit): string {
    if (limit.keyBy === 'wallet') {
        const wallet = req.headers.get('x-wallet-address')?.toLowerCase()
        if (wallet && /^0x[0-9a-f]{40}$/.test(wallet)) {
            return `${pathname}:w:${wallet}`
        }
    }
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    return `${pathname}:ip:${ip}`
}

function rateLimit(req: NextRequest): NextResponse | null {
    const { pathname } = req.nextUrl
    const limit = LIMITS[pathname]
    if (!limit) return null

    const key = getKey(pathname, req, limit)
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || now > entry.reset) {
        hits.set(key, { count: 1, reset: now + limit.windowMs })
        return null
    }
    entry.count++
    if (entry.count > limit.max) {
        return new NextResponse(
            JSON.stringify({ error: 'Too many requests — please slow down' }),
            {
                status: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': String(Math.ceil((entry.reset - now) / 1000)),
                },
            },
        )
    }
    return null
}

// ── Main middleware ───────────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
    maybeCleanup()

    const { pathname } = req.nextUrl

    // ── 1. Maintenance gate ──────────────────────────────────────────────────
    if (isMaintenanceModeEnabled() && !isAlwaysAllowed(pathname)) {
        const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value
        const ok = await isAdminTokenValid(token)

        if (!ok) {
            if (pathname.startsWith('/api/')) {
                return new NextResponse(
                    JSON.stringify({ error: 'Site is in maintenance mode' }),
                    { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
                )
            }
            const url = req.nextUrl.clone()
            url.pathname = '/coming-soon'
            url.search = ''
            return NextResponse.rewrite(url)
        }
    }

    // ── 2. Rate limiter (passthrough if not configured for this path) ────────
    const rl = rateLimit(req)
    if (rl) return rl

    return NextResponse.next()
}

export const config = {
    // Run on every request EXCEPT static asset paths and Next internals so
    // /coming-soon (and its login form) can load fonts, JS, images, etc.
    matcher: [
        '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|mp4|mp3|MP3|webm|wav|ogg|woff|woff2|ttf|eot|ico|json|txt|map)).*)',
    ],
}
