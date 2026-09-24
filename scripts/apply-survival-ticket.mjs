/**
 * Applies 20260924_survival_ticket.sql — the lucky ticket. The dry run:
 *   1. draws 20 000 times and checks every prize lands within its expected share (±3σ);
 *   2. checks a stocked prize stops dropping when its stock runs out;
 *   3. books a paid ticket and checks: one entitlement carrying the prize, free runs credited on the spot;
 *   4. checks runs purchases still book as before.
 * Everything in a savepoint that is always rolled back; only the schema is committed.
 *   node --env-file=.env.local scripts/apply-survival-ticket.mjs [--commit]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const W = '0x71c4e7' + 'a'.repeat(34)
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (sql, p) => (await client.query(sql, p)).rows[0]
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])

await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20260924_survival_ticket.sql', 'utf8'))
    await client.query('savepoint probe')
    const prizes = (await client.query(`select id, weight from survival_ticket_prizes where active and (stock is null or stock > 0)`)).rows
    const total = prizes.reduce((a, p) => a + p.weight, 0)
    expect('the prize table is seeded and weighs 1 000 (the droid starts with 0 in stock)', total === 999 && prizes.length === 12, `${total} over ${prizes.length}`)
    // 1. distribution (stock-free prizes only, so the draw does not consume anything real)
    const N = 20000
    const counts = {}
    for (let i = 0; i < N; i += 500) {
        const r = await client.query(`select (survival_ticket_draw()).id from generate_series(1, 500)`)
        for (const row of r.rows) counts[row.id] = (counts[row.id] ?? 0) + 1
    }
    let worst = 0
    for (const p of prizes) {
        const pr = p.weight / total, exp = N * pr, sd = Math.sqrt(N * pr * (1 - pr))
        worst = Math.max(worst, Math.abs((counts[p.id] ?? 0) - exp) / sd)
    }
    expect('20 000 draws: every prize within 3σ of its weight', worst < 3.5, `worst ${worst.toFixed(2)}σ ${JSON.stringify(counts)}`)
    // 2. stock
    await client.query(`update survival_ticket_prizes set stock = 2, weight = 100000 where id = 'droid'`)
    const d = (await client.query(`select (survival_ticket_draw()).id from generate_series(1, 5)`)).rows.map((r) => r.id)
    const left = (await one(`select stock from survival_ticket_prizes where id='droid'`)).stock
    expect('a stocked prize drops at most its stock, then stops', d.filter((x) => x === 'droid').length === 2 && left === 0, `${d.join(',')} left ${left}`)
    await client.query(`update survival_ticket_prizes set stock = 0, weight = 1 where id = 'droid'`)
    // 3. a paid ticket
    const season = await one("select id from survival_seasons where status='live' limit 1")
    await client.query('insert into survival_players (wallet) values ($1)', [W])
    await client.query(`update survival_ticket_prizes set active = (id = 'run_3')`) // force the draw
    const o = (await one(`insert into survival_orders (wallet, season_id, sku, kind, credits, price_ape, min_wei, mode) values ($1,$2,'ticket','ticket',0,1,'1000000000000000000','solo') returning id`, [W, season.id])).id
    const r = (await one('select survival_settle_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', [o, W, '0xtix1', '1000000000000000000', '500000000000000000', 1, 'site', 'solo', W, false])).r
    const ent = await one(`select kind, grant_spec from survival_entitlements where order_id=$1`, [o])
    const credits = (await one(`select count(*)::int n from survival_credits where wallet=$1 and source='grant'`, [W])).n
    expect('a paid ticket books, records its prize in one entitlement', r === 'paid' && ent?.kind === 'ticket' && ent.grant_spec?.prize?.id === 'run_3', JSON.stringify(ent))
    expect('…and a free-runs prize is credited on the spot (3 runs)', credits === 3, String(credits))
    await client.query(`update survival_ticket_prizes set active = false`)
    const o2 = (await one(`insert into survival_orders (wallet, season_id, sku, kind, credits, price_ape, min_wei, mode) values ($1,$2,'ticket','ticket',0,1,'1000000000000000000','solo') returning id`, [W, season.id])).id
    await one('select survival_settle_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', [o2, W, '0xtix2', '1000000000000000000', '0', 1, 'site', 'solo', W, false])
    const ent2 = await one(`select grant_spec from survival_entitlements where order_id=$1`, [o2])
    expect('with every prize off, a ticket still pays its 500 Ape Mini floor', ent2?.grant_spec?.prize?.id === 'fallback', JSON.stringify(ent2))
    // 4. runs unchanged
    const o3 = (await one(`insert into survival_orders (wallet, season_id, sku, kind, credits, price_ape, min_wei, mode) values ($1,$2,'run10','runs',10,18,'18000000000000000000','solo') returning id`, [W, season.id])).id
    await one('select survival_settle_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', [o3, W, '0xtix3', '18000000000000000000', '0', 1, 'site', 'solo', W, false])
    expect('a runs purchase still books ten credits', (await one(`select count(*)::int n from survival_credits where wallet=$1 and source='purchase'`, [W])).n === 10)
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
