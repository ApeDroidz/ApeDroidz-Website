/**
 * Applies 20261015_survival_welcome_runs.sql — 3 free full runs for a new wallet. The dry run
 * walks a throwaway wallet through it inside a savepoint; nothing of it is ever kept.
 *   node --env-file=.env.local scripts/apply-survival-welcome-runs.mjs [--commit]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const NEW = '0x0e1c0e' + 'a'.repeat(34), OLD = '0x0e1c0e' + 'b'.repeat(34)
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (sql, p) => (await client.query(sql, p)).rows[0]
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])
await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20261015_survival_welcome_runs.sql', 'utf8'))
    await client.query('savepoint probe')
    await client.query('insert into survival_players (wallet) values ($1), ($2)', [NEW, OLD])
    const season = await one("select id from survival_seasons where status='live' limit 1")
    await client.query(`insert into survival_runs (season_id, wallet, status, mode) values ($1, $2, 'finished', 'solo')`, [season.id, OLD])
    expect('a new wallet gets 3 runs', (await one('select survival_grant_welcome($1) n', [NEW])).n === 3)
    expect('…once', (await one('select survival_grant_welcome($1) n', [NEW])).n === 0)
    const c = await one(`select count(*)::int n, min(mode) m, min(season_id) s from survival_credits where wallet=$1 and source='welcome' and consumed_by_run is null`, [NEW])
    expect('…as 3 unplayed solo credits of the live season', c.n === 3 && c.m === 'solo' && c.s === season.id, JSON.stringify(c))
    expect('a wallet that already played gets none', (await one('select survival_grant_welcome($1) n', [OLD])).n === 0)
    expect('an unknown wallet gets none', (await one('select survival_grant_welcome($1) n', ['0x' + 'c'.repeat(40)])).n === 0)
    expect('anon cannot call it', (await one(`select has_function_privilege('anon', 'public.survival_grant_welcome(text,int)', 'execute') a`)).a === false)
    await client.query('rollback to savepoint probe')
    const left = await one(`select count(*)::int n from survival_credits where wallet in ($1,$2)`, [NEW, OLD])
    expect('the probe left nothing behind', left.n === 0)
} catch (e) { expect('migration ran', false, e.message) }
for (const [n, ok, info] of checks) console.log(ok ? '✓' : '✗', n, info ? `(${info})` : '')
const allOk = checks.length > 0 && checks.every((c) => c[1])
if (COMMIT && allOk) { await client.query('commit'); console.log('COMMITTED') }
else { await client.query('rollback'); console.log(COMMIT ? 'NOT committed: a check failed' : 'dry run — rolled back (pass --commit to apply)') }
await client.end()
