/**
 * Audits Energy Battery burns against the chain, and compares them with the `batteries` table.
 *
 * The `batteries` table was seeded with every token up-front and burning is only a flag on the row,
 * so the flag is a claim rather than evidence. The chain is not: a burn is a Transfer to the zero
 * address, and those are all reconstructed here.
 *
 *   node --env-file=.env.local scripts/audit-battery-burns.mjs
 */
import pg from 'pg'

const RPC = process.env.APECHAIN_RPC_URL || 'https://rpc.apechain.com/http'
const BATTERY = (process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || '').toLowerCase()
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ZERO_TOPIC = '0x' + '0'.repeat(64)

if (!BATTERY) {
    console.error('NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS is not set')
    process.exit(1)
}

async function rpc(method, params) {
    const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const json = await res.json()
    if (json.error) throw new Error(`${method}: ${json.error.message}`)
    return json.result
}

const latest = Number(BigInt(await rpc('eth_blockNumber', [])))
console.log(`Battery contract : ${BATTERY}`)
console.log(`Scanning to block: ${latest.toLocaleString()}\n`)

const minted = new Map()   // tokenId -> block
const burned = new Map()   // tokenId -> { block, from }
let transfers = 0

/**
 * Windows are adaptive: the public RPC copes with millions of blocks in the sparse, recent range
 * but times out on busier stretches, so a timeout halves the window and retries rather than
 * aborting the scan. An audit that silently stops early would be worse than no audit.
 */
async function scan(from, to) {
    let logs
    try {
        logs = await rpc('eth_getLogs', [{
            address: BATTERY,
            topics: [TRANSFER],
            fromBlock: '0x' + from.toString(16),
            toBlock: '0x' + to.toString(16),
        }])
    } catch (e) {
        if (to - from < 2000) throw e // genuinely stuck, do not pretend otherwise
        const mid = Math.floor((from + to) / 2)
        await scan(from, mid)
        await scan(mid + 1, to)
        return
    }
    for (const log of logs) {
        transfers++
        const tokenId = Number(BigInt(log.topics[3]))
        const block = Number(BigInt(log.blockNumber))
        if (log.topics[1] === ZERO_TOPIC) minted.set(tokenId, block)
        if (log.topics[2] === ZERO_TOPIC) burned.set(tokenId, { block, from: '0x' + log.topics[1].slice(-40) })
    }
    process.stdout.write(`  scanned to ${to.toLocaleString()} — ${transfers} transfers, ${burned.size} burns\r`)
}

// Start at the contract's deployment block, found by binary search on eth_getCode. Scanning from
// genesis wastes minutes on empty history and makes the RPC time out on ranges that hold nothing.
async function deploymentBlock() {
    const hasCode = async (b) => (await rpc('eth_getCode', [BATTERY, '0x' + b.toString(16)])) !== '0x'
    let lo = 0, hi = latest
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (await hasCode(mid)) hi = mid; else lo = mid + 1
    }
    return lo
}

const start = await deploymentBlock()
console.log(`Contract deployed at block ${start.toLocaleString()} — scanning ${(latest - start).toLocaleString()} blocks\n`)

const STEP = 1_000_000
for (let from = start; from <= latest; from += STEP) {
    await scan(from, Math.min(latest, from + STEP - 1))
}
console.log(`\n\nTransfer events  : ${transfers}`)
console.log(`Minted (ever)    : ${minted.size}`)
console.log(`BURNED on-chain  : ${burned.size}`)

const burnedIds = [...burned.keys()].sort((a, b) => a - b)
console.log(`\nBurned token ids (${burnedIds.length}):`)
console.log(burnedIds.join(', '))

// ── Compare with the database ────────────────────────────────────────────────────────────────
if (!process.env.SUPABASE_DB_URL) {
    console.log('\nSUPABASE_DB_URL not set — skipping database comparison.')
    process.exit(0)
}

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const { rows } = await client.query('select token_id, is_burned from batteries')
await client.end()

const dbBurned = new Set(rows.filter((r) => r.is_burned).map((r) => Number(r.token_id)))
const dbAll = new Set(rows.map((r) => Number(r.token_id)))

const chainBurnedSet = new Set(burnedIds)
const burnedOnChainNotFlagged = burnedIds.filter((id) => !dbBurned.has(id))
const flaggedButNotBurned = [...dbBurned].filter((id) => !chainBurnedSet.has(id)).sort((a, b) => a - b)
const burnedButUnknownToDb = burnedIds.filter((id) => !dbAll.has(id))

console.log('\n── Database comparison ──────────────────────────────────')
console.log(`rows in batteries          : ${rows.length}`)
console.log(`flagged is_burned in db    : ${dbBurned.size}`)
console.log(`actually burned on-chain   : ${chainBurnedSet.size}`)
console.log(`\nburned on-chain, NOT flagged in db (${burnedOnChainNotFlagged.length}):`)
console.log(burnedOnChainNotFlagged.join(', ') || '  none')
console.log(`\nflagged in db, NOT burned on-chain (${flaggedButNotBurned.length}):`)
console.log(flaggedButNotBurned.join(', ') || '  none')
if (burnedButUnknownToDb.length) {
    console.log(`\nburned on-chain but missing from the table entirely (${burnedButUnknownToDb.length}):`)
    console.log(burnedButUnknownToDb.join(', '))
}

console.log('\nNote: a burned battery does not say which droid it upgraded — that link exists only in')
console.log('the application database, so this audit bounds the number of upgrades, not their targets.')
