/**
 * Applies 20260926_survival_orders_dismissed.sql (the panel's «Close» for stuck orders).
 * Additive — one nullable column. The dry run applies it inside a transaction, checks the column
 * is there and that no order changed status, and rolls back.
 *
 *   node --env-file=.env.local scripts/apply-survival-orders-dismissed.mjs           # dry run
 *   node --env-file=.env.local scripts/apply-survival-orders-dismissed.mjs --commit  # apply
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (q) => (await client.query(q)).rows[0]
try {
    await client.query('begin')
    const before = await one("select count(*) filter (where status='pending')::int as pending, count(*) filter (where status='paid')::int as paid from survival_orders")
    await client.query(readFileSync('supabase/migrations/20260926_survival_orders_dismissed.sql', 'utf8'))
    const col = await one("select data_type, is_nullable from information_schema.columns where table_name='survival_orders' and column_name='dismissed_at'")
    const after = await one("select count(*) filter (where status='pending')::int as pending, count(*) filter (where status='paid')::int as paid, count(dismissed_at)::int as dismissed from survival_orders")
    const ok = col?.data_type === 'timestamp with time zone' && col.is_nullable === 'YES' && after.pending === before.pending && after.paid === before.paid && after.dismissed === 0
    console.log(ok ? 'PASS' : 'FAIL', { col, before, after })
    if (ok && COMMIT) { await client.query('commit'); console.log('committed') }
    else { await client.query('rollback'); console.log(COMMIT ? 'rolled back (checks failed)' : 'dry run — rolled back') }
} catch (e) { await client.query('rollback').catch(() => {}); console.error(e.message); process.exitCode = 1 } finally { await client.end() }
