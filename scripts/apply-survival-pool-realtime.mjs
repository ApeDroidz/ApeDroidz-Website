/**
 * Applies 20261015d_survival_pool_realtime.sql — every ledger row of the live season broadcasts the
 * fresh pool on the public Realtime channel `survival-pool`. The dry run books a throwaway row inside
 * a savepoint and checks the broadcast was queued with the right numbers; nothing of it is kept.
 *   node --env-file=.env.local scripts/apply-survival-pool-realtime.mjs [--commit]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const warnings = []
client.on('notice', (n) => { if (!/does not exist, skipping/.test(n.message)) warnings.push(n.message) })
const one = async (sql, p) => (await client.query(sql, p)).rows[0]
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])
await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20261015d_survival_pool_realtime.sql', 'utf8'))
    await client.query('savepoint probe')
    const season = await one("select id from survival_seasons where status='live' limit 1")
    const before = await one('select * from survival_pool_stats($1)', [season.id])
    await client.query(`insert into survival_pool_ledger (season_id, bucket, source, amount_ape, ref) values ($1, 'solo_pool', 'entry', 0.5, 'realtime-probe')`, [season.id])
    const msg = await one(`select topic, event, private, payload from realtime.messages where topic = 'survival-pool' order by inserted_at desc limit 1`)
    expect('a booking queues one broadcast on survival-pool / pool, public', msg?.event === 'pool' && msg.private === false, JSON.stringify(msg && { e: msg.event, p: msg.private }))
    expect('…carrying the new solo total', msg && Math.abs(Number(msg.payload.soloApe) - (Number(before.solo_ape) + 0.5)) < 1e-6, JSON.stringify(msg?.payload))
    expect('…and no ledger detail (no ref, no wallet)', msg && !('ref' in msg.payload) && !('wallet' in msg.payload))
    const n0 = (await one(`select count(*)::int n from realtime.messages where topic='survival-pool'`)).n
    await client.query(`insert into survival_pool_ledger (season_id, bucket, source, amount_ape, ref) values ('beta-1', 'solo_pool', 'entry', 0.5, 'realtime-probe')`)
    expect('a booking into a closed season sends nothing', (await one(`select count(*)::int n from realtime.messages where topic='survival-pool'`)).n === n0)
    expect('no warning from the trigger', warnings.length === 0, warnings.join(' | '))
    expect('anon cannot call the trigger function', (await one(`select has_function_privilege('anon', 'public.survival_pool_ledger_broadcast()', 'execute') a`)).a === false)
    await client.query('rollback to savepoint probe')
    expect('the probe left nothing behind', (await one(`select count(*)::int n from survival_pool_ledger where ref='realtime-probe'`)).n === 0)
} catch (e) { expect('migration ran', false, e.message) }
for (const [n, ok, info] of checks) console.log(ok ? '✓' : '✗', n, info ? `(${info})` : '')
const allOk = checks.length > 0 && checks.every((c) => c[1])
if (COMMIT && allOk) { await client.query('commit'); console.log('COMMITTED') }
else { await client.query('rollback'); console.log(COMMIT ? 'NOT committed: a check failed' : 'dry run — rolled back (pass --commit to apply)') }
await client.end()
