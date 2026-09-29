/**
 * The server economy end to end, against a running site (BASE, default http://localhost:3737):
 * a forged wallet tries every way the browser used to have to make money — a save with a million
 * Ape Mini and every hero, a purchase it cannot afford, a daily claimed twice, a run report full of
 * made-up loot — and the server keeps its own numbers throughout. Then an honest run pays the
 * formula. Cleans every row it made.
 *
 *   node --env-file=.env.local scripts/qa-survival-economy-e2e.mjs
 */
import { createHmac } from 'node:crypto'
import pg from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3737'
const SECRET = process.env.WALLET_SESSION_SECRET
const WALLET = '0x' + '5'.repeat(40)
const b64 = (s) => Buffer.from(s).toString('base64url')
const sp = b64(JSON.stringify({ wallet: WALLET, iat: Date.now(), exp: Date.now() + 3600e3 }))
const session = `${sp}.${createHmac('sha256', SECRET).update(sp).digest('base64url')}`
const pp = b64(JSON.stringify({ w: WALLET, exp: Date.now() + 3600e3 }))
const play = `${pp}.${createHmac('sha256', SECRET).update(pp).digest('base64url')}`
const cookie = `glitch_session=${session}; survival_play=${play}`
const call = async (path, method = 'GET', body) => {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, ...(await r.json().catch(() => ({}))) }
}
const act = (action) => call('/api/survival/economy', 'POST', { action })
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
const clean = async () => {
    for (const t of ['survival_season_best', 'survival_runs', 'survival_profile_seasons', 'survival_profiles', 'survival_events', 'survival_players']) await db.query(`delete from ${t} where wallet = $1`, [WALLET])
}
await clean()
const checks = []
const ok = (n, c, info = '') => checks.push([n, !!c, info])

try {
    // ── a new player ───────────────────────────────────────────────────────────────
    let g = await call('/api/survival/profile')
    ok('a new wallet reads no save', g.ok === true && g.state === null, JSON.stringify(g).slice(0, 200))

    // ── a forged save: a million Ape Mini, every hero, a made-up legendary ─────────
    const forged = { version: 1, rev: 5, coins: 1_000_000, unlockedHeroes: ['volt', 'goblin', 'geez'], selectedHero: 'goblin',
        resources: { scrap: 999, circuit: 999, cell: 999, core: 999 }, items: [{ uid: 'fake', kind: 'servo', rarity: 'legendary' }],
        equipped: ['fake'], settings: { sfxVolume: 33 }, lifetime: { runs: 999, bestScore: 1e9, kills: 1e6 } }
    const put = await call('/api/survival/profile', 'PUT', { state: forged, clientVersion: 'qa-forger' })
    ok('the PUT lands but answers with the server economy: 0 Ape Mini', put.ok === true && put.state?.coins === 0, JSON.stringify(put).slice(0, 240))
    g = await call('/api/survival/profile')
    ok('stored: no coins, no forged heroes, no forged item', g.state?.coins === 0 && !g.state.unlockedHeroes.includes('goblin') && g.state.items.length === 0, JSON.stringify(g.state).slice(0, 240))
    ok('…the selected hero falls back to one it owns; its own settings kept', g.state.selectedHero === 'volt' && g.state.settings?.sfxVolume === 33)
    const cols = (await db.query('select coins, runs, best_score from survival_profiles where wallet=$1', [WALLET])).rows[0]
    ok('the panel columns are the server numbers too', cols?.coins === 0 && cols.runs === 0, JSON.stringify(cols))

    // ── spending what it does not have ──────────────────────────────────────────
    let r = await act({ type: 'unlock_hero', hero: 'goblin' })
    ok('buying Gob with 0 Ape Mini is refused', r.ok === false && r.error === 'not_enough_coins', JSON.stringify(r))
    r = await act({ type: 'craft', kind: 'servo', core: false })
    ok('crafting with no salvage is refused', r.ok === false && r.error === 'not_enough_resources', JSON.stringify(r))
    r = await call('/api/survival/economy', 'POST', { action: { type: 'add_coins', amount: 1e6 } })
    ok('an action the server does not know is refused outright', r.status === 400 && r.error === 'bad_action', JSON.stringify(r))

    // ── the daily claim, by the server's day ───────────────────────────────────
    r = await act({ type: 'claim_daily' })
    ok('the daily pays its first-day reward', r.ok === true && r.result?.streak === 1 && r.state?.coins === 50, JSON.stringify(r).slice(0, 200))
    r = await act({ type: 'claim_daily' })
    ok('a second claim today is refused', r.ok === false && r.error === 'already_claimed', JSON.stringify(r))

    // ── a run: made-up loot is capped, the formula pays ──────────────────────────
    const start = await call('/api/survival/run/start', 'POST', { hero: 'volt', weapon: 'sword_0', clientVersion: 'qa' })
    ok('a run starts', start.ok === true && typeof start.runId === 'string', JSON.stringify(start))
    await db.query("update survival_runs set started_at = now() - interval '5 minutes' where id = $1", [start.runId])
    const report = { hero: 'volt', picked: 1e9, salvaged: { core: 1e6, scrap: 1e6, circuit: 1e6, cell: 1e6 }, elites: 1e5, bosses: 99, charged: 1e6, breaks: 1e6, pickups: 1e6, kinds: { robber: 1e7, dragon: 5 } }
    const fin = await call('/api/survival/run/finish', 'POST', { runId: start.runId, wave: 10, kills: 250, score: 40_000, durationMs: 290_000, report })
    ok('the run is accepted and paid', fin.verdict === 'accepted' && fin.economy?.paid, JSON.stringify(fin).slice(0, 300))
    const paid = fin.economy?.paid ?? {}
    const formula = Math.floor(3 * Math.sqrt(40_000) + 250 * 0.3 + 10 * 20)
    ok('Ape Mini: the formula + picked capped at 2 per kill + 50', paid.coins <= formula + 250 * 2 + 50 && paid.coins >= formula, JSON.stringify(paid))
    ok('cores capped by the run, not a million', (fin.economy?.state?.resources?.core ?? 1e9) <= 30, JSON.stringify(fin.economy?.state?.resources))
    ok('the bestiary counted no more kills than the run had; no dragons', fin.economy?.state?.bestiary?.robber === 250 && !fin.economy?.state?.bestiary?.dragon)
    ok('season XP came with it', (fin.economy?.season?.sxp ?? 0) > 0)
    const coinsAfterRun = fin.economy?.state?.coins ?? 0
    r = await act({ type: 'unlock_hero', hero: 'goblin' })
    ok('still not enough for Gob after one run (10 000)', r.ok === false && r.error === 'not_enough_coins')

    // ── an honest spend, and the save can't undo it ─────────────────────────────
    await db.query("update survival_profiles set state = jsonb_set(state, '{coins}', '12000'::jsonb) where wallet = $1", [WALLET])
    r = await act({ type: 'unlock_hero', hero: 'goblin' })
    ok('with the coins (granted server-side), Gob unlocks and costs 10 000', r.ok === true && r.state?.coins === 2000 && r.state.unlockedHeroes.includes('goblin'), JSON.stringify(r).slice(0, 200))
    const rollback = await call('/api/survival/profile', 'PUT', { state: { ...forged, rev: 1, coins: 12000, unlockedHeroes: ['volt'] }, clientVersion: 'qa-old-tab' })
    ok('an old tab pushing its older save is refused as stale', rollback.ok === false && rollback.state === 'stale', JSON.stringify(rollback))
    void coinsAfterRun
} finally {
    await clean()
    await db.end()
}
let pass = true
for (const [n, c, info] of checks) { if (!c) pass = false; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '   ' + info}`) }
console.log(pass ? `\n✅ ECONOMY E2E PASS (${checks.length})` : '\n❌ ECONOMY E2E FAIL')
process.exitCode = pass ? 0 : 1
