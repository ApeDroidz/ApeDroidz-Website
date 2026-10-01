/**
 * Applies supabase/migrations/20260929_honorary_droidz_rls.sql (RLS on, anon/authenticated
 * grants revoked) to the live database, carefully:
 *
 *   1. records row counts of the watched tables and a checksum of honorary_droidz before;
 *   2. runs the file inside one transaction;
 *   3. proves inside savepoints that `set role anon` / `authenticated` can no longer
 *      select, update or delete honorary_droidz (each must fail with permission denied);
 *   4. proves the service role still reads all rows;
 *   5. checks relrowsecurity = true, the grants are gone and nothing changed in the data.
 *
 *   node --env-file=.env.local scripts/apply-honorary-droidz-rls.mjs          # dry run
 *   node --env-file=.env.local scripts/apply-honorary-droidz-rls.mjs --commit # apply
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const SQL_PATH = 'supabase/migrations/20260929_honorary_droidz_rls.sql'
const WATCHED_TABLES = ['droidz', 'batteries', 'glitch_users', 'honorary_droidz', 'users']
const EXPECTED_HONORARY_ROWS = 100

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const one = async (sql, params) => (await client.query(sql, params)).rows[0]

async function rowCounts() {
    const counts = {}
    for (const t of WATCHED_TABLES) {
        const r = await one(`select count(*)::int as n from ${t}`).catch(() => null)
        counts[t] = r ? r.n : 'missing'
    }
    return counts
}

// md5 over every row in a fixed order — any content change shows up.
const checksum = async () =>
    (await one(`select md5(coalesce(string_agg(h::text, '|' order by token_id), '')) as h from honorary_droidz h`)).h

// Runs `sql` as `role` inside a savepoint and returns true when it fails with permission denied.
async function deniedAs(role, sql) {
    await client.query('savepoint probe')
    try {
        await client.query(`set local role ${role}`)
        await client.query(sql)
        await client.query('rollback to savepoint probe')
        return false
    } catch (e) {
        await client.query('rollback to savepoint probe')
        return /permission denied/i.test(e.message)
    } finally {
        await client.query('reset role')
    }
}

console.log(`Mode: ${COMMIT ? 'APPLY (will commit)' : 'DRY RUN (will roll back)'}\n`)

const before = await rowCounts()
const sumBefore = await checksum()
console.log('✓ baseline row counts:', before)
if (before.honorary_droidz !== EXPECTED_HONORARY_ROWS) {
    console.log(`honorary_droidz has ${before.honorary_droidz} rows, expected ${EXPECTED_HONORARY_ROWS} — check before applying.`)
}

await client.query('begin')
let ok = false
try {
    await client.query(readFileSync(SQL_PATH, 'utf8'))
    console.log('✓ migration executed')

    const rls = await one(`select relrowsecurity from pg_class where oid = 'public.honorary_droidz'::regclass`)
    if (!rls.relrowsecurity) throw new Error('RLS is not enabled on honorary_droidz')
    console.log('✓ relrowsecurity = true')

    for (const role of ['anon', 'authenticated']) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
            const has = await one(`select has_table_privilege($1, 'public.honorary_droidz', $2) as v`, [role, priv])
            if (has.v) throw new Error(`${role} still has ${priv} on honorary_droidz`)
        }
        const probes = {
            select: `select * from honorary_droidz limit 1`,
            update: `update honorary_droidz set external_url = external_url where token_id = 1`,
            delete: `delete from honorary_droidz where token_id = -1`,
            insert: `insert into honorary_droidz (token_id) values (-1)`,
        }
        for (const [name, sql] of Object.entries(probes)) {
            if (!(await deniedAs(role, sql))) throw new Error(`${role} ${name} on honorary_droidz was NOT denied`)
        }
        console.log(`✓ ${role}: select/insert/update/delete denied`)
    }

    const svc = await one(`select count(*)::int as n from honorary_droidz`)
    if (svc.n !== before.honorary_droidz) throw new Error(`owner read ${svc.n} rows, expected ${before.honorary_droidz}`)
    const svcGrant = await one(`select has_table_privilege('service_role', 'public.honorary_droidz', 'UPDATE') as v`)
    if (!svcGrant.v) throw new Error('service_role lost UPDATE on honorary_droidz (display-pref would break)')
    console.log('✓ service_role keeps its grants')

    const after = await rowCounts()
    for (const t of WATCHED_TABLES) {
        if (String(before[t]) !== String(after[t])) throw new Error(`row count changed for ${t}: ${before[t]} → ${after[t]}`)
    }
    if ((await checksum()) !== sumBefore) throw new Error('honorary_droidz contents changed')
    console.log('✓ data untouched:', after)

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
