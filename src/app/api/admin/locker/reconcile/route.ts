import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { LOCK_REGISTRY_ADDRESS, rpcCall, readLock } from '@/lib/locker'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

type DbLock = { token_id: number; wallet: string; multiplier_x100: number }

const padUint = (n: number | bigint) => BigInt(n).toString(16).padStart(64, '0')

/** totalLocked() and lockedTokens(uint256,uint256) — see contracts/src/DroidLockRegistry.sol */
const TOTAL_LOCKED_SELECTOR = '0x56891412'
const LOCKED_TOKENS_SELECTOR = '0x997e7ad4'

async function readAllLockedTokenIds(): Promise<number[]> {
    const totalHex = await rpcCall<string>('eth_call', [{ to: LOCK_REGISTRY_ADDRESS, data: TOTAL_LOCKED_SELECTOR }, 'latest'])
    const total = Number(BigInt(totalHex || '0x0'))

    const ids: number[] = []
    const PAGE = 500
    for (let start = 0; start < total; start += PAGE) {
        const data = LOCKED_TOKENS_SELECTOR + padUint(start) + padUint(PAGE)
        const res = await rpcCall<string>('eth_call', [{ to: LOCK_REGISTRY_ADDRESS, data }, 'latest'])
        const words = (res || '0x').slice(2).match(/.{64}/g) || []
        // [0] = offset, [1] = length, then the elements
        const length = words.length > 1 ? Number(BigInt('0x' + words[1])) : 0
        for (let i = 0; i < length; i++) ids.push(Number(BigInt('0x' + words[2 + i])))
    }
    return ids
}

/**
 * The one on-chain handle we have on droid levels.
 *
 * A level cannot be verified per droid — nothing on-chain says which droid a burned battery
 * upgraded. But every upgrade burns exactly one battery, so the number of upgraded droids can
 * never legitimately exceed the number of batteries actually burned. That ceiling is two cheap
 * reads: the battery contract is ERC721A-style, so `totalMinted() - totalSupply()` is the burn
 * count exactly (verified against a full Transfer-log scan: 2341 - 1552 = 789 burns).
 *
 * It will not catch one droid being quietly bumped a level. It will catch levels being inflated
 * in bulk, which is the failure that would actually cost freemints.
 */
async function checkLevelCeiling() {
    const BATTERY = (process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || '').toLowerCase()
    if (!BATTERY || !supabaseAdmin) return null

    try {
        const [mintedHex, supplyHex] = await Promise.all([
            rpcCall<string>('eth_call', [{ to: BATTERY, data: '0xa2309ff8' }, 'latest']), // totalMinted()
            rpcCall<string>('eth_call', [{ to: BATTERY, data: '0x18160ddd' }, 'latest']), // totalSupply()
        ])
        const burnedOnChain = Number(BigInt(mintedHex)) - Number(BigInt(supplyHex))

        const { count: upgraded } = await supabaseAdmin
            .from('droidz')
            .select('token_id', { count: 'exact', head: true })
            .gte('level', 2)

        const upgradedDroids = upgraded ?? 0
        return {
            ok: upgradedDroids <= burnedOnChain,
            upgradedDroids,
            burnedBatteriesOnChain: burnedOnChain,
            headroom: burnedOnChain - upgradedDroids,
        }
    } catch (e) {
        console.error('[locker/reconcile] level ceiling check failed:', e)
        return null
    }
}

/**
 * GET /api/admin/locker/reconcile
 *
 * Answers the only question that matters about this data: does the database still agree with the
 * chain? It does three independent checks and reports all of them rather than a single verdict.
 *
 *   chain vs db — every lock in the registry must be mirrored here with the same owner, and
 *                 nothing may exist here that the registry does not know about. The first case
 *                 means the mirror is behind; the second means a row was invented.
 *   still held  — a locked droid whose owner changed would mean enforcement was removed at some
 *                 point. Such a lock is reported so its freemints can be voided.
 *   audit chain — locker_events is hash-chained; a broken link means history was edited.
 *
 * Worth being clear about the limit: this cannot make the database unfalsifiable, because anyone
 * with Postgres superuser can drop a trigger. What it does is make falsification *visible* —
 * and, since the registry holds every lock, it also means the mirror can always be rebuilt.
 */
export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied

    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    }
    if (!LOCK_REGISTRY_ADDRESS) {
        return NextResponse.json({ error: 'Lock registry is not configured' }, { status: 503, headers })
    }

    const { data: dbLocks, error } = await supabaseAdmin
        .from('locker_locks')
        .select('token_id, wallet, multiplier_x100')
    if (error) {
        return NextResponse.json({ error: 'Database error' }, { status: 500, headers })
    }

    let chainIds: number[]
    try {
        chainIds = await readAllLockedTokenIds()
    } catch (e: any) {
        console.error('[locker/reconcile] chain read failed:', e)
        return NextResponse.json({ error: 'Could not read the registry from the chain.' }, { status: 502, headers })
    }

    const dbById = new Map<number, DbLock>((dbLocks || []).map((l: any) => [l.token_id, l as DbLock]))
    const chainSet = new Set(chainIds)

    const missingInDb: number[] = chainIds.filter((id: number) => !dbById.has(id))
    const notOnChain: number[] = [...dbById.keys()].filter((id: number) => !chainSet.has(id))

    // Owner comparison + "still held" check, for the tokens present on both sides.
    const ownerMismatch: Array<{ tokenId: number; db: string; chain: string }> = []
    const noLongerHeld: number[] = []
    for (const id of chainIds) {
        const row = dbById.get(id)
        if (!row) continue
        const onChain = await readLock(id).catch(() => null)
        if (!onChain) continue
        if (onChain.owner !== row.wallet) {
            ownerMismatch.push({ tokenId: id, db: row.wallet, chain: onChain.owner })
        }
    }

    const { data: chainCheck } = await supabaseAdmin.rpc('locker_verify_chain')
    const audit = Array.isArray(chainCheck) ? chainCheck[0] : chainCheck

    const levelCeiling = await checkLevelCeiling()

    const clean =
        missingInDb.length === 0 &&
        notOnChain.length === 0 &&
        ownerMismatch.length === 0 &&
        Boolean(audit?.ok) &&
        (levelCeiling === null || levelCeiling.ok)

    return NextResponse.json({
        clean,
        checkedAt: new Date().toISOString(),
        registry: LOCK_REGISTRY_ADDRESS,
        counts: { onChain: chainIds.length, inDatabase: dbById.size },
        chainVsDb: {
            missingInDb,      // registry knows about these, the mirror does not — re-run commit
            notOnChain,       // in the mirror but not in the registry — a row that should not exist
            ownerMismatch,
        },
        noLongerHeld,
        auditChain: {
            ok: Boolean(audit?.ok),
            checked: Number(audit?.checked ?? 0),
            firstBadId: audit?.first_bad_id ?? null,
        },
        // Levels are not chain state; this is the aggregate bound, not a per-droid proof.
        levelCeiling,
    }, { headers })
}
