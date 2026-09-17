/** Applies 20260918_survival_progress_logs.sql (profiles, season progress, event journal). Additive. */
import pg from 'pg'
import { readFileSync } from 'node:fs'
const COMMIT = process.argv.includes('--commit')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20260918_survival_progress_logs.sql', 'utf8'))
    for (const t of ['survival_profiles', 'survival_profile_seasons', 'survival_events']) {
        const r = await client.query("select 1 from information_schema.tables where table_name=$1", [t])
        if (!r.rows.length) throw new Error(`${t} did not land`)
    }
    const anon = await client.query("select relrowsecurity from pg_class where relname='survival_events'")
    if (!anon.rows[0]?.relrowsecurity) throw new Error('RLS not enabled on survival_events')
    console.log('✓ profiles, season progress and the journal present; RLS on')
    if (COMMIT) { await client.query('commit'); console.log('✓ committed') } else { await client.query('rollback'); console.log('Dry run OK — rolled back.') }
} catch (e) { await client.query('rollback'); console.error('✗', e.message); process.exit(1) } finally { await client.end() }
