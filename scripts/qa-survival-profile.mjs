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
// 26.09.2026: the economy is the SERVER's — a PUT keeps the client's business only (settings, clan,
// an OWNED selection); coins, heroes, lab, lifetime, season and daily in the body are dropped.
ok('GET keeps the client business (clan, settings)', get.ok === true && get.state?.clan === 'BAYC' && get.state?.settings?.sfxVolume === 50, JSON.stringify(get).slice(0, 200))
ok('…and none of the economy the body claimed (coins, a hero it does not own, lab)', get.state?.coins === 0 && get.state?.selectedHero === 'volt' && !get.state?.lab?.base_hp, JSON.stringify(get.state).slice(0, 200))
ok('the season part in a PUT is ignored (the server writes it)', get.season?.seasonId === 'beta-1' && get.season?.season?.sxp === 0 && get.season?.daily?.streak === 0, JSON.stringify(get.season))
// The real game names its season 'S1' (config/season.ts), not the server's id. Until 26.09.2026
// that write hit the FK and was dropped — the table was empty for every player.
const put2 = await call('/api/survival/profile', 'PUT', { state, seasonId: 'S1', season: { seasonId: 'S1', sxp: 340, tier: 2, claimed: [1, 2], pass: true }, daily: { lastClaimDay: '2026-09-26', streak: 4 }, clientVersion: 'qa' })
const get2 = await call('/api/survival/profile', 'GET')
ok("a forged season in a PUT (any id) does not land — not even the pass flag", put2.ok === true && get2.season?.season?.sxp === 0 && get2.season?.season?.pass === false, JSON.stringify(get2.season))
// 25.09.2026: the Season screen is open to everyone; only the pass sale is gated (SURVIVAL_SEASON_OPEN).
ok('season screen open, pass not on sale for an ordinary wallet', get.features?.season === true && get.features?.passOnSale === false, JSON.stringify(get.features))
ok('GET names the caller as owner (the game tells whose save is local by it)', get.owner === WALLET, String(get.owner))
// Revisions (24.09.2026): an older save must never roll a newer one back.
const stale = await call('/api/survival/profile', 'PUT', { state: { ...state, rev: 9, coins: 1 }, clientVersion: 'qa-stale-tab' })
ok('an older revision is refused as stale, with the stored revision', stale.ok === false && stale.state === 'stale' && stale.rev === 10, JSON.stringify(stale))
const afterStale = await call('/api/survival/profile', 'GET')
ok('…and the stored save is untouched', afterStale.state?.rev === 10 && afterStale.state?.clan === 'BAYC', JSON.stringify(afterStale.state).slice(0, 120))
const same = await call('/api/survival/profile', 'PUT', { state: { ...state, rev: 10 }, clientVersion: 'qa' })
ok('the same revision is accepted (a repeated last push on the way out)', same.ok === true, JSON.stringify(same))
const newer = await call('/api/survival/profile', 'PUT', { state: { ...state, rev: 11, clan: 'PUNKS' }, clientVersion: 'qa' })
const afterNewer = await call('/api/survival/profile', 'GET')
ok('a newer revision lands', newer.ok === true && afterNewer.state?.clan === 'PUNKS' && afterNewer.state?.rev === 11, JSON.stringify(newer).slice(0, 200))
// The clan carries the revision it was sent with, so the stored copy shows which push won.
const racing = await Promise.all([12, 13, 14].map((r) => call('/api/survival/profile', 'PUT', { state: { ...state, rev: r, clan: `R${r}` }, clientVersion: 'qa-race' })))
const afterRace = await call('/api/survival/profile', 'GET')
const won = racing.filter((x) => x.ok === true).length
ok('racing pushes: every loser is told to retry or is stale, the stored save is one of the winners', won >= 1 && racing.every((x) => x.ok === true || x.state === 'retry' || x.state === 'stale') && afterRace.state?.clan === `R${afterRace.state?.rev}`, JSON.stringify(racing.map((x) => x.ok || x.state)) + ' stored ' + afterRace.state?.rev)
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
ok('the extracted columns are the server economy (0 coins, 0 runs), not what the body claimed', prof && prof.coins === 0 && prof.runs === 0, JSON.stringify(prof))
// A bought pass is re-granted from the server's record on boot (CloudSave) — the profile says so.
ok('no pass bought → passOwned false', live.season?.passOwned === false, JSON.stringify(live.season))
const liveSeason = (await client.query("select id from survival_seasons where status='live' limit 1")).rows[0]?.id
try {
    const order = (await client.query("insert into survival_orders (wallet, season_id, sku, price_ape, min_wei) values ($1, $2, 'season_pass', 1, 1) returning id", [WALLET, liveSeason])).rows[0].id
    await client.query("insert into survival_entitlements (wallet, order_id, sku, kind, grant_spec, season_id, seed) values ($1, $2, 'season_pass', 'season_pass', '{}'::jsonb, $3, 1)", [WALLET, order, liveSeason])
    const withPass = await call('/api/survival/profile', 'GET')
    ok('a pass on record → passOwned true (the game grants it back)', withPass.season?.passOwned === true, JSON.stringify(withPass.season))
} catch (e) { ok('a pass on record → passOwned true (the game grants it back)', false, e.message) } finally {
    await client.query('delete from survival_entitlements where wallet=$1', [WALLET])
    await client.query('delete from survival_orders where wallet=$1', [WALLET])
}
await client.query('delete from survival_events where kind like $1', ['qa.%'])
await client.query('delete from survival_profile_seasons where wallet=$1', [WALLET])
await client.query('delete from survival_profiles where wallet=$1', [WALLET])
await client.query('delete from survival_players where wallet=$1', [WALLET])
await client.end()
let pass = true
for (const [n, c, info] of checks) { if (!c) pass = false; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '   ' + info}`) }
console.log(pass ? '\n✅ PROFILE TEST PASS' : '\n❌ PROFILE TEST FAIL')
process.exit(pass ? 0 : 1)
