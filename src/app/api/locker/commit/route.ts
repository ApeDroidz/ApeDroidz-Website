import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireWalletAuth } from '@/lib/walletAuth'
import {
    DROID_LOCKED_TOPIC,
    LOCK_REGISTRY_ADDRESS,
    freemintsFromPoints,
    multiplierX100Of,
    rpcCall,
    readLock,
} from '@/lib/locker'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

type DroidRow = { token_id: number; level: number | null; is_super: boolean | null }

type LockRow = {
    token_id: number
    wallet: string
    level: number
    is_super: boolean
    multiplier_x100: number
    tx_hash: string
    block_number: number
    locked_at: string
}

type Receipt = {
    status: string
    to: string | null
    blockNumber: string
    logs: Array<{ address: string; topics: string[]; data: string }>
}

/**
 * POST /api/locker/commit  { txHash }
 *
 * Records a completed lock. Called by the page once the holder's transaction is mined.
 *
 * The client is not trusted with anything except the transaction hash. Which droids were locked,
 * who locked them and when are all read back out of the chain here:
 *
 *   1. the receipt must have succeeded and been sent to the lock registry;
 *   2. the token ids come from the registry's own `DroidLockedForever` logs, not from the body;
 *   3. the wallet in each log must match the authenticated session;
 *   4. every token is then re-read with `lockOf` as a second, independent confirmation.
 *
 * Multipliers are snapshotted from the droid's level at this moment, so a later trait recompute
 * cannot change what a holder was promised. Freemints are never stored as an editable figure —
 * they are derived from the sum of multipliers, floored over the wallet's whole history.
 */
export async function POST(request: NextRequest) {
    const auth = requireWalletAuth(request)
    if (auth instanceof Response) return auth
    const wallet = auth.wallet

    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    }
    if (!LOCK_REGISTRY_ADDRESS) {
        return NextResponse.json({ error: 'Lock registry is not configured' }, { status: 503, headers })
    }

    const body = await request.json().catch(() => ({}))
    const txHash = String(body?.txHash || '').trim().toLowerCase()
    if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
        return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400, headers })
    }

    // ── Idempotency: the page may retry after a flaky response ────────────────────────────────
    const { data: existing } = await supabaseAdmin
        .from('locker_batches')
        .select('*')
        .eq('tx_hash', txHash)
        .maybeSingle()

    if (existing) {
        if (existing.wallet !== wallet) {
            return NextResponse.json({ error: 'This transaction belongs to another wallet' }, { status: 403, headers })
        }
        return NextResponse.json({ ok: true, alreadyRecorded: true, batch: existing }, { headers })
    }

    // ── Read the transaction back off the chain ───────────────────────────────────────────────
    let receipt: Receipt | null
    try {
        receipt = await rpcCall<Receipt | null>('eth_getTransactionReceipt', [txHash])
    } catch (error) {
        console.error('[locker/commit] receipt read failed:', error)
        return NextResponse.json({ error: 'Could not reach the chain. Nothing was recorded — retry.' }, { status: 502, headers })
    }

    if (!receipt) {
        return NextResponse.json({ error: 'Transaction not found yet. Wait for it to be mined and retry.' }, { status: 409, headers })
    }
    if (BigInt(receipt.status || '0x0') !== BigInt(1)) {
        return NextResponse.json({ error: 'That transaction failed on-chain — nothing was locked.' }, { status: 400, headers })
    }
    if ((receipt.to || '').toLowerCase() !== LOCK_REGISTRY_ADDRESS) {
        return NextResponse.json({ error: 'That transaction was not sent to the lock registry.' }, { status: 400, headers })
    }

    // ── Token ids come from the registry's own events ─────────────────────────────────────────
    const locked: Array<{ tokenId: number; owner: string; lockedAt: number }> = []
    for (const log of receipt.logs || []) {
        if (log.address?.toLowerCase() !== LOCK_REGISTRY_ADDRESS) continue
        if (log.topics?.[0]?.toLowerCase() !== DROID_LOCKED_TOPIC) continue

        const tokenId = Number(BigInt(log.topics[1]))
        const owner = ('0x' + log.topics[2].slice(-40)).toLowerCase()
        const lockedAt = Number(BigInt(log.data || '0x0'))
        locked.push({ tokenId, owner, lockedAt })
    }

    if (locked.length === 0) {
        return NextResponse.json({ error: 'No lock events found in that transaction.' }, { status: 400, headers })
    }
    if (locked.some((l) => l.owner !== wallet)) {
        return NextResponse.json({ error: 'That transaction locked droids for a different wallet.' }, { status: 403, headers })
    }

    // Second, independent confirmation straight from registry storage. Logs alone would be enough
    // for an honest node, but this costs one call per droid and removes the need to trust the
    // receipt at all.
    for (const entry of locked) {
        const onChain = await readLock(entry.tokenId).catch(() => null)
        if (!onChain || onChain.owner !== wallet) {
            return NextResponse.json(
                { error: `Droid #${entry.tokenId} does not read as locked to your wallet on-chain.` },
                { status: 409, headers },
            )
        }
    }

    // ── Snapshot each droid's tier ────────────────────────────────────────────────────────────
    const tokenIds = locked.map((l) => l.tokenId)
    const { data: droidRows } = await supabaseAdmin
        .from('droidz')
        .select('token_id, level, is_super')
        .in('token_id', tokenIds)
    const rowsById = new Map<number, DroidRow>((droidRows || []).map((r: any) => [r.token_id, r as DroidRow]))

    const { data: totalsBefore } = await supabaseAdmin
        .from('locker_wallet_totals')
        .select('points_x100')
        .eq('wallet', wallet)
        .maybeSingle()
    const pointsBeforeX100 = totalsBefore?.points_x100 ?? 0

    const blockNumber = Number(BigInt(receipt.blockNumber))
    const rows = locked.map((entry): LockRow => {
        const droid = rowsById.get(entry.tokenId) || { level: 1, is_super: false }
        return {
            token_id: entry.tokenId,
            wallet,
            level: droid.level ?? 1,
            is_super: Boolean(droid.is_super),
            multiplier_x100: multiplierX100Of(droid),
            tx_hash: txHash,
            block_number: blockNumber,
            locked_at: new Date(entry.lockedAt * 1000).toISOString(),
        }
    })

    // `on conflict do nothing`: a droid can only be locked once, and the append-only trigger would
    // reject an update anyway. Re-running this route must be harmless.
    const { error: insertError } = await supabaseAdmin
        .from('locker_locks')
        .upsert(rows, { onConflict: 'token_id', ignoreDuplicates: true })
    if (insertError) {
        console.error('[locker/commit] lock insert failed:', insertError)
        return NextResponse.json({ error: 'Could not record the lock. It IS locked on-chain — contact us.' }, { status: 500, headers })
    }

    // Totals are re-read from the view rather than added up here, so the recorded figures are the
    // same ones the reporting will show.
    const { data: totalsAfter } = await supabaseAdmin
        .from('locker_wallet_totals')
        .select('points_x100')
        .eq('wallet', wallet)
        .maybeSingle()
    const pointsAfterX100 = totalsAfter?.points_x100 ?? pointsBeforeX100

    const batch = {
        tx_hash: txHash,
        wallet,
        token_ids: tokenIds,
        droid_count: tokenIds.length,
        points_x100: rows.reduce((sum: number, r: LockRow) => sum + r.multiplier_x100, 0),
        total_points_x100: pointsAfterX100,
        freemints_before: freemintsFromPoints(pointsBeforeX100),
        freemints_after: freemintsFromPoints(pointsAfterX100),
        block_number: blockNumber,
    }

    const { error: batchError } = await supabaseAdmin
        .from('locker_batches')
        .upsert(batch, { onConflict: 'tx_hash', ignoreDuplicates: true })
    if (batchError) {
        console.error('[locker/commit] batch insert failed:', batchError)
    }

    // Audit trail. The hash chain is sealed by a database trigger, so this row cannot claim a
    // hash of its own choosing.
    const { error: eventError } = await supabaseAdmin.from('locker_events').insert({
        kind: 'lock',
        wallet,
        payload: {
            txHash,
            blockNumber,
            tokenIds,
            tiers: rows.map((r: LockRow) => ({ tokenId: r.token_id, level: r.level, isSuper: r.is_super, multiplierX100: r.multiplier_x100 })),
            pointsBeforeX100,
            pointsAfterX100,
            freemintsBefore: batch.freemints_before,
            freemintsAfter: batch.freemints_after,
        },
    })
    if (eventError) console.error('[locker/commit] audit insert failed:', eventError)

    return NextResponse.json({
        ok: true,
        txHash,
        lockedTokenIds: tokenIds.map(String),
        droidCount: tokenIds.length,
        pointsAfterX100,
        freemintsBefore: batch.freemints_before,
        freemintsAfter: batch.freemints_after,
        freemintsGained: batch.freemints_after - batch.freemints_before,
        remainderX100: pointsAfterX100 % 100,
    }, { headers })
}
