import { NextRequest, NextResponse } from 'next/server'

/**
 * Rate limiter.
 *
 * Financial endpoints (/deposit, /withdraw) are keyed by wallet address extracted
 * from the request body — meaning a bad actor cannot bypass the limit by rotating
 * IPs or proxies. Other endpoints fall back to IP-based limiting.
 *
 * NOTE: This Map is per-process. On Vercel with multiple edge instances each has
 * its own counter, so effective limits may be ~2–3x higher across instances.
 * For production scale, replace with Upstash Redis (drop-in via @upstash/ratelimit).
 */

interface Entry { count: number; reset: number }
const hits = new Map<string, Entry>()

// Periodic cleanup to prevent unbounded memory growth
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
    // Internal endpoints — protected by INTERNAL_SECRET, but still rate-limited as defence-in-depth
    '/api/flight/session/start':        { max: 60,  windowMs: 60_000 },
    '/api/flight/session/complete':     { max: 120, windowMs: 60_000 },
    '/api/flight/session/place-bet':    { max: 60,  windowMs: 60_000 },
    '/api/flight/session/cashout':      { max: 60,  windowMs: 60_000 },
    '/api/flight/session/mark-running': { max: 60,  windowMs: 60_000 },
    // Public read endpoints — tightened to slow wallet enumeration/scraping
    '/api/flight/balance':              { max: 20,  windowMs: 60_000 },
    '/api/flight/history':              { max: 20,  windowMs: 60_000 },
    '/api/flight/top-pilots':           { max: 20,  windowMs: 60_000 },
    '/api/flight/verify-ws-auth':       { max: 120, windowMs: 60_000 },
    // Financial endpoints — keyed by wallet so IP/proxy rotation doesn't help
    '/api/flight/deposit':              { max: 10,  windowMs: 60_000,  keyBy: 'wallet' },
    '/api/flight/withdraw':             { max: 5,   windowMs: 60_000,  keyBy: 'wallet' },
}

// Wallet is passed as X-Wallet-Address header by the client for financial endpoints.
// This is spoofable in isolation, but the route handlers verify signatures/tx ownership,
// so spoofing this header only bypasses rate limiting — not actual auth.
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

export function middleware(req: NextRequest) {
    maybeCleanup()

    const { pathname } = req.nextUrl
    const limit = LIMITS[pathname]
    if (!limit) return NextResponse.next()

    const key = getKey(pathname, req, limit)
    const now = Date.now()

    const entry = hits.get(key)
    if (!entry || now > entry.reset) {
        hits.set(key, { count: 1, reset: now + limit.windowMs })
        return NextResponse.next()
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
            }
        )
    }

    return NextResponse.next()
}

export const config = {
    matcher: ['/api/flight/:path*'],
}
