/**
 * The run ticket end to end (app/api/survival/run/*), against a running site.
 *
 * Forges the two cookies a real player carries (the signed wallet session and the beta play
 * cookie) for a throwaway wallet, then walks the protocol: an honest run is accepted and ranked,
 * a forged score is rejected WITH the message the player reads, a wave ahead of the clock is
 * rejected, a second finish is refused, a foreign run id is not found, and a fresh start voids
 * the ticket left open before it. Cleans its own rows out of the database afterwards.
 *
 *   MAINTENANCE_MODE=0 npx next dev -p 3737     # in another shell
 *   node --env-file=.env.local scripts/qa-survival-runs.mjs
 */
import { createHmac } from 'node:crypto'
import pg from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3737'
const SECRET = process.env.WALLET_SESSION_SECRET
if (!SECRET) throw new Error('WALLET_SESSION_SECRET missing')
const WALLET = '0x' + '2'.repeat(40)
const hour = 3600_000
const b64 = (s) => Buffer.from(s).toString('base64url')

const sessionPayload = b64(JSON.stringify({ wallet: WALLET, iat: Date.now(), exp: Date.now() + hour }))
const session = `${sessionPayload}.${createHmac('sha256', SECRET).update(sessionPayload).digest('base64url')}`
async function playToken(w = WALLET) {
    const payload = b64(JSON.stringify({ w, exp: Date.now() + hour }))
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url')
    return `${payload}.${sig}`
}
const play = await playToken()
const cookies = `glitch_session=${session}; survival_play=${play}`

async function post(path, body, cookie = cookies) {
    const res = await fetch(BASE + path, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
    })
    let json = null
    try { json = await res.json() } catch { /* empty */ }
    return { status: res.status, ...(json ?? {}) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (let i = 0; i < 90; i++) {
    try { const r = await fetch(BASE + '/droidz_survival', { redirect: 'manual' }); if (r.status < 500) break } catch {}
    await sleep(1000)
}

const checks = []
const ok = (name, cond, info = '') => checks.push([name, !!cond, info])

// ── auth ───────────────────────────────────────────────────────────────────────────────────
const noCookie = await post('/api/survival/run/start', {}, '')
ok('start without cookies → 401', noCookie.status === 401, JSON.stringify(noCookie))
const onlySession = await post('/api/survival/run/start', {}, `glitch_session=${session}`)
ok('start with the session but no beta cookie → 401 no_access', onlySession.status === 401 && onlySession.state === 'no_access', JSON.stringify(onlySession))

// ── an honest run ──────────────────────────────────────────────────────────────────────────
const start = await post('/api/survival/run/start', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' })
ok('start opens a ticket with a seed', start.ok === true && typeof start.runId === 'string' && typeof start.seed === 'number', JSON.stringify(start))
const runId = start.runId
const p1 = await post('/api/survival/run/pulse', { runId, wave: 2, kills: 30, score: 700 })
ok('pulse at the wave boundary is accepted', p1.ok === true && !p1.verdict, JSON.stringify(p1))
const early = await post('/api/survival/run/finish', { runId, wave: 2, kills: 31, score: 720, durationMs: 3000 })
ok('a finish inside 15 s is void, not cheat', early.verdict === 'void' && /TOO SHORT/.test(early.message ?? ''), JSON.stringify(early))

// a fresh ticket for the honest run proper: wait out the minimum duration
const s2 = await post('/api/survival/run/start', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' })
console.log('waiting 16 s for the minimum run duration…')
await sleep(16_000)
await post('/api/survival/run/pulse', { runId: s2.runId, wave: 1, kills: 4, score: 90 })
const fin = await post('/api/survival/run/finish', { runId: s2.runId, wave: 1, kills: 5, score: 120, durationMs: 15_500 })
ok('an honest run is accepted and ranked', fin.verdict === 'accepted' && Number.isInteger(fin.rank) && fin.rank >= 1, JSON.stringify(fin))
const again = await post('/api/survival/run/finish', { runId: s2.runId, wave: 1, kills: 5, score: 120, durationMs: 15_500 })
ok('a second finish for the same run is refused', again.ok === false && again.state === 'run_closed', JSON.stringify(again))

// ── lies ───────────────────────────────────────────────────────────────────────────────────
const s3 = await post('/api/survival/run/start', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' })
const forged = await post('/api/survival/run/finish', { runId: s3.runId, wave: 1, kills: 5, score: 999_999_999, durationMs: 1_000 })
ok('score 999999999 is rejected and says CHEATING DETECTED', forged.verdict === 'rejected' && /CHEATING DETECTED/.test(forged.message ?? ''), JSON.stringify(forged))
const s4 = await post('/api/survival/run/start', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' })
const ahead = await post('/api/survival/run/pulse', { runId: s4.runId, wave: 9, kills: 40, score: 800 })
ok('a pulse at wave 9 seconds after the start is rejected', ahead.verdict === 'rejected' && ahead.reason === 'pulse_wave_ahead_of_clock', JSON.stringify(ahead))
const s5 = await post('/api/survival/run/start', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' })
await post('/api/survival/run/pulse', { runId: s5.runId, wave: 2, kills: 50, score: 1000 })
const back = await post('/api/survival/run/pulse', { runId: s5.runId, wave: 2, kills: 40, score: 1000 })
ok('a pulse whose kills went down is rejected', back.verdict === 'rejected' && back.reason === 'pulse_regressed', JSON.stringify(back))

// ── tickets ────────────────────────────────────────────────────────────────────────────────
const foreign = await post('/api/survival/run/finish', { runId: '00000000-0000-4000-8000-000000000000', wave: 1, kills: 5, score: 100, durationMs: 20_000 })
ok('an unknown run id is not found (nothing recorded)', foreign.ok === false && foreign.state === 'no_run', JSON.stringify(foreign))
const s6 = await post('/api/survival/run/start', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' })
const s7 = await post('/api/survival/run/start', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' })
const voided = await post('/api/survival/run/finish', { runId: s6.runId, wave: 1, kills: 5, score: 100, durationMs: 20_000 })
ok('a new start voids the ticket left open', s7.ok === true && voided.state === 'run_closed', JSON.stringify(voided))
const other = await playToken('0x' + '3'.repeat(40))
const mismatch = await post('/api/survival/run/start', {}, `glitch_session=${session}; survival_play=${other}`)
ok('a play cookie for another wallet is refused', mismatch.status === 401, JSON.stringify(mismatch))

// ── the database saw what we saw ───────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const rows = (await client.query('select status, reject_reason from survival_runs where wallet = $1 order by started_at', [WALLET])).rows
ok('runs are stored with their verdicts', rows.some((r) => r.status === 'finished') && rows.some((r) => r.status === 'rejected' && r.reject_reason === 'score_over_cap') && rows.some((r) => r.status === 'void'), JSON.stringify(rows))
const best = (await client.query('select score from survival_season_best where wallet = $1', [WALLET])).rows
ok('only the accepted run reached the season board', best.length === 1 && best[0].score === 120, JSON.stringify(best))
// clean up: this wallet is ours and never played
await client.query('delete from survival_season_best where wallet = $1', [WALLET])
await client.query('delete from survival_runs where wallet = $1', [WALLET])
await client.query('delete from survival_players where wallet = $1', [WALLET])
await client.end()

let pass = true
for (const [n, c, info] of checks) { if (!c) pass = false; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '   ' + info}`) }
console.log(pass ? '\n✅ RUNS TEST PASS' : '\n❌ RUNS TEST FAIL')
process.exit(pass ? 0 : 1)
