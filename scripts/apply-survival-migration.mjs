/**
 * Applies supabase/migrations/20260912_survival_prize_pool.sql to the live database, carefully.
 *
 * The migration is purely additive — new `survival_*` tables, two views, two functions — and
 * touches nothing that exists. This script proves that rather than assuming it, the same way
 * apply-locker-migration.mjs does:
 *
 *   1. refuses to run if anything named survival* already exists;
 *   2. records row counts of the existing tables before and after and aborts on any change;
 *   3. runs the whole file inside one transaction, so a failure leaves the database as it was;
 *   4. exercises the invariants that the money depends on — append-only ledger, one live season,
 *      the season_best tie-break, anon lockout — before committing.
 *
 *   node --env-file=.env.local scripts/apply-survival-migration.mjs          # dry run
 *   node --env-file=.env.local scripts/apply-survival-migration.mjs --commit # actually apply
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const SQL_PATH = 'supabase/migrations/20260912_survival_prize_pool.sql'

const WATCHED_TABLES = ['droidz', 'batteries', 'glitch_users', 'honorary_droidz', 'users', 'merge_logs', 'locker_locks']
const EXPECTED_TABLES = [
    'survival_seasons', 'survival_players', 'survival_payments', 'survival_credits',
    'survival_runs', 'survival_season_best', 'survival_pool_ledger',
    'survival_envelope_bounds', 'survival_payouts', 'survival_allowlist',
]
const EXPECTED_VIEWS = ['survival_menu_stats', 'survival_board']
const EXPECTED_FUNCTIONS = ['survival_pool_ledger_append_only', 'survival_apply_run_to_best', 'survival_has_access']

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

/** Runs `fn`, returns true if it threw. Used to assert a guard actually bites. */
async function refuses(fn) {
    await client.query('savepoint probe')
    try {
        await fn()
        await client.query('release savepoint probe')
        return false
    } catch {
        await client.query('rollback to savepoint probe')
        return true
    }
}

/**
 * `all` that survives a permission denial.
 *
 * A plain .catch() is not enough here: in Postgres a failed statement poisons the whole
 * transaction, so the first denied SELECT took the rest of the verification down with it and
 * the run reported "current transaction is aborted" instead of a verdict. Every probe that is
 * EXPECTED to fail has to sit on its own savepoint.
 */
async function tryAll(sql, params) {
    await client.query('savepoint probe')
    try {
        const rows = await all(sql, params)
        await client.query('release savepoint probe')
        return rows
    } catch {
        await client.query('rollback to savepoint probe')
        return 'denied'
    }
}

console.log(`Mode: ${COMMIT ? 'APPLY (will commit)' : 'DRY RUN (will roll back)'}\n`)

// ── 1. nothing may be clobbered ──────────────────────────────────────────────────────────────
const existing = await all(`
  select table_name as name, 'table/view' as kind from information_schema.tables
   where table_schema='public' and table_name like 'survival%'
  union all
  select routine_name, 'function' from information_schema.routines
   where routine_schema='public' and routine_name like 'survival%'`)

if (existing.length > 0) {
    console.log('Objects named survival* already exist — refusing to run so nothing gets overwritten:')
    console.table(existing)
    await client.end()
    process.exit(1)
}
console.log('✓ no pre-existing survival* objects')

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
    console.log(`✓ created ${tables.length} tables, ${views.length} views, ${functions.length} functions`)

    // ── 4. the invariants the money rests on ─────────────────────────────────────────────────
    await client.query(`
      insert into survival_seasons (id, name, starts_at, ends_at, status, seed_ape)
      values ('T0','probe', now() - interval '1 day', now() + interval '13 days', 'live', 500)`)

    if (!await refuses(() => client.query(`
        insert into survival_seasons (id, name, starts_at, ends_at, status)
        values ('T1','probe2', now(), now() + interval '1 day', 'live')`))) {
        throw new Error('two seasons were allowed to be live at once')
    }
    console.log('✓ only one season can be live')

    const W1 = '0x' + '1'.repeat(40)
    const W2 = '0x' + '2'.repeat(40)
    await client.query(`insert into survival_players (wallet) values ($1), ($2)`, [W1, W2])

    if (!await refuses(() => client.query(
        `insert into survival_players (wallet) values ($1)`, ['0x' + 'A'.repeat(40)]))) {
        throw new Error('an uppercase wallet was accepted; addresses must be normalised')
    }
    console.log('✓ wallets are forced lowercase 0x…')

    await client.query(`
      insert into survival_pool_ledger (season_id, bucket, source, amount_ape)
      values ('T0','season_pool','seed', 500), ('T0','season_pool','entry', 0.425)`)

    if (!await refuses(() => client.query(`update survival_pool_ledger set amount_ape = 999999 where true`))) {
        throw new Error('the pool ledger accepted an UPDATE — it is not append-only')
    }
    if (!await refuses(() => client.query(`delete from survival_pool_ledger where true`))) {
        throw new Error('the pool ledger accepted a DELETE — it is not append-only')
    }
    console.log('✓ pool ledger refuses UPDATE and DELETE')

    if (!await refuses(() => client.query(`
        insert into survival_pool_ledger (season_id, bucket, source, amount_ape)
        values ('T0','season_pool','entry', -5)`))) {
        throw new Error('a negative non-payout entry was accepted; only payouts may drain the pool')
    }
    console.log('✓ only payouts can reduce the pool')

    // season_best: higher score replaces, equal score does NOT steal the earlier tie-break.
    const mkRun = async (wallet, score, finishedAt) => {
        const r = await one(
            `insert into survival_runs (season_id, wallet, status, score, wave, kills, finished_at)
             values ('T0', $1, 'finished', $2, 3, 10, $3) returning id`, [wallet, score, finishedAt])
        return r.id
    }
    await mkRun(W1, 1000, '2026-09-10T10:00:00Z')
    await mkRun(W1, 500, '2026-09-10T11:00:00Z')   // worse: must not overwrite
    const best1 = await one(`select score, runs_count, achieved_at from survival_season_best where wallet=$1`, [W1])
    if (best1.score !== 1000) throw new Error(`a worse run overwrote the best: ${best1.score}`)
    if (best1.runs_count !== 2) throw new Error(`runs_count is ${best1.runs_count}, expected 2`)

    await mkRun(W1, 1000, '2026-09-10T12:00:00Z')  // equal: must not move the tie-break
    const best2 = await one(`select achieved_at from survival_season_best where wallet=$1`, [W1])
    if (best2.achieved_at.toISOString() !== best1.achieved_at.toISOString()) {
        throw new Error('an equal score moved achieved_at; the tie-break must favour whoever got there first')
    }
    await mkRun(W1, 4000, '2026-09-10T13:00:00Z')
    await mkRun(W2, 2000, '2026-09-10T09:00:00Z')
    const best3 = await one(`select score, runs_count from survival_season_best where wallet=$1`, [W1])
    if (best3.score !== 4000 || best3.runs_count !== 4) {
        throw new Error(`best did not track the improvement: ${JSON.stringify(best3)}`)
    }
    console.log('✓ season_best keeps the highest score and the earliest tie-break')

    const board = await all(`select rank, wallet_short, score from survival_board where season_id='T0' order by rank`)
    if (board.length !== 2 || board[0].score !== 4000 || board[0].rank !== '1') {
        throw new Error(`board ranked wrong: ${JSON.stringify(board)}`)
    }
    if (board[0].wallet_short.includes('1'.repeat(20))) throw new Error('the board leaks full wallet addresses')
    console.log('✓ board ranks correctly and shows only shortened wallets')

    const stats = await one(`select * from survival_menu_stats where season_id='T0'`)
    if (Number(stats.pool_ape) !== 500.425) throw new Error(`pool_ape is ${stats.pool_ape}, expected 500.425`)
    if (Number(stats.entry_pool_ape) !== 0.425) throw new Error(`entry_pool_ape is ${stats.entry_pool_ape}`)
    if (Number(stats.total_players) !== 2) throw new Error(`total_players is ${stats.total_players}`)
    if (Number(stats.total_runs) !== 5) throw new Error(`total_runs is ${stats.total_runs}`)
    if (stats.paying_places !== 3) throw new Error(`paying_places is ${stats.paying_places}, expected the floor of 3`)
    if (stats.pays_out !== false) throw new Error('a new season defaulted to paying out; it must default to false')
    console.log('✓ menu_stats sums the ledger and clamps paying places')

    // Beta gate: a yes/no on one address is public, the roster itself is not.
    await client.query(
        `insert into survival_allowlist (wallet, note) values ($1, 'probe'), ($2, 'probe revoked')`,
        [W1, W2])
    await client.query(`update survival_allowlist set revoked_at = now() where wallet = $1`, [W2])

    // anon must not be able to read money or write anything.
    await client.query(`set local role anon`)
    const anonPool = await tryAll(`select * from survival_pool_ledger`)
    const anonWrite = await refuses(() => client.query(
        `insert into survival_season_best (season_id, wallet, run_id, score, achieved_at)
         values ('T0','${W1}', gen_random_uuid(), 999999, now())`))
    const anonBoard = await tryAll(`select rank from survival_board where season_id='T0'`)
    const anonRoster = await tryAll(`select wallet from survival_allowlist`)
    const anonGate = await tryAll(`
        select survival_has_access($1)             as allowed,
               survival_has_access($2)             as revoked,
               survival_has_access($3)             as stranger,
               survival_has_access(upper($1))      as mixed_case`,
        [W1, W2, '0x' + '9'.repeat(40)])
    await client.query(`reset role`)

    if (anonPool !== 'denied' && anonPool.length > 0) throw new Error('anon can read the pool ledger')
    if (!anonWrite) throw new Error('anon can write to the leaderboard')
    if (anonBoard === 'denied') throw new Error('anon cannot read the public board it is supposed to see')
    console.log('✓ anon reads the board, cannot read the ledger, cannot write')

    if (anonRoster !== 'denied' && anonRoster.length > 0) throw new Error('anon can enumerate the beta allowlist')
    if (anonGate[0].allowed !== true) throw new Error('an allowlisted wallet was refused by survival_has_access')
    if (anonGate[0].revoked !== false) throw new Error('a revoked wallet still passes the gate')
    if (anonGate[0].stranger !== false) throw new Error('an unknown wallet passes the gate')
    if (anonGate[0].mixed_case !== true) throw new Error('the gate is case-sensitive; wallets arrive in any casing')
    console.log('✓ beta gate answers per-address, honours revocation, and hides the roster')

    // Postgres is fine here (no aborted transaction), but the probe rows must not survive.
    await client.query('rollback')
    await client.query('begin')
    await client.query(sql)
    console.log('✓ probe data discarded, schema re-applied clean')

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
