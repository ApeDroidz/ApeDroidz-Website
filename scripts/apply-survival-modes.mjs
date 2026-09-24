/**
 * Applies 20260924_survival_modes.sql — solo / co-op pools. The dry run walks a throwaway wallet
 * through both modes and every refusal, checking the money trail each time; test rows live in a
 * savepoint that is always rolled back.
 *   node --env-file=.env.local scripts/apply-survival-modes.mjs [--commit]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const W = '0x3ode5' .replace('o', '0') + 'f'.repeat(35)
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (sql, p) => (await client.query(sql, p)).rows[0]
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])
const settle = async (order, tx, paid, pool, mode, viaHub) =>
    (await one('select survival_settle_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', [order, W, tx, paid, pool, 1, 'otherside', mode, '0xhub', viaHub])).r

await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20260924_survival_modes.sql', 'utf8'))
    await client.query('savepoint probe')
    const season = await one("select id from survival_seasons where status='live' limit 1")
    await client.query('insert into survival_players (wallet) values ($1)', [W])
    const PRICE = '2000000000000000000'
    const mk = async (mode, credits) => (await one(`insert into survival_orders (wallet, season_id, sku, credits, price_ape, min_wei, mode) values ($1,$2,'run',$3,2,$4,$5) returning id`, [W, season.id, credits, PRICE, mode])).id
    const soloOrder = await mk('solo', 1), coopOrder = await mk('coop', 1)

    expect('an event for the wrong mode is refused', await settle(soloOrder, '0xm1', PRICE, '1', 'coop', false) === 'wrong_mode')
    expect('paid directly: 1.97 of 2 APE is underpaid', await settle(soloOrder, '0xm1', '1970000000000000000', '1', 'solo', false) === 'underpaid')
    expect('through the Hub: 1.97 of 2 APE (1.5% fee) settles', await settle(soloOrder, '0xm1', '1970000000000000000', '985000000000000000', 'solo', true) === 'paid')
    expect('through the Hub: below 90% is underpaid', await settle(coopOrder, '0xm2', '1799999999999999999', '1', 'coop', true) === 'underpaid')
    expect('co-op paid in full settles', await settle(coopOrder, '0xm2', PRICE, '1000000000000000000', 'coop', false) === 'paid')
    const led = (await client.query(`select bucket, amount_ape::text a from survival_pool_ledger where ref in ('0xm1','0xm2') order by bucket`)).rows
    expect('each mode fills its own pool bucket', JSON.stringify(led) === JSON.stringify([{ bucket: 'coop_pool', a: '1.000000' }, { bucket: 'solo_pool', a: '0.985000' }]), JSON.stringify(led))
    const cr = (await client.query(`select mode, count(*)::int n from survival_credits where wallet=$1 group by mode order by mode`, [W])).rows
    expect('credits carry their mode', JSON.stringify(cr) === JSON.stringify([{ mode: 'coop', n: 1 }, { mode: 'solo', n: 1 }]), JSON.stringify(cr))
    const pay = await one(`select mode, payer from survival_payments where tx_hash='0xm1'`)
    expect('payments record mode and payer', pay.mode === 'solo' && pay.payer === '0xhub')

    const run = async (mode) => (await one(`insert into survival_runs (season_id, wallet, status, mode) values ($1,$2,'started',$3) returning id`, [season.id, W, mode])).id
    const r1 = await run('solo')
    expect('a solo run takes the solo credit', !!(await one('select survival_consume_credit($1,$2,$3) as id', [W, r1, 'solo'])).id)
    const r2 = await run('solo')
    expect('…and cannot take the co-op one', (await one('select survival_consume_credit($1,$2,$3) as id', [W, r2, 'solo'])).id === null)
    const r3 = await run('coop')
    expect('a co-op run takes the co-op credit', !!(await one('select survival_consume_credit($1,$2,$3) as id', [W, r3, 'coop'])).id)
    let bad = false
    try { await client.query(`savepoint m; insert into survival_orders (wallet, season_id, sku, credits, price_ape, min_wei, mode) values ($1,$2,'run',1,2,1,'pvp')`, [W, season.id]) } catch { bad = true }
    await client.query('rollback to savepoint m').catch(() => {})
    expect('an unknown mode cannot be written', bad)
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
