/**
 * The run ticket end to end (app/api/survival/run/*), against a running site.
 *
 * Forges the two cookies a real player carries (the signed wallet session and the beta play
 * cookie) for a throwaway wallet, then walks the protocol: an honest run is accepted and ranked,
 * a forged score is rejected WITH the message the player reads, a wave ahead of the physical pace
 * is only flagged while an impossible one is rejected, a second finish answers the verdict that
 * stands, a foreign run id is not found, a fresh start closes the ticket left open before it —
 * and a second throwaway wallet checks that a run which pulsed is counted at its last pulse when
 * superseded, and brought up to its full result by a late finish. A missing play cookie is renewed
 * while the beta is public (SURVIVAL_PUBLIC unset) and refused when it is closed.
 * Cleans its own rows out of the database afterwards. NEVER against production.
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

const WALLET2 = '0x' + '4'.repeat(40)
const PUBLIC = process.env.SURVIVAL_PUBLIC !== '0'
function sessionFor(w) {
    const payload = b64(JSON.stringify({ wallet: w, iat: Date.now(), exp: Date.now() + hour }))
    return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`
}
const session = sessionFor(WALLET)
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
    return { status: res.status, setCookie: res.headers.get('set-cookie') ?? '', ...(json ?? {}) }
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
ok(PUBLIC ? 'session but no play cookie (public beta) → allowed, and the cookie is renewed' : 'session but no play cookie (closed beta) → 401 no_access',
    PUBLIC ? onlySession.ok === true && /survival_play=[^;]+\./.test(onlySession.setCookie) : onlySession.status === 401 && onlySession.state === 'no_access', JSON.stringify(onlySession))

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
// …and, on a second wallet, a run that will pulse and then be superseded (one open run per wallet)
const cookies2 = `glitch_session=${sessionFor(WALLET2)}; survival_play=${await playToken(WALLET2)}`
const r1 = await post('/api/survival/run/start', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' }, cookies2)
console.log('waiting 16 s for the minimum run duration…')
await sleep(16_000)
await post('/api/survival/run/pulse', { runId: s2.runId, wave: 1, kills: 4, score: 90 })
const fin = await post('/api/survival/run/finish', { runId: s2.runId, wave: 1, kills: 5, score: 120, durationMs: 15_500 })
ok('an honest run is accepted and ranked', fin.verdict === 'accepted' && Number.isInteger(fin.rank) && fin.rank >= 1, JSON.stringify(fin))
const again = await post('/api/survival/run/finish', { runId: s2.runId, wave: 1, kills: 5, score: 120, durationMs: 15_500 })
ok('a second finish answers the verdict that stands (and pays nothing again)', again.verdict === 'accepted' && again.repeat === true && again.economy === null, JSON.stringify(again))

// ── a run that pulsed, superseded, then finished late ─────────────────────────────────────
await post('/api/survival/run/pulse', { runId: r1.runId, wave: 1, kills: 3, score: 100 }, cookies2)
const r2 = await post('/api/survival/run/start', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' }, cookies2)
const lateFin = await post('/api/survival/run/finish', { runId: r1.runId, wave: 1, kills: 4, score: 110, durationMs: 17_000 }, cookies2)
ok('a superseded run that pulsed takes its late finish', r2.ok === true && lateFin.verdict === 'accepted', JSON.stringify(lateFin))
const lateAgain = await post('/api/survival/run/finish', { runId: r1.runId, wave: 1, kills: 4, score: 110, durationMs: 17_000 }, cookies2)
ok('…only once', lateAgain.verdict === 'accepted' && lateAgain.repeat === true, JSON.stringify(lateAgain))
const closedPulse = await post('/api/survival/run/pulse', { runId: r1.runId, wave: 2, kills: 9, score: 300 }, cookies2)
ok('a pulse for a closed run says so in words', closedPulse.state === 'run_closed' && typeof closedPulse.message === 'string', JSON.stringify(closedPulse))

// ── lies ───────────────────────────────────────────────────────────────────────────────────
const s3 = await post('/api/survival/run/start', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' })
const forged = await post('/api/survival/run/finish', { runId: s3.runId, wave: 1, kills: 5, score: 999_999_999, durationMs: 1_000 })
ok('score 999999999 is rejected and says CHEATING DETECTED', forged.verdict === 'rejected' && /CHEATING DETECTED/.test(forged.message ?? ''), JSON.stringify(forged))
const s4 = await post('/api/survival/run/start', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' })
const ahead = await post('/api/survival/run/pulse', { runId: s4.runId, wave: 9, kills: 40, score: 800 })
ok('a pulse at wave 9 seconds after the start is only flagged', ahead.ok === true && !ahead.verdict, JSON.stringify(ahead))
const impossible = await post('/api/survival/run/pulse', { runId: s4.runId, wave: 60, kills: 400, score: 8000 })
ok('a pulse at wave 60 seconds after the start is rejected, with a reason in words', impossible.verdict === 'rejected' && impossible.reason === 'pulse_wave_impossible' && typeof impossible.why === 'string', JSON.stringify(impossible))
const afterReject = await post('/api/survival/run/finish', { runId: s4.runId, wave: 60, kills: 400, score: 8000, durationMs: 1_000 })
ok('the finish of a run a pulse rejected says rejected, not offline', afterReject.verdict === 'rejected' && afterReject.reason === 'pulse_wave_impossible', JSON.stringify(afterReject))
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
ok('a new start closes the ticket left open (no pulse: void, and it says why)', s7.ok === true && voided.verdict === 'void' && /NEWER RUN/.test(voided.message ?? ''), JSON.stringify(voided))
const other = await playToken('0x' + '3'.repeat(40))
const mismatch = await post('/api/survival/run/start', {}, `glitch_session=${session}; survival_play=${other}`)
ok(PUBLIC ? 'a play cookie for another wallet is replaced by one for the session\'s wallet' : 'a play cookie for another wallet is refused',
    PUBLIC ? mismatch.ok === true && /survival_play=/.test(mismatch.setCookie) : mismatch.status === 401, JSON.stringify(mismatch))

// ── the database saw what we saw ───────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const rows = (await client.query('select status, reject_reason from survival_runs where wallet = $1 order by started_at', [WALLET])).rows
ok('runs are stored with their verdicts', rows.some((r) => r.status === 'finished') && rows.some((r) => r.status === 'rejected' && r.reject_reason === 'score_over_cap') && rows.some((r) => r.status === 'void'), JSON.stringify(rows))
const best = (await client.query('select score from survival_season_best where wallet = $1', [WALLET])).rows
ok('only the accepted run reached the season board', best.length === 1 && best[0].score === 120, JSON.stringify(best))
const late = (await client.query('select status, score, flags from survival_runs where id = $1', [r1.runId])).rows[0]
ok('the superseded run is finished with the late result and says how', late?.status === 'finished' && late.score === 110 && late.flags.includes('restored_from_last_pulse') && late.flags.includes('late_finish'), JSON.stringify(late))
const best2 = (await client.query('select score, run_id from survival_season_best where wallet = $1', [WALLET2])).rows
ok('…and the board carries the late result, not the checkpoint', best2.length === 1 && best2[0].score === 110 && best2[0].run_id === r1.runId, JSON.stringify(best2))
// clean up: this wallet is ours and never played — the journal lines too, or the panel keeps
// showing rejected runs whose rows are gone
for (const w of [WALLET, WALLET2]) {
    await client.query('delete from survival_season_best where wallet = $1', [w])
    await client.query('delete from survival_runs where wallet = $1', [w])
    await client.query('delete from survival_events where wallet = $1', [w])
    // The finish now pays the run (lib/survivalEconomy.ts) — so there is a profile and a season row too.
    await client.query('delete from survival_profile_seasons where wallet = $1', [w])
    await client.query('delete from survival_profiles where wallet = $1', [w])
    await client.query('delete from survival_players where wallet = $1', [w])
}
await client.end()

let pass = true
for (const [n, c, info] of checks) { if (!c) pass = false; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '   ' + info}`) }
console.log(pass ? '\n✅ RUNS TEST PASS' : '\n❌ RUNS TEST FAIL')
process.exit(pass ? 0 : 1)
