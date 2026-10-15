/**
 * Applies 20261016_survival_coop.sql — co-op runs: the team table, survival_runs.coop_id, the team's
 * START (survival_coop_open: every member's run spent, or none), a co-op continue spending a solo
 * run, and the solo board left alone by co-op runs. The dry run opens a throwaway team of two QA
 * wallets inside a savepoint and checks every rule; nothing of it is kept.
 *   node --env-file=.env.local scripts/apply-survival-coop.mjs [--commit]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (sql, p) => (await client.query(sql, p)).rows[0]
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])
const W1 = '0x1111111111111111111111111111111111c00001'
const W2 = '0x1111111111111111111111111111111111c00002'
await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20261016_survival_coop.sql', 'utf8'))
    await client.query('savepoint probe')
    const season = (await one("select id from survival_seasons where status='live' limit 1")).id
    for (const w of [W1, W2]) await client.query('insert into survival_players (wallet) values ($1) on conflict (wallet) do nothing', [w])
    await client.query(`insert into survival_credits (wallet, season_id, source, mode) values ($1, $2, 'grant', 'solo')`, [W1, season])
    const args = (paid) => [season, 'probe', W1, [W1, W2], ['volt', 'goblin'], ['sword_0', 'staff'], ['probe', 'probe'], 42, paid]
    const call = 'select * from survival_coop_open($1, $2, $3, $4, $5, $6, $7, $8, $9)'

    // One member without a run: nothing for anybody, and the error names him.
    await client.query('savepoint none')
    let err = ''
    try { await client.query(call, args(true)) } catch (e) { err = e.message }
    await client.query('rollback to savepoint none')
    expect('a member without a run stops the START', /no_credit:0x1111111111111111111111111111111111c00002/.test(err), err)
    expect('…and nothing was opened or spent', (await one(`select count(*)::int n from survival_runs where wallet = any($1)`, [[W1, W2]])).n === 0
        && (await one(`select count(*)::int n from survival_credits where wallet = $1 and consumed_by_run is null`, [W1])).n === 1)

    // Both have runs (the second a bought one and the welcome gift): both are spent, the gift first.
    await client.query(`insert into survival_credits (wallet, season_id, source, mode) values ($1, $2, 'grant', 'solo')`, [W2, season])
    await client.query(`insert into survival_credits (wallet, season_id, source, mode) values ($1, $2, 'welcome', 'solo')`, [W2, season])
    const rows = (await client.query(call, args(true))).rows
    expect('START opens a run per member', rows.length === 2 && rows.every((r) => r.o_run && r.o_coop === rows[0].o_coop), JSON.stringify(rows.map((r) => r.o_wallet)))
    const runs = (await client.query(`select id, wallet, mode, coop_id, credit_id, status from survival_runs where coop_id = $1`, [rows[0].o_coop])).rows
    expect('…mode coop, tied to the team, each with its credit', runs.length === 2 && runs.every((r) => r.mode === 'coop' && r.credit_id && r.status === 'started'))
    const spent2 = await one(`select c.source from survival_credits c join survival_runs r on r.credit_id = c.id where r.wallet = $1 and r.coop_id = $2`, [W2, rows[0].o_coop])
    expect('…the welcome run spent first', spent2?.source === 'welcome', spent2?.source)
    expect('…the team row stands', (await one(`select count(*)::int n from survival_coop_runs where id = $1 and status = 'started'`, [rows[0].o_coop])).n === 1)

    // A co-op continue spends a SOLO run.
    const r1 = runs.find((r) => r.wallet === W1)
    expect('a co-op continue with no run left says so', (await one('select survival_continue_run($1, $2) v', [W1, r1.id])).v === 'no_credit')
    await client.query(`insert into survival_credits (wallet, season_id, source, mode) values ($1, $2, 'grant', 'solo')`, [W1, season])
    expect('…and with a solo run it continues', (await one('select survival_continue_run($1, $2) v', [W1, r1.id])).v === 'ok')

    // A finished co-op run stays off the solo board.
    const bestBefore = (await one(`select count(*)::int n from survival_season_best where wallet = any($1)`, [[W1, W2]])).n
    await client.query(`update survival_runs set status = 'finished', score = 100, wave = 3, kills = 10, finished_at = now() where coop_id = $1`, [rows[0].o_coop])
    expect('co-op results never land on the solo board', (await one(`select count(*)::int n from survival_season_best where wallet = any($1)`, [[W1, W2]])).n === bestBefore)
    // A solo run still does.
    await client.query(`insert into survival_runs (season_id, wallet, status, mode, score, wave, kills, finished_at) values ($1, $2, 'finished', 'solo', 50, 2, 5, now())`, [season, W1])
    expect('a solo result still lands on the solo board', (await one(`select count(*)::int n from survival_season_best where wallet = $1`, [W1])).n === 1)

    expect('anon cannot open a team', (await one(`select has_function_privilege('anon', 'public.survival_coop_open(text, text, text, text[], text[], text[], text[], bigint, boolean)', 'execute') a`)).a === false)
    expect('anon cannot read the teams table directly (RLS on)', (await one(`select relrowsecurity r from pg_class where relname = 'survival_coop_runs'`)).r === true)
    await client.query('rollback to savepoint probe')
    expect('the probe left nothing behind', (await one(`select count(*)::int n from survival_players where wallet = any($1)`, [[W1, W2]])).n === 0)
} catch (e) { expect('migration ran', false, e.message) }
for (const [n, ok, info] of checks) console.log(ok ? '✓' : '✗', n, info ? `(${info})` : '')
const allOk = checks.length > 0 && checks.every((c) => c[1])
if (COMMIT && allOk) { await client.query('commit'); console.log('COMMITTED') }
else { await client.query('rollback'); console.log(COMMIT ? 'NOT committed: a check failed' : 'dry run — rolled back (pass --commit to apply)') }
await client.end()
