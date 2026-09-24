/**
 * Applies 20260924_survival_settle.sql — booking a paid order in one transaction.
 * The dry run walks a throwaway wallet through every answer the function can give and checks
 * the money trail each time (payments, credits, pool ledger). Test rows are rolled back.
 *
 *   node --env-file=.env.local scripts/apply-survival-settle.mjs [--commit]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const W = '0x5e771e' + 'd'.repeat(34), OTHER = '0x5e771e' + 'e'.repeat(34)
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (sql, p) => (await client.query(sql, p)).rows[0]
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])
const settle = async (order, wallet, tx, paid, pool, platform = 'otherside') =>
    (await one('select survival_settle_order($1,$2,$3,$4,$5,$6,$7) as r', [order, wallet, tx, paid, pool, 123, platform])).r
const tally = async () => one(`select
    (select count(*)::int from survival_payments where wallet=$1) pays,
    (select count(*)::int from survival_credits where wallet=$1) credits,
    (select coalesce(sum(amount_ape),0)::text from survival_pool_ledger where ref like '0xtest%') pool`, [W])

await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20260924_survival_settle.sql', 'utf8'))
    await client.query('savepoint probe')
    const season = await one("select id from survival_seasons where status='live' limit 1")
    await client.query('insert into survival_players (wallet) values ($1), ($2)', [W, OTHER])
    const mk = async (sku, credits, min) => (await one(`insert into survival_orders (wallet, season_id, sku, credits, price_ape, min_wei) values ($1,$2,$3,$4,1,$5) returning id`, [W, season.id, sku, credits, min])).id
    const MIN = '985000000000000000', PAID = '985000000000000000', POOL = '492500000000000000'

    const pack = await mk('run10', 10, MIN)
    expect('someone else cannot settle my order', await settle(pack, OTHER, '0xtest1', PAID, POOL) === 'no_order')
    expect('underpaid is refused and books nothing', await settle(pack, W, '0xtest1', '984999999999999999', POOL) === 'underpaid')
    let t = await tally()
    expect('…nothing booked', t.pays === 0 && t.credits === 0, JSON.stringify(t))
    expect('a Hub-net payment (0.985 of 1 APE) settles', await settle(pack, W, '0xtest1', PAID, POOL) === 'paid')
    t = await tally()
    expect('one payment, ten credits, the pool share in the ledger', t.pays === 1 && t.credits === 10 && Number(t.pool) === 0.4925, JSON.stringify(t))
    expect('the same tx again is idempotent', await settle(pack, W, '0xtest1', PAID, POOL) === 'paid')
    t = await tally()
    expect('…and books nothing twice', t.pays === 1 && t.credits === 10 && Number(t.pool) === 0.4925, JSON.stringify(t))
    expect('a paid order cannot be paid by another tx', await settle(pack, W, '0xtest2', PAID, POOL) === 'used')
    const again = await mk('run', 1, MIN)
    expect('one tx cannot pay two orders', await settle(again, W, '0xtest1', PAID, POOL) === 'used')
    const src = await one(`select source from survival_credits where wallet=$1 limit 1`, [W])
    expect('credits bought in Otherside are marked arcade', src.source === 'arcade')
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
