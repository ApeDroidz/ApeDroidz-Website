/**
 * Applies 20261011_site_settings.sql — the small key/value settings table (first key:
 * otherside_arcade.video_url). Dry run in a transaction by default; --commit to apply.
 *   node --env-file=.env.local scripts/apply-site-settings.mjs [--commit]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])
await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20261011_site_settings.sql', 'utf8'))
    const row = (await client.query(`select value->>'video_url' v from site_settings where key='otherside_arcade'`)).rows[0]
    expect('the arcade row is seeded with the current trailer', row?.v?.endsWith('beta-announce.mp4'), row?.v)
    const rls = (await client.query(`select relrowsecurity r from pg_class where relname='site_settings'`)).rows[0]
    expect('RLS is on', rls?.r === true)
    const anon = (await client.query(`select has_table_privilege('anon', 'public.site_settings', 'select') a`)).rows[0]
    expect('anon cannot read it', anon?.a === false)
    await client.query(readFileSync('supabase/migrations/20261011_site_settings.sql', 'utf8'))
    expect('re-running the migration is harmless', true)
} catch (e) {
    expect('migration ran', false, e.message)
}
for (const [n, ok, info] of checks) console.log(ok ? '✓' : '✗', n, info ? `(${info})` : '')
const allOk = checks.every((c) => c[1])
if (COMMIT && allOk) { await client.query('commit'); console.log('COMMITTED') }
else { await client.query('rollback'); console.log(COMMIT ? 'NOT committed: a check failed' : 'dry run — rolled back (pass --commit to apply)') }
await client.end()
