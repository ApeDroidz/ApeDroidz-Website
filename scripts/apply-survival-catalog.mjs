/**
 * Applies 20260924_survival_catalog.sql — the editable price list, purchases beyond runs, and the
 * continue-as-a-run-credit. The dry run walks a throwaway wallet through each path and checks the
 * money trail; test rows live in a savepoint that is always rolled back.
 *   node --env-file=.env.local scripts/apply-survival-catalog.mjs [--commit]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const W = '0xca7a10' + 'a'.repeat(34), OTHER = '0xca7a10' + 'b'.repeat(34)
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (sql, p) => (await client.query(sql, p)).rows[0]
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])

await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20260924_survival_catalog.sql', 'utf8'))
    const cat = (await client.query(`select sku, kind, price_ape::text p, credits, active from survival_catalog order by sort`)).rows
    expect('the catalog is seeded: run 2 APE, run10 18 APE, season pass (off)', JSON.stringify(cat.map((c) => [c.sku, c.p, c.active])) === JSON.stringify([['run', '2.000000', true], ['run10', '18.000000', true], ['season_pass', '10.000000', false]]), JSON.stringify(cat))
    let bad = false
    try { await client.query(`savepoint s; insert into survival_catalog (sku, kind, title, price_ape, credits) values ('bad','runs','x',1,0)`) } catch { bad = true }
    await client.query('rollback to savepoint s').catch(() => {})
    expect('a runs item without credits is refused', bad)

    await client.query('savepoint probe')
    const season = await one("select id from survival_seasons where status='live' limit 1")
    await client.query('insert into survival_players (wallet) values ($1), ($2)', [W, OTHER])
    const PRICE = '10000000000000000000'
    const order = (await one(`insert into survival_orders (wallet, season_id, sku, kind, credits, price_ape, min_wei, mode, grant_spec) values ($1,$2,'season_pass','season_pass',0,10,$3,'solo','{}') returning id`, [W, season.id, PRICE])).id
    const r = (await one('select survival_settle_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', [order, W, '0xcat1', PRICE, '5000000000000000000', 1, 'site', 'solo', W, false])).r
    expect('a season pass payment settles', r === 'paid', r)
    const ent = await one(`select sku, kind, seed, claimed_at from survival_entitlements where order_id=$1`, [order])
    expect('…as one entitlement with a server seed, unclaimed', ent?.kind === 'season_pass' && ent.seed !== null && ent.claimed_at === null, JSON.stringify(ent))
    const cr = await one(`select count(*)::int n from survival_credits where wallet=$1`, [W])
    expect('…and no run credits', cr.n === 0)
    const led = await one(`select amount_ape::text a from survival_pool_ledger where ref='0xcat1'`)
    expect('…its pool share in the ledger', led?.a === '5.000000', JSON.stringify(led))
    const entId = (await one(`select id from survival_entitlements where order_id=$1`, [order])).id
    expect('another wallet cannot claim it', (await one('select survival_claim_entitlements($1,$2) as n', [OTHER, [entId]])).n === 0)
    expect('the owner claims it once', (await one('select survival_claim_entitlements($1,$2) as n', [W, [entId]])).n === 1)
    expect('…and not twice', (await one('select survival_claim_entitlements($1,$2) as n', [W, [entId]])).n === 0)

    // continue = one run credit on the running run, once
    const run = (await one(`insert into survival_runs (season_id, wallet, status, mode) values ($1,$2,'started','solo') returning id`, [season.id, W])).id
    expect('continue without a credit: no_credit', (await one('select survival_continue_run($1,$2) as r', [W, run])).r === 'no_credit')
    await client.query(`insert into survival_credits (wallet, season_id, source, mode) values ($1,$2,'grant','solo'), ($1,$2,'grant','solo')`, [W, season.id])
    expect('someone else cannot continue my run', (await one('select survival_continue_run($1,$2) as r', [OTHER, run])).r === 'no_run')
    expect('continue with a credit: ok', (await one('select survival_continue_run($1,$2) as r', [W, run])).r === 'ok')
    expect('a second continue on the same run: already', (await one('select survival_continue_run($1,$2) as r', [W, run])).r === 'already')
    const left = await one(`select count(*)::int n from survival_credits where wallet=$1 and consumed_by_run is null`, [W])
    expect('exactly one credit was spent', left.n === 1, JSON.stringify(left))
    await client.query(`update survival_runs set status='finished' where id=$1`, [run])
    expect('a finished run cannot be continued', (await one('select survival_continue_run($1,$2) as r', [W, run])).r === 'no_run')
    await client.query('rollback to savepoint probe')
} catch (e) {
    expect('dry run did not throw', false, e.message)
}
const pass = checks.every(([, ok]) => ok)
await client.query(COMMIT && pass ? 'commit' : 'rollback')
await client.end()
for (const [n, ok, info] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '   ' + info}`)
console.log(pass ? (COMMIT ? '\n✅ APPLIED' : '\n✅ DRY RUN PASS (rolled back — run with --commit to apply)') : '\n❌ FAILED — nothing applied')
process.exit(pass ? 0 : 1)
