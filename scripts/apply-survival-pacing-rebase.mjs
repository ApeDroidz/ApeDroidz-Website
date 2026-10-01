/**
 * Applies 20260929_survival_pacing_rebase.sql (the beta's savings rebased to the new pacing: Ape Mini
 * × 0.2 up to 6 000 (variant C, 30.09.2026), resources capped 400/100/100/5, everything opened kept, a backup table first).
 *
 * The dry run applies it inside a transaction, prints the ten richest profiles before and after,
 * checks the rules on EVERY profile (coins, caps, untouched fields, rev, backup), and rolls back.
 * Apply it only after the site + game build with the new pacing is live.
 *
 *   node --env-file=.env.local scripts/apply-survival-pacing-rebase.mjs           # dry run
 *   node --env-file=.env.local scripts/apply-survival-pacing-rebase.mjs --commit  # apply
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATION = new URL('../supabase/migrations/20260929_survival_pacing_rebase.sql', import.meta.url)
const CAP = { scrap: 400, circuit: 100, cell: 100, core: 5 }
const short = (w) => `${w.slice(0, 6)}…${w.slice(-4)}`
const res = (s) => ['scrap', 'circuit', 'cell', 'core'].map((k) => s?.resources?.[k] ?? 0).join('/')

/** `client`: a pg Client (or anything with query(sql) → { rows }; exec(sql) when it has one). */
export async function run(client, commit) {
    const all = async (q) => (await client.query(q)).rows
    const execAll = client.exec ? (s) => client.exec(s) : (s) => client.query(s)
    await client.query('begin')
    try {
        const already = (await all("select to_regclass('public.survival_profiles_pacing_backup') as t"))[0].t
        const before = Object.fromEntries((await all('select wallet, state, coins from survival_profiles')).map((r) => [r.wallet, r]))
        await execAll(readFileSync(MIGRATION, 'utf8'))
        const after = Object.fromEntries((await all('select wallet, state, coins from survival_profiles')).map((r) => [r.wallet, r]))
        const backup = Object.fromEntries((await all('select wallet, state, coins, rebased_at from survival_profiles_pacing_backup')).map((r) => [r.wallet, r]))

        const fails = []
        let changed = 0
        for (const [w, b] of Object.entries(before)) {
            const a = after[w]
            // A wallet rebased by an earlier run is left alone — compare it with itself.
            const wasDone = already && backup[w]?.rebased_at && JSON.stringify(a.state) === JSON.stringify(b.state)
            if (wasDone) continue
            changed += 1
            const c0 = typeof b.state?.coins === 'number' ? Math.max(0, b.state.coins) : 0
            if (a.state.coins !== Math.min(Math.floor(c0 * 0.2), 6000) || a.coins !== a.state.coins) fails.push(`${short(w)} coins ${b.state?.coins} → ${a.state.coins}/${a.coins}`)
            for (const [k, cap] of Object.entries(CAP)) {
                const v0 = typeof b.state?.resources?.[k] === 'number' ? Math.max(0, Math.floor(b.state.resources[k])) : 0
                if (a.state.resources?.[k] !== Math.min(v0, cap)) fails.push(`${short(w)} ${k} ${b.state?.resources?.[k]} → ${a.state.resources?.[k]}`)
            }
            for (const k of new Set([...Object.keys(b.state ?? {}), ...Object.keys(a.state)])) {
                if (!['coins', 'resources', 'rev'].includes(k) && JSON.stringify(a.state[k]) !== JSON.stringify(b.state?.[k])) fails.push(`${short(w)} touched ${k}`)
            }
            if (a.state.rev !== (typeof b.state?.rev === 'number' ? b.state.rev : 0) + 1) fails.push(`${short(w)} rev ${b.state?.rev} → ${a.state.rev}`)
            if (JSON.stringify(backup[w]?.state) !== JSON.stringify(b.state) || !backup[w]?.rebased_at) fails.push(`${short(w)} backup`)
        }

        const top = Object.values(before).sort((x, y) => (y.state?.coins ?? 0) - (x.state?.coins ?? 0)).slice(0, 10)
        console.log('the ten richest, before → after (Ape Mini; scrap/circuit/cell/core):')
        for (const b of top) {
            const a = after[b.wallet]
            console.log(`  ${short(b.wallet)}  ${String(b.state?.coins ?? 0).padStart(7)} → ${String(a.state.coins).padStart(6)}   ${res(b.state).padStart(18)} → ${res(a.state)}`)
        }
        const sum = (m) => Object.values(m).reduce((s, r) => s + (r.state?.coins ?? 0), 0)
        console.log(`profiles ${Object.keys(before).length}, rebased now ${changed}; Ape Mini in all saves ${sum(before)} → ${sum(after)}`)
        const ok = fails.length === 0
        console.log(ok ? 'PASS' : `FAIL (${fails.length}): ${fails.slice(0, 10).join('; ')}`)
        if (ok && commit) { await client.query('commit'); console.log('committed') }
        else { await client.query('rollback'); console.log(commit ? 'rolled back (checks failed)' : 'dry run — rolled back') }
        return ok
    } catch (e) {
        await client.query('rollback').catch(() => {})
        throw e
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const { default: pg } = await import('pg')
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
    await client.connect()
    try { process.exitCode = (await run(client, process.argv.includes('--commit'))) ? 0 : 1 }
    catch (e) { console.error(e.message); process.exitCode = 1 }
    finally { await client.end() }
}
