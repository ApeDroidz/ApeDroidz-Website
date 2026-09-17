/**
 * Applies supabase/migrations/20260917_survival_beta_runs.sql to the live database.
 *
 * Requires the base survival schema (apply-survival-migration.mjs --commit) to be in place.
 * Additive only: columns with defaults, one index, one season row. Runs in a transaction,
 * proves the columns landed and exactly one season is live, then commits or rolls back.
 *
 *   node --env-file=.env.local scripts/apply-survival-beta.mjs           # dry run
 *   node --env-file=.env.local scripts/apply-survival-beta.mjs --commit  # apply
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const SQL = readFileSync('supabase/migrations/20260917_survival_beta_runs.sql', 'utf8')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const rows = async (q, p) => (await client.query(q, p)).rows

const base = await rows("select 1 from information_schema.tables where table_schema='public' and table_name='survival_runs'")
if (!base.length) { console.error('✗ survival_runs is missing — apply the base migration first'); process.exit(1) }

await client.query('begin')
try {
    await client.query(SQL)
    const cols = (await rows("select column_name from information_schema.columns where table_name='survival_runs'")).map((r) => r.column_name)
    for (const c of ['last_pulse_at', 'last_pulse_wave', 'last_pulse_kills', 'last_pulse_score', 'pulse_count', 'client_duration_ms', 'flags']) {
        if (!cols.includes(c)) throw new Error(`column ${c} did not land`)
    }
    const live = await rows("select id from survival_seasons where status='live'")
    if (live.length !== 1) throw new Error(`expected exactly one live season, got ${live.length}`)
    console.log('✓ columns present, live season:', live[0].id)
    if (COMMIT) { await client.query('commit'); console.log('✓ committed') }
    else { await client.query('rollback'); console.log('Dry run OK — rolled back. Re-run with --commit to apply.') }
} catch (e) {
    await client.query('rollback')
    console.error('✗', e.message)
    process.exit(1)
} finally {
    await client.end()
}
