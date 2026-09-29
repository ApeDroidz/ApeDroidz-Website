/**
 * Applies 20260928_survival_pool_prizes.sql (NFT prizes of the season's prize pool).
 * Additive — a new empty table, its trigger, and the lucky ticket's guard redefined to also look at
 * it. The dry run applies it inside a transaction, checks the table and both triggers are there and
 * that no ticket NFT row changed, and rolls back.
 *
 *   node --env-file=.env.local scripts/apply-survival-pool-prizes.mjs           # dry run
 *   node --env-file=.env.local scripts/apply-survival-pool-prizes.mjs --commit  # apply
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (q) => (await client.query(q)).rows[0]
try {
    await client.query('begin')
    const before = await one("select count(*)::int as n, count(*) filter (where status='available')::int as avail from survival_ticket_nfts")
    await client.query(readFileSync('supabase/migrations/20260928_survival_pool_prizes.sql', 'utf8'))
    const table = await one("select count(*)::int as cols from information_schema.columns where table_name='survival_pool_prizes'")
    const trig = await one("select count(*)::int as n from pg_trigger where tgname in ('survival_pool_prize_not_elsewhere','survival_ticket_nft_not_in_glitch') and not tgisinternal")
    const after = await one("select count(*)::int as n, count(*) filter (where status='available')::int as avail from survival_ticket_nfts")
    const rows = await one('select count(*)::int as n from survival_pool_prizes')
    const ok = table.cols === 15 && trig.n === 2 && after.n === before.n && after.avail === before.avail && rows.n === 0
    console.log(ok ? 'PASS' : 'FAIL', { table, trig, before, after, rows })
    if (ok && COMMIT) { await client.query('commit'); console.log('committed') }
    else { await client.query('rollback'); console.log(COMMIT ? 'rolled back (checks failed)' : 'dry run — rolled back') }
} catch (e) { await client.query('rollback').catch(() => {}); console.error(e.message); process.exitCode = 1 } finally { await client.end() }
