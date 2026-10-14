/**
 * Starts Droidz Survival Season 1 (owner, 14.10.2026): «первый сезон 15 дней, сегодня 1 день»,
 * beta results kept, the beta pool moves into the Season 1 pool, prices standard, the pass on sale
 * (the pass/ladder switch itself is the Vercel env SURVIVAL_SEASON_OPEN=1).
 *
 * One transaction:
 *   1. backup of the season tables to ~/apedroidz-backups/ (before anything is touched)
 *   2. Season 1 row `s1` ('Season 1', now → S1_ENDS, pays_out, the beta's curve and payout_pct)
 *   3. the beta pool carried over: one `rollover` ledger row per bucket into s1, ref 'beta-1'
 *   4. listed NFT prizes of the beta (none today) moved to s1
 *   5. beta-1 frozen as a record: status 'lock' + final_pool_ape / final_players / final_runs
 *   6. s1 live (one live season is a unique index: beta-1 is locked first)
 *   7. any finished sale cleared off the catalog
 *
 * Beta rows (runs, board, ledger, orders) are never touched; player progress (profiles) is kept.
 * Re-runnable: once s1 exists, it only carries over beta money booked after the last run (a beta
 * order paid late), so `--commit` again any time is safe.
 *
 *   node --env-file=.env.local scripts/start-season-1.mjs            # dry run, rolled back
 *   node --env-file=.env.local scripts/start-season-1.mjs --commit
 */
import pg from 'pg'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

const COMMIT = process.argv.includes('--commit')
const S1 = { id: 's1', name: 'Season 1', ends: '2026-10-29T17:00:00Z' }   // 15 days from 14.10
const BETA = 'beta-1'

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const rows = async (sql, p) => (await client.query(sql, p)).rows
const one = async (sql, p) => (await rows(sql, p))[0]
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])

// 1. backup first, outside the transaction
const dir = `${homedir()}/apedroidz-backups`
mkdirSync(dir, { recursive: true })
const backup = {}
for (const t of ['survival_seasons', 'survival_pool_ledger', 'survival_pool_prizes', 'survival_catalog']) backup[t] = await rows(`select * from ${t}`)
const file = `${dir}/season1-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, JSON.stringify(backup, null, 1))
console.log('backup →', file)

await client.query('begin')
try {
    const beta = await one('select * from survival_seasons where id=$1', [BETA])
    let s1 = await one('select * from survival_seasons where id=$1', [S1.id])
    if (!s1) {
        // 2. the season row, born 'upcoming' (the one-live index), with the beta's curve
        await client.query(`insert into survival_seasons
            (id, name, starts_at, ends_at, status, entry_fee_ape, split, curve_s, paid_pct_of_field, min_places, max_places,
             payout_pct, min_wallets, min_entry_pool_ape, seed_ape, seed_unlock_ratio, pays_out)
            values ($1, $2, now(), $3, 'upcoming', $4, $5, $6, $7, $8, $9, $10, 0, 0, 0, $11, true)`,
            [S1.id, S1.name, S1.ends, beta.entry_fee_ape, beta.split, beta.curve_s, beta.paid_pct_of_field, beta.min_places, beta.max_places, beta.payout_pct, beta.seed_unlock_ratio])
    }

    // 3. carry the beta pool over — only what is not carried yet (re-runnable)
    const byBucket = await rows(`
        with b as (select bucket, sum(amount_ape) a from survival_pool_ledger where season_id=$1 group by bucket),
             r as (select bucket, sum(amount_ape) a from survival_pool_ledger where season_id=$2 and source='rollover' and ref=$1 group by bucket)
        select b.bucket, (b.a - coalesce(r.a, 0))::numeric(20,6) due from b left join r using (bucket)`, [BETA, S1.id])
    for (const { bucket, due } of byBucket) {
        if (Number(due) > 0) await client.query(`insert into survival_pool_ledger (season_id, bucket, source, amount_ape, ref) values ($1, $2, 'rollover', $3, $4)`, [S1.id, bucket, due, BETA])
    }

    // 4. listed NFT prizes follow the pool
    const moved = (await client.query(`update survival_pool_prizes set season_id=$2 where season_id=$1 and status='listed'`, [BETA, S1.id])).rowCount

    // 5. + 6. freeze the beta as a record, then s1 live
    if (beta.status === 'live') {
        const st = await one('select * from survival_pool_stats($1)', [BETA])
        await client.query(`update survival_seasons set status='lock', ends_at=greatest(starts_at + interval '1 second', now()),
            final_pool_ape=$2, final_players=$3, final_runs=$4 where id=$1`,
            [BETA, Number(st.solo_ape) + Number(st.coop_ape), st.players, st.games])
    }
    await client.query(`update survival_seasons set status='live' where id=$1`, [S1.id])

    // 7. a finished sale leaves no trace in the catalog
    const cleared = (await client.query(`update survival_catalog set sale_pct=0, sale_until=null where sale_pct>0 and (sale_until is null or sale_until <= now())`)).rowCount

    // checks
    const live = await rows(`select id, name, status, ends_at, pays_out from survival_seasons where status='live'`)
    expect('exactly one live season: Season 1', live.length === 1 && live[0].id === S1.id && live[0].name === S1.name, JSON.stringify(live))
    expect('it ends 29.10 17:00 UTC and pays out', new Date(live[0]?.ends_at).toISOString() === new Date(S1.ends).toISOString() && live[0]?.pays_out === true)
    const b = await one(`select status, final_pool_ape::text p, final_players, final_runs from survival_seasons where id=$1`, [BETA])
    expect('the beta is locked with its final numbers kept', b.status === 'lock', JSON.stringify(b))
    const betaSum = await one(`select coalesce(sum(amount_ape),0)::text a from survival_pool_ledger where season_id=$1`, [BETA])
    const s1Roll = await one(`select coalesce(sum(amount_ape),0)::text a from survival_pool_ledger where season_id=$1 and source='rollover'`, [S1.id])
    expect('the whole beta pool is in Season 1', Number(betaSum.a) === Number(s1Roll.a), `beta ${betaSum.a} → s1 rollover ${s1Roll.a}`)
    const s1Stats = await one('select * from survival_pool_stats($1)', [S1.id])
    expect('the Season 1 pool shows it', Math.abs(Number(s1Stats.solo_ape) + Number(s1Stats.coop_ape) - Number(s1Roll.a)) < 1e-6, JSON.stringify(s1Stats))
    expect('beta runs untouched', Number((await one(`select count(*) n from survival_runs where season_id=$1`, [BETA])).n) >= 346)
    const cat = await rows(`select sku, price_ape::text p, active, sale_pct::text s, holder_discount_pct::text h from survival_catalog where sku in ('run','run10','season_pass')`)
    expect('standard prices, no sale; pass on sale with the holder discount',
        cat.every((c) => Number(c.s) === 0 && c.active) && cat.find((c) => c.sku === 'season_pass')?.h === '25.00', JSON.stringify(cat))
    console.log(`prizes moved: ${moved}, sale rows cleared: ${cleared}`)
} catch (e) {
    expect('script ran', false, e.message)
}
for (const [n, ok, info] of checks) console.log(ok ? '✓' : '✗', n, info ? `(${info})` : '')
const allOk = checks.length > 0 && checks.every((c) => c[1])
if (COMMIT && allOk) { await client.query('commit'); console.log('COMMITTED — Season 1 is live') }
else { await client.query('rollback'); console.log(COMMIT ? 'NOT committed: a check failed' : 'dry run — rolled back (pass --commit to apply)') }
await client.end()
