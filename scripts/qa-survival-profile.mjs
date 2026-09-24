/**
 * Profile sync and the journal, against a running site: a forged player saves a state,
 * reads it back identical, the season part lands in its own row, an unauthenticated log
 * line is taken (no wallet), an authenticated one carries the wallet. Cleans up.
 *   node --env-file=.env.local scripts/qa-survival-profile.mjs
 */
import { createHmac } from 'node:crypto'
import pg from 'pg'
const BASE = process.env.BASE ?? 'http://localhost:3737'
const SECRET = process.env.WALLET_SESSION_SECRET
const WALLET = '0x' + '4'.repeat(40)
const b64 = (s) => Buffer.from(s).toString('base64url')
const sp = b64(JSON.stringify({ wallet: WALLET, iat: Date.now(), exp: Date.now() + 3600e3 }))
const session = `${sp}.${createHmac('sha256', SECRET).update(sp).digest('base64url')}`
const pp = b64(JSON.stringify({ w: WALLET, exp: Date.now() + 3600e3 }))
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
const play = `${pp}.${Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(pp))).toString('base64url')}`
const cookie = `glitch_session=${session}; survival_play=${play}`
const call = async (path, method, body, c = cookie) => {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', cookie: c }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, ...(await r.json().catch(() => ({}))) }
}
const checks = []
const ok = (n, c, info = '') => checks.push([n, !!c, info])
const state = { version: 1, rev: 10, coins: 4321, unlockedHeroes: ['volt', 'goblin'], selectedHero: 'goblin', unlockedWeapons: ['sword_0'], selectedWeapon: 'staff', lab: { base_hp: 2 }, lifetime: { runs: 7, bestScore: 9001, kills: 800 }, bestiary: { robber: 40 }, settings: { sfxVolume: 50, shake: true, damageNumbers: true }, clan: 'BAYC', boost: null }
const put = await call('/api/survival/profile', 'PUT', { state, seasonId: 'beta-1', season: { seasonId: 'beta-1', sxp: 120, tier: 1, claimed: [1] }, daily: { lastClaimDay: '2026-09-18', streak: 3 }, clientVersion: 'qa' })
ok('PUT profile accepted', put.ok === true, JSON.stringify(put))
const get = await call('/api/survival/profile', 'GET')
ok('GET returns the same state', get.ok === true && get.state?.coins === 4321 && get.state?.selectedHero === 'goblin' && get.state?.lab?.base_hp === 2, JSON.stringify(get).slice(0, 200))
ok('season progress rides in its own row', get.season?.seasonId === 'beta-1' && get.season?.season?.sxp === 120 && get.season?.daily?.streak === 3, JSON.stringify(get.season))
ok('season hidden for an ordinary wallet', get.features?.season === false, JSON.stringify(get.features))
ok('GET names the caller as owner (the game tells whose save is local by it)', get.owner === WALLET, String(get.owner))
// Revisions (24.09.2026): an older save must never roll a newer one back.
const stale = await call('/api/survival/profile', 'PUT', { state: { ...state, rev: 9, coins: 1 }, clientVersion: 'qa-stale-tab' })
ok('an older revision is refused as stale, with the stored revision', stale.ok === false && stale.state === 'stale' && stale.rev === 10, JSON.stringify(stale))
const afterStale = await call('/api/survival/profile', 'GET')
ok('…and the stored save is untouched', afterStale.state?.coins === 4321 && afterStale.state?.rev === 10, JSON.stringify(afterStale.state).slice(0, 120))
const same = await call('/api/survival/profile', 'PUT', { state: { ...state, rev: 10 }, clientVersion: 'qa' })
ok('the same revision is accepted (a repeated last push on the way out)', same.ok === true, JSON.stringify(same))
const newer = await call('/api/survival/profile', 'PUT', { state: { ...state, rev: 11, coins: 5000 }, clientVersion: 'qa' })
const afterNewer = await call('/api/survival/profile', 'GET')
ok('a newer revision lands', newer.ok === true && afterNewer.state?.coins === 5000 && afterNewer.state?.rev === 11, JSON.stringify(newer))
const racing = await Promise.all([12, 13, 14].map((r) => call('/api/survival/profile', 'PUT', { state: { ...state, rev: r, coins: 6000 + r }, clientVersion: 'qa-race' })))
const afterRace = await call('/api/survival/profile', 'GET')
const won = racing.filter((x) => x.ok === true).length
ok('racing pushes: every loser is told to retry or is stale, the stored save is one of the winners', won >= 1 && racing.every((x) => x.ok === true || x.state === 'retry' || x.state === 'stale') && afterRace.state?.coins === 6000 + afterRace.state?.rev, JSON.stringify(racing.map((x) => x.ok || x.state)) + ' stored ' + afterRace.state?.rev)
const anon = await call('/api/survival/profile', 'GET', null, '')
ok('no cookies → 401', anon.status === 401)
const big = await call('/api/survival/profile', 'PUT', { state: { junk: 'x'.repeat(70000) } })
ok('an oversized state is refused', big.ok === false && big.state === 'malformed', JSON.stringify(big))
const l1 = await call('/api/survival/log', 'POST', { level: 'error', kind: 'qa.test', message: 'hello from qa', data: { a: 1 } })
const l2 = await call('/api/survival/log', 'POST', { level: 'info', kind: 'qa.anon', message: 'anon line' }, '')
ok('log lines accepted', l1.ok === true && l2.ok === true)
await new Promise((r) => setTimeout(r, 800))
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const ev = (await client.query("select wallet, level, kind from survival_events where kind in ('qa.test','qa.anon') order by at desc limit 2")).rows
ok('the journal has the authenticated line with the wallet and the anonymous one without', ev.some((e) => e.kind === 'qa.test' && e.wallet === WALLET && e.level === 'error') && ev.some((e) => e.kind === 'qa.anon' && e.wallet === null), JSON.stringify(ev))
// Next's Data Cache served a stale profile to the game (24.09.2026) — a write made behind the
// site's back must show on the very next read.
await client.query(`update survival_profiles set state = jsonb_set(state, '{coins}', '777') where wallet=$1`, [WALLET])
const live = await call('/api/survival/profile', 'GET')
ok('a read after a direct DB write is live, not cached', live.state?.coins === 777, String(live.state?.coins))
await client.query(`update survival_profiles set state = jsonb_set(state, '{coins}', to_jsonb(coins)) where wallet=$1`, [WALLET])
const prof = (await client.query('select coins, runs, best_score from survival_profiles where wallet=$1', [WALLET])).rows[0]
ok('the extracted columns match the state', prof && prof.coins === 6000 + afterRace.state?.rev && prof.runs === 7 && prof.best_score === 9001, JSON.stringify(prof))
await client.query('delete from survival_events where kind like $1', ['qa.%'])
await client.query('delete from survival_profile_seasons where wallet=$1', [WALLET])
await client.query('delete from survival_profiles where wallet=$1', [WALLET])
await client.query('delete from survival_players where wallet=$1', [WALLET])
await client.end()
let pass = true
for (const [n, c, info] of checks) { if (!c) pass = false; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '   ' + info}`) }
console.log(pass ? '\n✅ PROFILE TEST PASS' : '\n❌ PROFILE TEST FAIL')
process.exit(pass ? 0 : 1)
