/**
 * Exports the list of wallets that permanently locked ApeDroidz, with how many each locked.
 * This is the snapshot used to hand out the freemint on the next collection.
 *
 * Reads everything straight from the on-chain registry — no indexer, no database, no event
 * scanning — so the output can be reproduced by anyone holding only the registry address.
 *
 *   LOCK_REGISTRY=0x... node scripts/export-locked-droidz.mjs
 *
 * Writes lock-snapshot.csv and lock-snapshot.json next to the working directory.
 */

import { createPublicClient, http, getAddress } from "viem"
import { writeFileSync } from "node:fs"

const RPC_URL = process.env.APECHAIN_RPC_URL ?? "https://rpc.apechain.com/http"
const REGISTRY = process.env.LOCK_REGISTRY

if (!REGISTRY) {
    console.error("Set LOCK_REGISTRY to the deployed DroidLockRegistry address.")
    process.exit(1)
}

const REGISTRY_ABI = [
    {
        type: "function",
        name: "totalLocked",
        inputs: [],
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "lockedTokens",
        inputs: [{ type: "uint256" }, { type: "uint256" }],
        outputs: [{ type: "uint256[]" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "lockOf",
        inputs: [{ type: "uint256" }],
        outputs: [
            {
                type: "tuple",
                components: [
                    { name: "owner", type: "address" },
                    { name: "lockedAt", type: "uint64" },
                ],
            },
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "isStillHeld",
        inputs: [{ type: "uint256" }],
        outputs: [{ type: "bool" }],
        stateMutability: "view",
    },
]

const client = createPublicClient({ transport: http(RPC_URL) })
const registry = { address: getAddress(REGISTRY), abi: REGISTRY_ABI }

const read = (functionName, args = []) => client.readContract({ ...registry, functionName, args })

/** Runs `worker` over `items` with bounded concurrency, so we stay friendly to the public RPC. */
async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length)
    let cursor = 0
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++
            results[index] = await worker(items[index], index)
        }
    })
    await Promise.all(runners)
    return results
}

const total = await read("totalLocked")
console.log(`Locked droids on chain: ${total}`)

if (total === 0n) {
    console.log("Nothing locked yet — no snapshot written.")
    process.exit(0)
}

const PAGE = 500n
const tokenIds = []
for (let start = 0n; start < total; start += PAGE) {
    const page = await read("lockedTokens", [start, PAGE])
    tokenIds.push(...page)
    console.log(`  read ${tokenIds.length}/${total}`)
}

const records = await mapWithConcurrency(tokenIds, 12, async (tokenId) => {
    const [lock, stillHeld] = await Promise.all([read("lockOf", [tokenId]), read("isStillHeld", [tokenId])])
    return { tokenId, owner: getAddress(lock.owner), lockedAt: Number(lock.lockedAt), stillHeld }
})

const voided = records.filter((r) => !r.stillHeld)
if (voided.length > 0) {
    console.warn(`\n⚠  ${voided.length} lock(s) are no longer held by the locking wallet and are excluded:`)
    for (const r of voided) console.warn(`   token ${r.tokenId} — locked by ${r.owner}`)
}

const byWallet = new Map()
for (const record of records) {
    if (!record.stillHeld) continue
    const entry = byWallet.get(record.owner) ?? { wallet: record.owner, lockedCount: 0, tokenIds: [] }
    entry.lockedCount += 1
    entry.tokenIds.push(Number(record.tokenId))
    byWallet.set(record.owner, entry)
}

const wallets = [...byWallet.values()].sort((a, b) => b.lockedCount - a.lockedCount || a.wallet.localeCompare(b.wallet))
for (const entry of wallets) entry.tokenIds.sort((a, b) => a - b)

const csv = ["wallet,locked_count,token_ids"]
    .concat(wallets.map((e) => `${e.wallet},${e.lockedCount},"${e.tokenIds.join(" ")}"`))
    .join("\n")

const snapshot = {
    registry: getAddress(REGISTRY),
    takenAt: new Date().toISOString(),
    totalLocked: Number(total),
    countedLocks: records.filter((r) => r.stillHeld).length,
    excludedLocks: voided.length,
    wallets,
}

writeFileSync("lock-snapshot.csv", csv + "\n")
writeFileSync("lock-snapshot.json", JSON.stringify(snapshot, null, 2) + "\n")

console.log(`\n${wallets.length} wallet(s), ${snapshot.countedLocks} locked droid(s).`)
console.log("Wrote lock-snapshot.csv and lock-snapshot.json")
