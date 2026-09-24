/**
 * Applies 20260924_survival_ticket_nfts.sql — NFT prizes in the lucky ticket, from a pool of tokens.
 * Dry run (rolled back): an empty pool never drops; a pool of one drops once, reserves that token for
 * the winner and records it in the entitlement; a token held by Glitch Cards is refused; the same
 * ERC-721 cannot be pooled twice.
 *   node --env-file=.env.local scripts/apply-survival-ticket-nfts.mjs [--commit]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const COMMIT = process.argv.includes('--commit')
const W = '0x71c4e7' + 'b'.repeat(34)
const C = '0x' + 'c'.repeat(40)
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (sql, p) => (await client.query(sql, p)).rows[0]
const checks = []
const expect = (n, ok, info = '') => checks.push([n, !!ok, info])
const tries = async (sql, p) => { await client.query('savepoint t'); try { await client.query(sql, p); await client.query('release savepoint t'); return true } catch { await client.query('rollback to savepoint t'); return false } }

await client.query('begin')
try {
    await client.query(readFileSync('supabase/migrations/20260924_survival_ticket_nfts.sql', 'utf8'))
    await client.query('savepoint probe')
    await client.query(`update survival_ticket_prizes set active = (id = 'droid'), weight = 100 where id = 'droid'`)
    await client.query(`update survival_ticket_prizes set active = false where id <> 'droid'`)
    const empty = (await one(`select (survival_ticket_draw()).id as id`)).id
    expect('an NFT prize with an empty pool never drops', empty === null, String(empty))
    await client.query(`insert into survival_ticket_nfts (prize_id, contract, token_id, name) values ('droid', $1, '777', 'ApeDroidz #777')`, [C])
    expect('the same ERC-721 cannot be pooled twice', !(await tries(`insert into survival_ticket_nfts (prize_id, contract, token_id) values ('droid', $1, '777')`, [C])))
    const glitch = await one(`select contract_address, token_id from nft_inventory where status='available' limit 1`)
    if (glitch) expect('a token Glitch Cards holds as a prize is refused', !(await tries(`insert into survival_ticket_nfts (prize_id, contract, token_id) values ('droid', $1, $2)`, [glitch.contract_address.toLowerCase(), glitch.token_id])))
    const season = await one("select id from survival_seasons where status='live' limit 1")
    await client.query('insert into survival_players (wallet) values ($1)', [W])
    const mk = async () => (await one(`insert into survival_orders (wallet, season_id, sku, kind, credits, price_ape, min_wei, mode) values ($1,$2,'ticket','ticket',0,1,'1000000000000000000','solo') returning id`, [W, season.id])).id
    const o1 = await mk()
    await one('select survival_settle_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', [o1, W, '0xnft1', '1000000000000000000', '0', 1, 'site', 'solo', W, false])
    const e1 = await one(`select id, grant_spec from survival_entitlements where order_id=$1`, [o1])
    const row = await one(`select status, winner, entitlement_id from survival_ticket_nfts where token_id='777'`)
    expect('the pool of one drops: the entitlement names the token', e1?.grant_spec?.prize?.nft?.tokenId === '777' && e1.grant_spec.prize.label === 'ApeDroidz #777', JSON.stringify(e1?.grant_spec))
    expect('…and the token is reserved for the winner', row.status === 'reserved' && row.winner === W && row.entitlement_id === e1.id, JSON.stringify(row))
    const o2 = await mk()
    await one('select survival_settle_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r', [o2, W, '0xnft2', '1000000000000000000', '0', 1, 'site', 'solo', W, false])
    const e2 = await one(`select grant_spec from survival_entitlements where order_id=$1`, [o2])
    expect('with the pool empty again, the next ticket falls back to the Ape Mini floor', e2?.grant_spec?.prize?.id === 'fallback', JSON.stringify(e2?.grant_spec))
    await client.query('rollback to savepoint probe')
} catch (e) {
    expect('dry run did not throw', false, e.message)
}
const pass = checks.every(([, ok]) => ok)
await client.query(COMMIT && pass ? 'commit' : 'rollback')
await client.end()
for (const [n, ok, info] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '   ' + info}`)
console.log(pass ? (COMMIT ? '\n✅ APPLIED' : '\n✅ DRY RUN PASS (rolled back — run with --commit to apply)') : '\n❌ FAILED — nothing applied')
process.exit(pass ? 0 : 1)
