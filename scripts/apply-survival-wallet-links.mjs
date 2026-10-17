/**
 * Applies 20261017_survival_wallet_links.sql — one account, several wallets: the links, the unlink
 * history, the link codes, survival_link_redeem / survival_link_remove. The dry run links two QA
 * wallets inside a savepoint (a pass moves to the kept account, a used code stays used, unlink and
 * the 7-day cooldown) and checks anon cannot call either function; nothing of it is kept.
 *   node --env-file=.env.local scripts/apply-survival-wallet-links.mjs [--commit]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (sql, p) => (await client.query(sql, p)).rows[0]
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])
const A = '0x1111111111111111111111111111111111a10001'
const B = '0x1111111111111111111111111111111111a10002'
await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20261017_survival_wallet_links.sql', 'utf8'))
    await client.query('savepoint probe')
    for (const w of [A, B]) await client.query('insert into survival_players (wallet) values ($1) on conflict (wallet) do nothing', [w])
    // A pass on B, booked the way an order books it (an order row is required by the FK).
    const sid = (await one("select id from survival_seasons where status='live' limit 1"))?.id ?? null
    const order = await one(`insert into survival_orders (wallet, season_id, sku, kind, price_ape, min_wei, status) values ($1, $2, 'season_pass', 'season_pass', 1, 1, 'paid') returning id`, [B, sid])
    await client.query(`insert into survival_entitlements (wallet, order_id, sku, kind, season_id) values ($1, $2, 'season_pass', 'season_pass', $3)`, [B, order.id, sid])
    await client.query(`insert into survival_link_codes (code, wallet) values ('PROBE001', $1)`, [A])
    expect('redeem links B into A', (await one(`select survival_link_redeem('PROBE001', $1, $2) s`, [B, A])).s === 'ok')
    expect('…B points at A', (await one(`select account from survival_wallet_links where wallet = $1`, [B]))?.account === A)
    expect('…the pass moved to A', (await one(`select wallet from survival_entitlements where order_id = $1`, [order.id])).wallet === A)
    expect('…the code is used', (await one(`select survival_link_redeem('PROBE001', $1, $2) s`, [B, A])).s === 'used')
    expect('unlink B', (await one(`select survival_link_remove($1, $2) s`, [A, B])).s === 'ok')
    await client.query(`insert into survival_link_codes (code, wallet) values ('PROBE002', $1)`, [A])
    expect('…and B cannot rejoin for 7 days', (await one(`select survival_link_redeem('PROBE002', $1, $2) s`, [B, A])).s === 'cooldown')
    for (const f of ['survival_link_redeem(text, text, text, integer)', 'survival_link_remove(text, text)']) {
        expect(`anon cannot call ${f.split('(')[0]}`, (await one(`select has_function_privilege('anon', 'public.${f}', 'execute') a`)).a === false)
        expect(`authenticated cannot call ${f.split('(')[0]}`, (await one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') a`)).a === false)
    }
    for (const t of ['survival_wallet_links', 'survival_wallet_unlinks', 'survival_link_codes'])
        expect(`${t}: RLS on`, (await one(`select relrowsecurity r from pg_class where relname = $1`, [t])).r === true)
    await client.query('rollback to savepoint probe')
    expect('the probe left nothing behind', (await one(`select count(*)::int n from survival_players where wallet = any($1)`, [[A, B]])).n === 0)
} catch (e) { expect('migration ran', false, e.message) }
for (const [n, ok, info] of checks) console.log(ok ? '✓' : '✗', n, info ? `(${info})` : '')
const allOk = checks.length > 0 && checks.every((c) => c[1])
if (COMMIT && allOk) { await client.query('commit'); console.log('COMMITTED') }
else { await client.query('rollback'); console.log(COMMIT ? 'NOT committed: a check failed' : 'dry run — rolled back (pass --commit to apply)') }
await client.end()
