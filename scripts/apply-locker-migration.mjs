/**
 * Applies supabase/migrations/20260816_locker.sql to the live database, carefully.
 *
 * The migration is purely additive — new `locker_*` tables, a view and two functions — and touches
 * no existing table. This script proves that rather than assuming it:
 *
 *   1. refuses to run if anything named locker* already exists, so nothing is ever clobbered;
 *   2. records row counts of the existing tables before and after and aborts on any change;
 *   3. runs the whole file inside one transaction, so a failure anywhere leaves the database
 *      exactly as it was;
 *   4. verifies every expected object exists before committing.
 *
 *   node --env-file=.env.local scripts/apply-locker-migration.mjs          # dry run
 *   node --env-file=.env.local scripts/apply-locker-migration.mjs --commit # actually apply
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const SQL_PATH = 'supabase/migrations/20260816_locker.sql'

const WATCHED_TABLES = ['droidz', 'batteries', 'glitch_users', 'honorary_droidz', 'users', 'merge_logs']
const EXPECTED_TABLES = ['locker_locks', 'locker_batches', 'locker_events']
const EXPECTED_VIEWS = ['locker_wallet_totals']
const EXPECTED_FUNCTIONS = ['locker_reject_mutation', 'locker_events_seal', 'locker_verify_chain']

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const one = async (sql, params) => (await client.query(sql, params)).rows[0]
const all = async (sql, params) => (await client.query(sql, params)).rows

async function rowCounts() {
    const counts = {}
    for (const t of WATCHED_TABLES) {
        const r = await one(`select count(*)::int as n from ${t}`).catch(() => null)
        counts[t] = r ? r.n : 'missing'
    }
    return counts
}

console.log(`Mode: ${COMMIT ? 'APPLY (will commit)' : 'DRY RUN (will roll back)'}\n`)

// ── 1. nothing may be clobbered ──────────────────────────────────────────────────────────────
const existing = await all(`
  select table_name as name, 'table/view' as kind from information_schema.tables
   where table_schema='public' and table_name like 'locker%'
  union all
  select routine_name, 'function' from information_schema.routines
   where routine_schema='public' and routine_name like 'locker%'`)

if (existing.length > 0) {
    console.log('Objects named locker* already exist — refusing to run so nothing gets overwritten:')
    console.table(existing)
    await client.end()
    process.exit(1)
}
console.log('✓ no pre-existing locker* objects')

// ── 2. baseline ──────────────────────────────────────────────────────────────────────────────
const before = await rowCounts()
console.log('✓ baseline row counts:', before)

// ── 3. apply inside a transaction ────────────────────────────────────────────────────────────
const sql = readFileSync(SQL_PATH, 'utf8')
await client.query('begin')

let ok = false
try {
    await client.query(sql)
    console.log('✓ migration executed')

    const tables = (await all(
        `select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`,
        [EXPECTED_TABLES],
    )).map((r) => r.table_name)
    const views = (await all(
        `select table_name from information_schema.views where table_schema='public' and table_name = any($1)`,
        [EXPECTED_VIEWS],
    )).map((r) => r.table_name)
    const functions = (await all(
        `select routine_name from information_schema.routines where routine_schema='public' and routine_name = any($1)`,
        [EXPECTED_FUNCTIONS],
    )).map((r) => r.routine_name)

    const missing = [
        ...EXPECTED_TABLES.filter((t) => !tables.includes(t)),
        ...EXPECTED_VIEWS.filter((v) => !views.includes(v)),
        ...EXPECTED_FUNCTIONS.filter((f) => !functions.includes(f)),
    ]
    if (missing.length) throw new Error(`expected objects missing after migration: ${missing.join(', ')}`)
    console.log(`✓ created ${tables.length} tables, ${views.length} view, ${functions.length} functions`)

    // The append-only guard must actually bite.
    await client.query(`insert into locker_events (kind, wallet, payload, prev_hash, row_hash)
                        values ('note', null, '{"probe":true}'::jsonb, '', '')`)
    const sealed = await one(`select prev_hash, row_hash from locker_events order by id desc limit 1`)
    if (!/^[0-9a-f]{64}$/.test(sealed.row_hash)) throw new Error('hash chain trigger did not seal the row')
    console.log('✓ hash chain trigger seals inserts')

    let blocked = false
    try {
        await client.query(`update locker_events set kind = 'note' where true`)
    } catch { blocked = true }
    if (!blocked) throw new Error('append-only trigger did NOT block an update')
    console.log('✓ append-only trigger blocks updates')

    // Postgres aborts the transaction after that error; restart to finish verification cleanly.
    await client.query('rollback')
    await client.query('begin')
    await client.query(sql)

    const after = await rowCounts()
    for (const t of WATCHED_TABLES) {
        if (String(before[t]) !== String(after[t])) {
            throw new Error(`row count changed for ${t}: ${before[t]} → ${after[t]}`)
        }
    }
    console.log('✓ existing tables untouched:', after)

    ok = true
} catch (e) {
    console.error('\n✗ FAILED:', e.message)
}

if (ok && COMMIT) {
    await client.query('commit')
    console.log('\nCOMMITTED.')
} else {
    await client.query('rollback')
    console.log(ok ? '\nDry run OK — rolled back. Re-run with --commit to apply.' : '\nRolled back, database unchanged.')
}

await client.end()
process.exit(ok ? 0 : 1)
