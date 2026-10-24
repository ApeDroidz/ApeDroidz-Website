#!/usr/bin/env node
/**
 * Droidz Survival smoke test — run before EVERY release (against a preview/local build) and right
 * after it (against production). Owner, 24.10.2026: «такие сбои никуда не годятся» — the game
 * stopped loading in Otherside because a gate redirect was cached for a year, and nothing checked
 * it. Each check below stands for a way the game has already broken or could break unseen.
 *
 *   node scripts/smoke-survival.mjs                      # https://www.apedroidz.com
 *   node scripts/smoke-survival.mjs http://localhost:3737
 *
 * It also walks the game as a player — index.html → its bundle → every chunk the bundle imports —
 * with a play cookie: SMOKE_PLAY_COOKIE='survival_play=…' (copied from a signed-in browser), or one
 * minted with WALLET_SESSION_SECRET from .env.local (works locally; production's secret differs,
 * then the walk is skipped and says so). Exit code 1 if anything failed.
 */
import { readFileSync } from 'node:fs'
import { webcrypto as crypto } from 'node:crypto'

const BASE = (process.argv[2] || 'https://www.apedroidz.com').replace(/\/$/, '')
const PLAY = `${BASE}/droidz_survival/play/`

let failed = 0
const ok = (m) => console.log(`  ok    ${m}`)
const bad = (m) => { failed++; console.log(`  FAIL  ${m}`) }
const skip = (m) => console.log(`  skip  ${m}`)
const check = (cond, m) => (cond ? ok(m) : bad(m))
/** fetch, retried twice on a network error (a flaky line is not a broken release); still failing → a FAIL line, not a crash. */
async function net(url, opts) {
    for (let i = 0; ; i++) {
        try { return await fetch(url, opts) } catch (e) {
            if (i < 2) { await new Promise((r) => setTimeout(r, 1500)); continue }
            bad(`${url} — network: ${e.cause?.code || e.message}`)
            return new Response(null, { status: 599 })
        }
    }
}
const get = (url, opts = {}) => net(url, { redirect: 'manual', cache: 'no-store', ...opts })

/** A response the browser may keep: a gate answer at a real file's URL must never be one. */
function cacheable(res) {
    const cc = (res.headers.get('cache-control') || '').toLowerCase()
    if (/no-store/.test(cc)) return false
    if (/immutable/.test(cc)) return true
    const m = cc.match(/max-age=(\d+)/)
    return !!m && Number(m[1]) > 0
}

function secretFromEnv() {
    if (process.env.WALLET_SESSION_SECRET) return process.env.WALLET_SESSION_SECRET
    try {
        const line = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
            .split('\n').find((l) => l.startsWith('WALLET_SESSION_SECRET='))
        return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : null
    } catch { return null }
}

/** The same token lib/survivalAccess.createPlayToken mints, for a throwaway wallet, 10 minutes. */
async function playCookie(secret) {
    const b64u = (bytes) => Buffer.from(bytes).toString('base64url')
    const payload = b64u(new TextEncoder().encode(JSON.stringify({ w: '0x' + '5'.repeat(40), exp: Date.now() + 600_000 })))
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))))
    return `survival_play=${payload}.${sig}`
}

console.log(`Droidz Survival smoke — ${BASE}\n`)

console.log('Pages')
for (const p of ['/droidz_survival', '/droidz_survival/play', '/droidz_survival/otherside']) {
    const r = await get(BASE + p)
    check(r.status === 200, `${p} → ${r.status}`)
    if (p.endsWith('otherside')) {
        check((r.headers.get('content-security-policy') || '').includes('otherside.xyz'), 'cabinet may be framed by otherside.xyz')
        check((await r.text()).includes('warm.json'), 'cabinet carries the warm-up script')
    }
}

console.log('\nBuild list (warm.json)')
let warm = null
{
    const r = await get(PLAY + 'warm.json')
    check(r.status === 200, `warm.json → ${r.status} without a cookie`)
    try { warm = await r.json() } catch { bad('warm.json is not JSON') }
}
if (warm?.bundle) {
    for (const u of warm.assets || []) {
        const r = await net(u, { method: 'HEAD', headers: { origin: BASE } })
        check(r.status === 200 && !!r.headers.get('access-control-allow-origin'), `R2 ${u.split('/').slice(-2).join('/')} → ${r.status}, CORS ${r.headers.get('access-control-allow-origin') ? 'yes' : 'NO'}`)
    }

    console.log('\nGate (no play cookie) — what the Otherside warm-up gets before sign-in')
    const r = await get(PLAY + warm.bundle)
    check(r.status === 307 || r.status === 302, `bundle → ${r.status} (redirect to the landing)`)
    check(!cacheable(r), `that redirect is NOT cacheable (cache-control: ${r.headers.get('cache-control')})`)
    const h = await get(PLAY + 'index.html')
    check(!cacheable(h), `index.html redirect is NOT cacheable (cache-control: ${h.headers.get('cache-control')})`)
}

console.log('\nThe game as a player (play cookie)')
const secret = secretFromEnv()
const given = process.env.SMOKE_PLAY_COOKIE
if (!given && !secret) skip('no SMOKE_PLAY_COOKIE / WALLET_SESSION_SECRET — cannot walk the game')
else {
    const cookie = given || await playCookie(secret)
    const r = await get(PLAY + 'index.html', { headers: { cookie } })
    if (r.status !== 200 && !given) {
        skip(`index.html → ${r.status} with a cookie minted from .env.local (not this server's secret) — pass SMOKE_PLAY_COOKIE`)
    } else if (r.status !== 200) {
        bad(`index.html → ${r.status} with SMOKE_PLAY_COOKIE (expired? copy a fresh one)`)
    } else {
        ok('index.html → 200')
        const html = await r.text()
        const src = html.match(/<script type="module"[^>]*src="\.\/([^"]+)"/)?.[1]
        check(!!src, `module script: ${src}`)
        check(src === warm?.bundle, `warm.json bundle matches index.html (${warm?.bundle})`)
        const seen = new Set()
        const walk = async (file) => {
            if (seen.has(file)) return
            seen.add(file)
            const res = await get(PLAY + file, { headers: { cookie } })
            const body = await res.text()
            const js = /javascript/.test(res.headers.get('content-type') || '') && !body.trimStart().startsWith('<')
            check(res.status === 200 && js, `${file} → ${res.status} ${res.headers.get('content-type')}`)
            for (const m of body.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'`]\.\/([\w.-]+\.js)["'`]/g)) await walk('assets/' + m[1])
        }
        if (src) await walk(src)
    }
}

console.log('\nSign-in')
{
    const t0 = Date.now()
    const r = await get(BASE + '/api/auth/me')
    const d = await r.json().catch(() => ({}))
    check(r.status === 200 && typeof d.now === 'number', '/api/auth/me answers with the server clock')
    if (typeof d.now === 'number') check(Math.abs(d.now - (t0 + Date.now()) / 2) < 120_000, `server clock within 2 min of this machine's`)
    const o = await get(BASE + '/api/otherside/login')
    check(o.status === 200, `/api/otherside/login GET → ${o.status}`)
    const l = await get(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: '0x' + '5'.repeat(40), nonce: `${Date.now() - 3_600_000}.x`, signature: '0x00' }),
    })
    const ld = await l.json().catch(() => ({}))
    check(l.status === 400 && typeof ld.now === 'number', 'a stale nonce is refused with the server clock')
}

console.log(failed ? `\n${failed} FAILED — do not release / roll back` : '\nall good')
process.exit(failed ? 1 : 0)
