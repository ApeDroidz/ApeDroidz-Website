/** Applies 20260918_survival_clans_contract.sql (contract + chain on survival_clans). `--commit` to apply. */
import pg from 'pg'
import { readFileSync } from 'node:fs'
const COMMIT = process.argv.includes('--commit')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect(); await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20260918_survival_clans_contract.sql', 'utf8'))
    const r = await client.query(
        `select column_name from information_schema.columns
          where table_name = 'survival_clans' and column_name in ('contract', 'chain')`)
    if (r.rows.length !== 2) throw new Error(`expected contract + chain on survival_clans, got ${r.rows.map((x) => x.column_name).join(', ') || 'neither'}`)
    const idx = await client.query(`select 1 from pg_indexes where indexname = 'survival_clans_contract'`)
    if (!idx.rows.length) throw new Error('index survival_clans_contract missing')
    const n = await client.query('select count(*)::int as n from survival_clans where contract is not null')
    console.log('✓ survival_clans has contract + chain;', n.rows[0].n, 'clans carry a contract')
    if (COMMIT) { await client.query('commit'); console.log('✓ committed') } else { await client.query('rollback'); console.log('Dry run OK — rolled back.') }
} catch (e) { await client.query('rollback'); console.error('✗', e.message); process.exit(1) } finally { await client.end() }
