import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
    LOCK_REGISTRY_ADDRESS,
    freemintsFromPoints,
    multiplierX100Of,
    tierOf,
} from '@/lib/locker'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

type DroidRow = { token_id: number; level: number | null; is_super: boolean | null }

/**
 * GET /api/locker/state?owner=0x...
 *
 * The wallet's Locker standing: which of its droids are already locked forever, how many points
 * and freemints it holds, and the multiplier each remaining droid is worth.
 *
 * Totals come from `locker_wallet_totals`, a view derived from the locks themselves — there is no
 * stored "freemints" number anyone could edit. Lock rows only ever get written after the server
 * has read the lock back off the chain, so this endpoint reports mirrored chain state, not claims.
 */
export async function GET(request: NextRequest) {
    const owner = request.nextUrl.searchParams.get('owner')?.trim().toLowerCase()
    if (!owner || !/^0x[a-f0-9]{40}$/.test(owner)) {
        return NextResponse.json({ error: 'Invalid owner address' }, { status: 400, headers })
    }
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    }

    const [{ data: totals }, { data: locks, error: locksError }] = await Promise.all([
        supabaseAdmin.from('locker_wallet_totals').select('*').eq('wallet', owner).maybeSingle(),
        supabaseAdmin
            .from('locker_locks')
            .select('token_id, level, is_super, multiplier_x100, tx_hash, locked_at')
            .eq('wallet', owner)
            .order('locked_at', { ascending: false }),
    ])

    if (locksError) {
        console.error('[locker/state] db error:', locksError)
        return NextResponse.json({ error: 'Database error' }, { status: 500, headers })
    }

    const pointsX100 = totals?.points_x100 ?? 0

    return NextResponse.json({
        registryConfigured: Boolean(LOCK_REGISTRY_ADDRESS),
        registry: LOCK_REGISTRY_ADDRESS || null,
        pointsX100,
        freemints: freemintsFromPoints(pointsX100),
        remainderX100: pointsX100 % 100,
        droidsLocked: totals?.droids_locked ?? 0,
        breakdown: {
            lvl1: totals?.lvl1_count ?? 0,
            lvl2: totals?.lvl2_count ?? 0,
            lvl2super: totals?.lvl2_super_count ?? 0,
        },
        lockedTokenIds: (locks || []).map((l: any) => String(l.token_id)),
        locks: (locks || []).map((l: any) => ({
            tokenId: String(l.token_id),
            tier: tierOf({ level: l.level, is_super: l.is_super }),
            multiplierX100: l.multiplier_x100,
            txHash: l.tx_hash,
            lockedAt: l.locked_at,
        })),
    }, { headers })
}

/**
 * POST /api/locker/state — price a hypothetical selection.
 *
 * The page could compute this itself, but then the number a holder sees before signing would come
 * from the browser while the number recorded afterwards comes from the server. Quoting both from
 * the same place removes any chance of the confirmation step promising something different from
 * what gets written.
 */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}))
    const owner = String(body?.owner || '').trim().toLowerCase()
    const tokenIds: number[] = Array.isArray(body?.tokenIds)
        ? body.tokenIds.map((t: unknown) => parseInt(String(t), 10)).filter(Number.isInteger)
        : []

    if (!/^0x[a-f0-9]{40}$/.test(owner)) {
        return NextResponse.json({ error: 'Invalid owner address' }, { status: 400, headers })
    }
    if (tokenIds.length === 0) {
        return NextResponse.json({ error: 'No droids selected' }, { status: 400, headers })
    }
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    }

    const [{ data: totals }, { data: droidRows }, { data: alreadyLocked }] = await Promise.all([
        supabaseAdmin.from('locker_wallet_totals').select('points_x100').eq('wallet', owner).maybeSingle(),
        supabaseAdmin.from('droidz').select('token_id, level, is_super').in('token_id', tokenIds),
        supabaseAdmin.from('locker_locks').select('token_id').in('token_id', tokenIds),
    ])

    const lockedSet = new Set<number>((alreadyLocked || []).map((r: any) => r.token_id))
    const rowsById = new Map<number, DroidRow>((droidRows || []).map((r: any) => [r.token_id, r as DroidRow]))

    const items = tokenIds
        .filter((id) => !lockedSet.has(id))
        .map((id) => {
            const row = rowsById.get(id) || { level: 1, is_super: false }
            return {
                tokenId: String(id),
                tier: tierOf(row),
                multiplierX100: multiplierX100Of(row),
            }
        })

    const existingPointsX100 = totals?.points_x100 ?? 0
    const addedPointsX100 = items.reduce((s, i) => s + i.multiplierX100, 0)
    const totalPointsX100 = existingPointsX100 + addedPointsX100

    return NextResponse.json({
        items,
        skipped: tokenIds.filter((id) => lockedSet.has(id)).map(String),
        existingPointsX100,
        addedPointsX100,
        totalPointsX100,
        freemintsBefore: freemintsFromPoints(existingPointsX100),
        freemintsAfter: freemintsFromPoints(totalPointsX100),
        freemintsGained: freemintsFromPoints(totalPointsX100) - freemintsFromPoints(existingPointsX100),
        remainderX100: totalPointsX100 % 100,
    }, { headers })
}
