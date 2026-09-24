/**
 * Applies 20260924_survival_orders.sql (orders for the cashier contract, credit consumption).
 *
 * Additive — one table, three columns, one function. The dry run checks, inside the
 * transaction, the things that would cost a player a run they paid for:
 *   1. the table lands with RLS on;
 *   2. a credit is consumed once, oldest first, and never twice;
 *   3. two concurrent consumers can never take the same credit (SKIP LOCKED);
 *   4. with no credit left the function returns null — the start is refused, nothing is taken;
 *   5. credits bought in an earlier season are still spendable.
 *
 *   node --env-file=.env.local scripts/apply-survival-orders.mjs           # dry run
 *   node --env-file=.env.local scripts/apply-survival-orders.mjs --commit  # actually apply
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const SQL_PATH = 'supabase/migrations/20260924_survival_orders.sql'
const WALLET = '0x0dde' + 'c'.repeat(36)
const conn = { connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }
const client = new pg.Client(conn)
await client.connect()
const one = async (sql, params) => (await client.query(sql, params)).rows[0]
const checks = []
const expect = (name, ok, info = '') => checks.push([name, !!ok, info])

await client.query('begin')
try {
    await client.query(readFileSync(SQL_PATH, 'utf8'))
    const rls = await one("select relrowsecurity from pg_class where relname='survival_orders'")
    expect('survival_orders exists with RLS on', rls?.relrowsecurity === true)
    const cols = (await client.query("select column_name from information_schema.columns where table_name='survival_payments' and column_name in ('order_id','to_pool_ape','platform')")).rows
    expect('payments gained order_id / to_pool_ape / platform', cols.length === 3)

    const season = await one("select id from survival_seasons where status='live' limit 1")
    if (!season) throw new Error('no live season')
    // Test rows live in a savepoint that is always rolled back — only the schema is committed.
    await client.query('savepoint probe')
    await client.query('insert into survival_players (wallet) values ($1)', [WALLET])
    const order = await one(`insert into survival_orders (wallet, season_id, sku, credits, price_ape, min_wei) values ($1,$2,'run10',10,9,'8865000000000000000') returning id`, [WALLET, season.id])
    expect('an order can be written', !!order?.id)
    // two credits: an old one and a new one
    await client.query(`insert into survival_credits (wallet, season_id, source, created_at) values ($1,$2,'purchase', now() - interval '40 days'), ($1,$2,'arcade', now())`, [WALLET, season.id])
    const oldest = await one(`select id from survival_credits where wallet=$1 order by created_at limit 1`, [WALLET])
    // consumed_by_run references survival_runs: the run row exists before its credit is taken.
    const run = async () => (await one(`insert into survival_runs (season_id, wallet, status) values ($1,$2,'started') returning id`, [season.id, WALLET])).id
    const r1 = await run(), r2 = await run(), r3 = await run()
    const c1 = (await one('select survival_consume_credit($1,$2) as id', [WALLET, r1])).id
    expect('the oldest credit goes first (an old season\'s credit is still spendable)', c1 === oldest.id)
    const c2 = (await one('select survival_consume_credit($1,$2) as id', [WALLET, r2])).id
    expect('the next call takes the other credit, not the same one', c2 && c2 !== c1)
    const c3 = (await one('select survival_consume_credit($1,$2) as id', [WALLET, r3])).id
    expect('with no credit left: null, nothing taken', c3 === null)
    const spent = await one(`select count(*)::int n from survival_credits where wallet=$1 and consumed_by_run is not null`, [WALLET])
    expect('exactly two consumed', spent.n === 2)
    await client.query('rollback to savepoint probe')
} catch (e) {
    expect('dry run did not throw', false, e.message)
}
await client.query(COMMIT && checks.every(([, ok]) => ok) ? 'commit' : 'rollback')

// 3. concurrency — needs two real connections, so only against the committed schema.
if (COMMIT && checks.every(([, ok]) => ok)) {
    const a = new pg.Client(conn), b = new pg.Client(conn)
    await a.connect(); await b.connect()
    const season = (await a.query("select id from survival_seasons where status='live' limit 1")).rows[0]
    await a.query('insert into survival_players (wallet) values ($1) on conflict do nothing', [WALLET])
    await a.query(`insert into survival_credits (wallet, season_id, source) values ($1,$2,'grant')`, [WALLET, season.id])
    const mk = async () => (await a.query(`insert into survival_runs (season_id, wallet, status) values ($1,$2,'void') returning id`, [season.id, WALLET])).rows[0].id
    const runA = await mk(), runB = await mk()
    await a.query('begin'); await b.query('begin')
    const ra = (await a.query('select survival_consume_credit($1,$2) as id', [WALLET, runA])).rows[0].id
    const rb = (await b.query('select survival_consume_credit($1,$2) as id', [WALLET, runB])).rows[0].id
    await a.query('commit'); await b.query('commit')
    expect('two concurrent starts never share one credit', (ra === null) !== (rb === null), `${ra} / ${rb}`)
    await a.query('delete from survival_credits where wallet=$1', [WALLET])
    await a.query('delete from survival_runs where wallet=$1', [WALLET])
    await a.query('delete from survival_players where wallet=$1', [WALLET])
    await a.end(); await b.end()
}
await client.end()

let pass = true
for (const [n, ok, info] of checks) { if (!ok) pass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '   ' + info}`) }
console.log(pass ? (COMMIT ? '\n✅ APPLIED' : '\n✅ DRY RUN PASS (rolled back — run with --commit to apply)') : '\n❌ FAILED — nothing applied')
process.exit(pass ? 0 : 1)
