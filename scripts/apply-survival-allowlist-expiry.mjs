/**
 * Applies supabase/migrations/20260919_survival_allowlist_expiry.sql to the live database.
 *
 * Additive: one nullable column on survival_allowlist and survival_has_access() replaced to
 * honour it. Inside the transaction it proves the rule with a throwaway wallet — expired →
 * no access, in the future → access, null → access — and deletes it again.
 *
 *   node --env-file=.env.local scripts/apply-survival-allowlist-expiry.mjs           # dry run
 *   node --env-file=.env.local scripts/apply-survival-allowlist-expiry.mjs --commit  # apply
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const SQL = readFileSync('supabase/migrations/20260919_survival_allowlist_expiry.sql', 'utf8')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const rows = async (q, p) => (await client.query(q, p)).rows
const PROBE = '0x' + 'e'.repeat(40)

await client.query('begin')
try {
    await client.query(SQL)
    const cols = (await rows("select column_name from information_schema.columns where table_name='survival_allowlist'")).map((r) => r.column_name)
    if (!cols.includes('expires_at')) throw new Error('column expires_at did not land')
    const has = async () => (await rows('select survival_has_access($1) as ok', [PROBE]))[0].ok
    await client.query('insert into survival_allowlist (wallet, note, added_by, expires_at) values ($1, $2, $3, now() - interval \'1 second\')', [PROBE, 'migration probe', 'apply-script'])
    if (await has() !== false) throw new Error('an expired wallet still has access')
    await client.query("update survival_allowlist set expires_at = now() + interval '1 hour' where wallet = $1", [PROBE])
    if (await has() !== true) throw new Error('a wallet with time left has no access')
    await client.query('update survival_allowlist set expires_at = null where wallet = $1', [PROBE])
    if (await has() !== true) throw new Error('a wallet with no expiry has no access')
    await client.query('delete from survival_allowlist where wallet = $1', [PROBE])
    const active = (await rows('select count(*)::int as n from survival_allowlist where revoked_at is null'))[0].n
    console.log(`✓ expires_at present, has_access honours it; ${active} active wallet(s) untouched (all bessrochno)`)
    if (COMMIT) { await client.query('commit'); console.log('✓ committed') }
    else { await client.query('rollback'); console.log('Dry run OK — rolled back. Re-run with --commit to apply.') }
} catch (e) {
    await client.query('rollback')
    console.error('✗', e.message)
    process.exit(1)
} finally {
    await client.end()
}
