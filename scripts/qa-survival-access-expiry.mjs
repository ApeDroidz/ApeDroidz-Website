/**
 * Timed beta access, end to end: a probe wallet with 90 s left is let in and its play cookie
 * dies no later than the access does; the same wallet with its time up is denied and the
 * cookie is cleared. The probe row is removed afterwards.
 *
 *   MAINTENANCE_MODE=0 npx next dev -p 3737   (in another shell)
 *   node --env-file=.env.local scripts/qa-survival-access-expiry.mjs
 */
import { createHmac } from 'node:crypto'
import pg from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3737'
const SECRET = process.env.WALLET_SESSION_SECRET
if (!SECRET) throw new Error('WALLET_SESSION_SECRET missing')
const WALLET = '0x' + 'e'.repeat(40)
const b64 = (s) => Buffer.from(s).toString('base64url')
const sp = b64(JSON.stringify({ wallet: WALLET, iat: Date.now(), exp: Date.now() + 3600e3 }))
const session = `glitch_session=${sp}.${createHmac('sha256', SECRET).update(sp).digest('base64url')}`

let failed = 0
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + detail}`); if (!cond) failed++ }
const access = async () => {
    const r = await fetch(BASE + '/api/survival/access', { headers: { cookie: session } })
    const body = await r.json()
    const setCookie = r.headers.get('set-cookie') ?? ''
    const m = /survival_play=([^;]*)/.exec(setCookie)
    let exp = null
    if (m && m[1]) { try { exp = JSON.parse(Buffer.from(m[1].split('.')[0], 'base64url').toString()).exp } catch {} }
    return { state: body.state, exp, cleared: /survival_play=;/.test(setCookie) || /Max-Age=0/i.test(setCookie) }
}

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
    const until = new Date(Date.now() + 90e3)
    await client.query('insert into survival_allowlist (wallet, note, added_by, expires_at) values ($1, $2, $3, $4) on conflict (wallet) do update set revoked_at = null, expires_at = excluded.expires_at', [WALLET, 'qa access-expiry probe', 'qa', until.toISOString()])
    const a = await access()
    ok('90 s left → allowed', a.state === 'allowed', JSON.stringify(a))
    ok('play cookie expires no later than the access', a.exp !== null && a.exp <= until.getTime() + 1000 && a.exp > Date.now(), JSON.stringify(a))
    await client.query("update survival_allowlist set expires_at = now() - interval '1 second' where wallet = $1", [WALLET])
    const b = await access()
    ok('time up → denied', b.state === 'denied', JSON.stringify(b))
    ok('and the play cookie is cleared', b.cleared, JSON.stringify(b))
    await client.query('update survival_allowlist set expires_at = null where wallet = $1', [WALLET])
    const c = await access()
    ok('no expiry → allowed again', c.state === 'allowed', JSON.stringify(c))
} finally {
    await client.query('delete from survival_allowlist where wallet = $1', [WALLET])
    await client.end()
}
console.log(failed ? '❌ ACCESS EXPIRY TEST FAIL' : '✅ ACCESS EXPIRY TEST PASS')
process.exit(failed ? 1 : 0)
