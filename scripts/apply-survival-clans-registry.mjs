/** Applies 20260918_survival_clans_registry.sql (the clan registry + seed). `--commit` to apply. */
import pg from 'pg'
import { readFileSync } from 'node:fs'
const COMMIT = process.argv.includes('--commit')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect(); await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20260918_survival_clans_registry.sql', 'utf8'))
    const r = await client.query('select count(*)::int as n from survival_clans where active')
    if (r.rows[0].n < 11) throw new Error(`expected 11 clans, got ${r.rows[0].n}`)
    console.log('✓ survival_clans present with', r.rows[0].n, 'clans')
    if (COMMIT) { await client.query('commit'); console.log('✓ committed') } else { await client.query('rollback'); console.log('Dry run OK — rolled back.') }
} catch (e) { await client.query('rollback'); console.error('✗', e.message); process.exit(1) } finally { await client.end() }
