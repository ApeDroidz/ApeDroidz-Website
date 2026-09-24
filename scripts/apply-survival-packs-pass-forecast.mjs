/**
 * Applies 20260925_survival_packs_pass_forecast.sql — ticket packs, the pass holder discount, the
 * season standings for the pool forecast. Dry run (rolled back): a pack of five draws five prizes
 * (five entitlements, one payment, one pool entry); a single ticket still draws one; the pass
 * carries a 30% holder discount; standings list a pass holder even before their first run.
 *   node --env-file=.env.local scripts/apply-survival-packs-pass-forecast.mjs [--commit]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const W = '0x7e57a0' + 'c'.repeat(34)
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (sql, p) => (await client.query(sql, p)).rows[0]
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])

await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20260925_survival_packs_pass_forecast.sql', 'utf8'))
    const pass = await one(`select price_ape, holder_discount_pct from survival_catalog where sku = 'season_pass'`)
    expect('the pass keeps 33 APE and carries a 30% holder discount', Number(pass.price_ape) === 33 && Number(pass.holder_discount_pct) === 30, JSON.stringify(pass))
    const packs = (await client.query(`select sku, price_ape, grant_spec from survival_catalog where kind = 'ticket' order by sort`)).rows
    expect('tickets: 1.5 APE and packs of 5/10/20/50', packs.map((p) => p.sku).join(',') === 'ticket,ticket5,ticket10,ticket20,ticket50' && Number(packs[0].price_ape) === 1.5, JSON.stringify(packs))

    // Test rows live in a savepoint that is always rolled back — the pool ledger is append-only.
    await client.query('savepoint probe')
    const season = await one("select id from survival_seasons where status='live' limit 1")
    await client.query('insert into survival_players (wallet) values ($1)', [W])
    const mk = async (sku, count) => (await one(`insert into survival_orders (wallet, season_id, sku, kind, credits, price_ape, min_wei, mode, grant_spec)
        values ($1,$2,$3,'ticket',0,1,'1000000000000000000','solo',$4) returning id`, [W, season.id, sku, JSON.stringify({ count })])).id
    const o5 = await mk('ticket5', 5)
    const r5 = (await one('select survival_settle_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', [o5, W, '0xpack5', '1000000000000000000', '500000000000000000', 1, 'site', 'solo', W, false])).r
    const e5 = (await client.query('select grant_spec from survival_entitlements where order_id = $1', [o5])).rows
    const pays = await one('select count(*)::int as n from survival_payments where order_id = $1', [o5])
    const led = await one(`select count(*)::int as n from survival_pool_ledger where ref = '0xpack5'`)
    expect('a pack of five draws five prizes', r5 === 'paid' && e5.length === 5 && e5.every((e) => e.grant_spec?.prize?.id), `${r5} ${e5.length}`)
    expect('…numbered 1..5 of 5', e5.map((e) => e.grant_spec.n).sort().join(',') === '1,2,3,4,5' && e5.every((e) => e.grant_spec.of === 5))
    expect('…with one payment and one pool entry', pays.n === 1 && led.n === 1, `${pays.n} ${led.n}`)
    const o1 = await mk('ticket', 1)
    await one('select survival_settle_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', [o1, W, '0xpack1', '1000000000000000000', '0', 1, 'site', 'solo', W, false])
    const e1 = await one('select count(*)::int as n from survival_entitlements where order_id = $1', [o1])
    expect('a single ticket still draws one', e1.n === 1)

    const op = (await one(`insert into survival_orders (wallet, season_id, sku, kind, credits, price_ape, min_wei, mode)
        values ($1,$2,'season_pass','season_pass',0,23.1,'23100000000000000000','solo') returning id`, [W, season.id])).id
    await one('select survival_settle_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', [op, W, '0xpass', '23100000000000000000', '0', 1, 'site', 'solo', W, false])
    const st = await one('select * from survival_season_standings($1) where wallet = $2', [season.id, W])
    expect('standings list a pass holder before their first run', st && st.has_pass === true && Number(st.best) === 0, JSON.stringify(st))
    await client.query('rollback to savepoint probe')
} catch (e) {
    expect('dry run did not throw', false, e.message)
}
const ok = checks.every(([, pass]) => pass)
await client.query(COMMIT && ok ? 'commit' : 'rollback')
await client.end()
for (const [n, pass, info] of checks) console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${pass ? '' : '   ' + info}`)
console.log(ok ? (COMMIT ? '\n✅ APPLIED' : '\n✅ DRY RUN PASS (rolled back — run with --commit to apply)') : '\n❌ FAILED — nothing applied')
process.exit(ok ? 0 : 1)
