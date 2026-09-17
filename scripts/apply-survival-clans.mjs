/** Adds survival_players.clan. Additive, one column. `--commit` to apply, else dry run. */
import pg from 'pg'
import { readFileSync } from 'node:fs'
const COMMIT = process.argv.includes('--commit')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20260917_survival_clans.sql', 'utf8'))
    const r = await client.query("select 1 from information_schema.columns where table_name='survival_players' and column_name='clan'")
    if (!r.rows.length) throw new Error('column did not land')
    console.log('✓ survival_players.clan present')
    if (COMMIT) { await client.query('commit'); console.log('✓ committed') } else { await client.query('rollback'); console.log('Dry run OK — rolled back.') }
} catch (e) { await client.query('rollback'); console.error('✗', e.message); process.exit(1) } finally { await client.end() }
