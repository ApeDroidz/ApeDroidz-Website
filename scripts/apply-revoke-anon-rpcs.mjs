/**
 * Applies 20260929_revoke_anon_definer_rpcs.sql (server-only RPCs closed to the anon key).
 *
 * Dry run by default: applies inside a transaction, checks, rolls back. --commit applies.
 * Writes to the production database only with --commit — owner's explicit go-ahead first.
 *
 * Checks, all inside the transaction:
 *   1. no SECURITY DEFINER function in public is executable by anon, except survival_has_access;
 *   2. none of the listed functions is executable by anon, authenticated or PUBLIC;
 *   3. service_role can still execute every one of them;
 *   4. as role anon, admin_lifetime_totals() fails with 42501 (permission denied);
 *   5. as role anon, survival_has_access(text) still works;
 *   6. a function created after the migration is not executable by anon/authenticated.
 *
 *   node --env-file=.env.local scripts/apply-revoke-anon-rpcs.mjs           # dry run
 *   node --env-file=.env.local scripts/apply-revoke-anon-rpcs.mjs --commit  # actually apply
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const SQL_PATH = 'supabase/migrations/20260929_revoke_anon_definer_rpcs.sql'
const ALLOWED_ANON = ['survival_has_access']

const sql = readFileSync(SQL_PATH, 'utf8')
const closed = [...sql.matchAll(/^REVOKE ALL ON FUNCTION (public\.[a-z0-9_]+\([^)]*\))/gm)].map((m) => m[1])

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const checks = []
const expect = (name, ok, detail = '') => checks.push([name, !!ok, ok ? '' : detail])

await client.query('begin')
try {
    await client.query(sql)

    // 1.
    const open = (await client.query(`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
        order by 1`)).rows.map((r) => r.proname)
    const extra = open.filter((n) => !ALLOWED_ANON.includes(n))
    expect('definer-функции для anon: только survival_has_access', extra.length === 0, `ещё открыты: ${extra.join(', ')}`)

    // 2. and 3.
    for (const sig of closed) {
        const r = (await client.query(`
            select has_function_privilege('anon', $1::regprocedure, 'EXECUTE') anon,
                   has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') auth,
                   exists (select 1 from aclexplode((select proacl from pg_proc where oid = $1::regprocedure))
                           where grantee = 0 and privilege_type = 'EXECUTE') pub,
                   has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') svc`, [sig])).rows[0]
        expect(`${sig} закрыта`, !r.anon && !r.auth && !r.pub, JSON.stringify(r))
        expect(`${sig} доступна service_role`, r.svc, JSON.stringify(r))
    }

    // 4.
    await client.query('savepoint as_anon')
    let code = null
    try {
        await client.query('set local role anon')
        await client.query('select * from public.admin_lifetime_totals()')
    } catch (e) { code = e.code }
    await client.query('rollback to savepoint as_anon')
    expect('anon → admin_lifetime_totals = 42501', code === '42501', `код ${code}`)

    // 5.
    await client.query('savepoint as_anon2')
    let accessErr = null
    try {
        await client.query('set local role anon')
        await client.query(`select public.survival_has_access('0x0000000000000000000000000000000000000000')`)
    } catch (e) { accessErr = e.code ?? e.message }
    await client.query('rollback to savepoint as_anon2')
    expect('anon → survival_has_access работает', accessErr === null, `ошибка ${accessErr}`)

    // 6.
    await client.query('create function public.__revoke_probe() returns int language sql as $$ select 1 $$')
    const probe = (await client.query(`
        select has_function_privilege('anon', 'public.__revoke_probe()'::regprocedure, 'EXECUTE') anon,
               has_function_privilege('authenticated', 'public.__revoke_probe()'::regprocedure, 'EXECUTE') auth,
               has_function_privilege('service_role', 'public.__revoke_probe()'::regprocedure, 'EXECUTE') svc`)).rows[0]
    expect('новая функция закрыта для anon/authenticated', !probe.anon && !probe.auth, JSON.stringify(probe))
    expect('новая функция доступна service_role', probe.svc, JSON.stringify(probe))
    await client.query('drop function public.__revoke_probe()')
} catch (e) {
    await client.query('rollback')
    await client.end()
    console.error('FAILED before checks finished:', e.message)
    process.exit(1)
}

const failed = checks.filter(([, ok]) => !ok)
for (const [name, ok, detail] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
console.log(`${closed.length} functions in the migration, ${checks.length} checks, ${failed.length} failed`)

if (failed.length || !COMMIT) {
    await client.query('rollback')
    console.log(failed.length ? 'rolled back (checks failed)' : 'dry run — rolled back')
} else {
    await client.query('commit')
    console.log('COMMITTED')
}
await client.end()
process.exit(failed.length ? 1 : 0)
