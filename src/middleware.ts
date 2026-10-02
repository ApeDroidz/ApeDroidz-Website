import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_COOKIE_NAME, isAdminTokenValid, isMaintenanceModeEnabled } from '@/lib/adminAuth'
import { PLAY_COOKIE_NAME, readPlayToken } from '@/lib/survivalAccess'

/**
 * Combined middleware:
 *
 *   1. MAINTENANCE GATE — when MAINTENANCE_MODE != "0", every request needs
 *      a valid admin cookie. Pages without it are rewritten to /coming-soon
 *      and API routes return 503. Always-allowed paths: /coming-soon and
 *      its assets, /api/admin/*, /api/sys/debug.
 *
 *   2. SURVIVAL BETA GATE — /droidz_survival/play/* (the game build itself) needs a valid
 *      `survival_play` cookie, minted by /api/survival/access for an allowlisted wallet that
 *      has signed in. Without it the request is sent back to the landing page, which explains
 *      why. The landing page itself is public — it has to be, or there is nowhere to connect.
 *
 *   3. RATE LIMITER — for /api/flight/*. Financial endpoints (/deposit,
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
    // Droidz Survival run tickets: a human starts a run every few minutes and pulses once a
    // wave. These are per-IP backstops; the per-wallet hourly cap lives in the start route.
    '/api/survival/run/start':          { max: 30,  windowMs: 60_000 },
    '/api/survival/run/pulse':          { max: 60,  windowMs: 60_000 },
    '/api/survival/run/finish':         { max: 30,  windowMs: 60_000 },
    '/api/survival/profile':            { max: 40,  windowMs: 60_000 },
    '/api/survival/log':                { max: 30,  windowMs: 60_000 },
    '/api/survival/order':              { max: 20,  windowMs: 60_000 },
    '/api/survival/pay':                { max: 40,  windowMs: 60_000 },
    '/api/survival/credits':            { max: 30,  windowMs: 60_000 },
    '/api/survival/entitlements':       { max: 30,  windowMs: 60_000 },
    '/api/survival/run/continue':       { max: 20,  windowMs: 60_000 },
    '/api/survival/economy':            { max: 60,  windowMs: 60_000 },
    '/api/survival/feedback':           { max: 10,  windowMs: 60_000 },
    '/api/otherside/login':             { max: 20,  windowMs: 60_000 },
    // The panel's password: a handful of tries a minute per IP (400 ms per wrong answer in the
    // route does not stop requests sent in parallel).
    '/api/admin/login':                 { max: 5,   windowMs: 60_000 },
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

// ── Cross-site writes (Droidz Survival, Otherside) ────────────────────────────
//
// The Otherside cabinet's cookies are SameSite=None + Partitioned (api/otherside/login): inside
// otherside.xyz the browser attaches them to requests to apedroidz.com from ANY frame under that
// top-level site — another author's experience included. Every write of the game's API is made by
// our own pages, same-origin, with a JSON body; so a write that is cross-site by Fetch Metadata, or
// by Origin where the browser sends no Fetch Metadata, or that is not JSON (a text/plain «simple»
// request skips the CORS preflight), is refused here, before any route runs.

const CSRF_GUARDED = /^\/api\/(survival|otherside)(\/|$)/
const OUR_ORIGINS = new Set(['https://www.apedroidz.com', 'https://apedroidz.com'])

function crossSite(req: NextRequest): NextResponse | null {
    const { pathname } = req.nextUrl
    if (!CSRF_GUARDED.test(pathname)) return null
    const method = req.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null
    const refuse = (status: number, state: string) => new NextResponse(JSON.stringify({ ok: false, state }), {
        status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
    const site = req.headers.get('sec-fetch-site')
    if (site) {
        if (site !== 'same-origin') return refuse(403, 'cross_site')
    } else {
        const origin = req.headers.get('origin')
        if (origin && !OUR_ORIGINS.has(origin) && origin !== req.nextUrl.origin) return refuse(403, 'cross_site')
    }
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const type = (req.headers.get('content-type') ?? '').toLowerCase()
        const hasBody = Number(req.headers.get('content-length') ?? '0') > 0 || req.headers.has('transfer-encoding')
        if (type ? !type.startsWith('application/json') : hasBody) return refuse(415, 'json_only')
    }
    return null
}

/**
 * The path as the file system will serve it: percent-decoded and lower-cased, so
 * /droidz_survival/%70lay/… is the gated /droidz_survival/play/… (it was served without a cookie).
 * A malformed escape is treated as the gated path.
 */
function gatedGamePath(pathname: string): boolean {
    let p = pathname
    try { p = decodeURIComponent(pathname) } catch { return pathname.toLowerCase().includes('droidz_survival') }
    p = p.toLowerCase()
    return p.startsWith('/droidz_survival/play') || (pathname.includes('%') && p.startsWith('/droidz_survival/'))
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

    // ── 2. Droidz Survival beta gate ─────────────────────────────────────────
    // Only the build under /play is gated; /droidz_survival itself is the door.
    if (gatedGamePath(pathname)) {
        const wallet = await readPlayToken(req.cookies.get(PLAY_COOKIE_NAME)?.value)
        if (!wallet) {
            const url = req.nextUrl.clone()
            url.pathname = '/droidz_survival'
            url.search = ''
            // Redirect, not rewrite: the game loads its own assets by relative path, and a
            // rewrite would leave the browser thinking it is still inside /play.
            return NextResponse.redirect(url)
        }
    }

    // ── 3. Cross-site writes to the game's API ───────────────────────────────
    const cs = crossSite(req)
    if (cs) return cs

    // ── 4. Rate limiter (passthrough if not configured for this path) ────────
    const rl = rateLimit(req)
    if (rl) return rl

    return NextResponse.next()
}

export const config = {
    // Run on every request EXCEPT static asset paths and Next internals so
    // /coming-soon (and its login form) can load fonts, JS, images, etc.
    matcher: [
        //
        // Also skipped: public read-only APIs the middleware has nothing to do for (no gate, no
        // limit, maintenance lets /api through) and that the menu polls — every middleware run is
        // a billed invocation, even on a CDN hit. Their routes cache and memoize on their own.
        '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|api/survival/(?:pool|board|tickets|clans)(?:/|$)|api/metadata(?:/|$)|.*\\.(?:png|jpg|jpeg|gif|webp|svg|mp4|mp3|MP3|webm|wav|ogg|woff|woff2|ttf|eot|ico|json|webmanifest|txt|map)).*)',
        // `.webmanifest`: the Droidz Survival home-screen app's manifest (public/droidz_survival/
        // manifest.webmanifest) — a phone fetches it without any cookie, and under MAINTENANCE_MODE the
        // gate would answer it with the /coming-soon page instead.
        // The game build is matched separately and WITHOUT the asset-extension escape hatch:
        // its sprite sheets and atlases are .png and .json, and the pattern above would wave
        // every one of them straight past the beta gate.
        '/droidz_survival/play/:path*',
    ],
}
