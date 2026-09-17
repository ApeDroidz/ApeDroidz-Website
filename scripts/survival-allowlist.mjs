/**
 * Manage the Droidz Survival closed-beta allowlist.
 *
 * The table is closed to everyone but service-role — deliberately, so the roster of testers is
 * not a public document — which means there is no UI for it and this is the way in.
 *
 *   node --env-file=.env.local scripts/survival-allowlist.mjs list
 *   node --env-file=.env.local scripts/survival-allowlist.mjs add 0xabc… "Vitalik, from Discord"
 *   node --env-file=.env.local scripts/survival-allowlist.mjs add-file wallets.txt "Wave 1"
 *   node --env-file=.env.local scripts/survival-allowlist.mjs revoke 0xabc…
 *   node --env-file=.env.local scripts/survival-allowlist.mjs restore 0xabc…
 *   node --env-file=.env.local scripts/survival-allowlist.mjs check 0xabc…
 *
 * Access is revoked, never deleted: who had the beta and when is worth keeping, and a deleted
 * row silently loses the note explaining why the person was invited.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const [cmd, ...rest] = process.argv.slice(2)
const WALLET_RE = /^0x[0-9a-f]{40}$/

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const norm = (w) => {
    const lower = String(w ?? '').trim().toLowerCase()
    if (!WALLET_RE.test(lower)) throw new Error(`not a wallet address: ${w}`)
    return lower
}

async function add(wallets, note) {
    const rows = await client.query(
        `insert into survival_allowlist (wallet, note, added_by)
         select unnest($1::text[]), $2, $3
         on conflict (wallet) do update set
             revoked_at = null,
             note = coalesce(excluded.note, survival_allowlist.note)
         returning wallet`,
        [wallets, note ?? null, process.env.USER ?? 'cli'])
    console.log(`✓ ${rows.rowCount} wallet(s) on the list`)
}

try {
    switch (cmd) {
        case 'list': {
            const { rows } = await client.query(
                `select wallet, note, added_at, revoked_at from survival_allowlist order by added_at desc`)
            if (!rows.length) { console.log('The allowlist is empty.'); break }
            console.table(rows.map((r) => ({
                wallet: r.wallet,
                status: r.revoked_at ? 'REVOKED' : 'active',
                note: r.note ?? '',
                added: r.added_at.toISOString().slice(0, 10),
            })))
            console.log(`${rows.filter((r) => !r.revoked_at).length} active of ${rows.length}`)
            break
        }
        case 'add':
            await add([norm(rest[0])], rest[1])
            break
        case 'add-file': {
            // One address per line; blank lines and #-comments ignored.
            const wallets = readFileSync(rest[0], 'utf8')
                .split('\n').map((l) => l.trim())
                .filter((l) => l && !l.startsWith('#'))
                .map(norm)
            if (!wallets.length) throw new Error(`${rest[0]} contained no addresses`)
            await add([...new Set(wallets)], rest[1])
            break
        }
        case 'revoke': {
            const r = await client.query(
                `update survival_allowlist set revoked_at = now() where wallet = $1 and revoked_at is null`,
                [norm(rest[0])])
            console.log(r.rowCount ? '✓ revoked' : 'nothing to revoke — not on the list, or already revoked')
            break
        }
        case 'restore': {
            const r = await client.query(
                `update survival_allowlist set revoked_at = null where wallet = $1`, [norm(rest[0])])
            console.log(r.rowCount ? '✓ restored' : 'not on the list at all — use `add`')
            break
        }
        case 'check': {
            const { rows } = await client.query(`select survival_has_access($1) as ok`, [norm(rest[0])])
            console.log(rows[0].ok ? '✓ has beta access' : '✗ no beta access')
            break
        }
        default:
            console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0].split('/**')[1]
                .replace(/^ \* ?/gm, '').trim())
            process.exitCode = 1
    }
} catch (e) {
    console.error('✗', e.message)
    process.exitCode = 1
} finally {
    await client.end()
}
