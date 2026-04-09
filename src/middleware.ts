import { NextRequest, NextResponse } from 'next/server'

// In-memory rate limiter (per Vercel edge worker instance)
// For production scale, replace the Map with Upstash Redis
const hits = new Map<string, { count: number; reset: number }>()

const LIMITS: Record<string, { max: number; windowMs: number }> = {
    '/api/flight/session/start':        { max: 60,  windowMs: 60_000 },
    '/api/flight/session/complete':     { max: 120, windowMs: 60_000 },
    '/api/flight/session/place-bet':    { max: 60,  windowMs: 60_000 },
    '/api/flight/session/cashout':      { max: 60,  windowMs: 60_000 },
    '/api/flight/session/mark-running': { max: 60,  windowMs: 60_000 },
    '/api/flight/balance':              { max: 60,  windowMs: 60_000 },
    '/api/flight/deposit':              { max: 10,  windowMs: 60_000 },  // strict
    '/api/flight/withdraw':             { max: 5,   windowMs: 60_000 },  // very strict
    '/api/flight/history':              { max: 30,  windowMs: 60_000 },
    '/api/flight/top-pilots':           { max: 30,  windowMs: 60_000 },
}

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl
    const limit = LIMITS[pathname]
    if (!limit) return NextResponse.next()

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const key = `${pathname}:${ip}`
    const now = Date.now()

    const entry = hits.get(key)
    if (!entry || now > entry.reset) {
        hits.set(key, { count: 1, reset: now + limit.windowMs })
        return NextResponse.next()
    }

    entry.count++
    if (entry.count > limit.max) {
        return new NextResponse(
            JSON.stringify({ error: 'Too many requests' }),
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
