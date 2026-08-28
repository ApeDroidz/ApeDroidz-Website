import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { freemintsFromPoints } from '@/lib/locker'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

const csvCell = (value: unknown) => {
    const s = value === null || value === undefined ? '' : String(value)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * GET /api/admin/locker            — reporting payload for the Locker tab
 * GET /api/admin/locker?format=csv — the wallet list to hand out freemints from
 *
 * Everything returned here is derived: per-wallet totals come from the `locker_wallet_totals`
 * view, which sums the locks themselves. There is no stored entitlement figure to drift or be
 * edited, and `/api/admin/locker/reconcile` re-checks the whole set against the chain.
 */
export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied

    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    }

    const [{ data: wallets }, { data: batches }, { data: locks }, { count: eventCount }] = await Promise.all([
        supabaseAdmin.from('locker_wallet_totals').select('*').order('points_x100', { ascending: false }),
        supabaseAdmin.from('locker_batches').select('*').order('created_at', { ascending: false }).limit(500),
        supabaseAdmin
            .from('locker_locks')
            .select('token_id, wallet, level, is_super, multiplier_x100, tx_hash, block_number, locked_at')
            .order('locked_at', { ascending: false }),
        supabaseAdmin.from('locker_events').select('*', { count: 'exact', head: true }),
    ])

    const walletRows: any[] = wallets || []

    if (request.nextUrl.searchParams.get('format') === 'csv') {
        const lines = ['wallet,droids_locked,lvl1,lvl2,lvl2_super,points,freemints,first_lock_at,last_lock_at']
        for (const w of walletRows) {
            lines.push([
                w.wallet,
                w.droids_locked,
                w.lvl1_count,
                w.lvl2_count,
                w.lvl2_super_count,
                (w.points_x100 / 100).toFixed(2),
                w.freemints,
                w.first_lock_at,
                w.last_lock_at,
            ].map(csvCell).join(','))
        }
        return new NextResponse(lines.join('\n') + '\n', {
            headers: {
                ...headers,
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="locker-freemints-${new Date().toISOString().slice(0, 10)}.csv"`,
            },
        })
    }

    const totalPointsX100 = walletRows.reduce((s: number, w: any) => s + (w.points_x100 || 0), 0)

    return NextResponse.json({
        summary: {
            wallets: walletRows.length,
            droidsLocked: (locks || []).length,
            lvl1: walletRows.reduce((s: number, w: any) => s + (w.lvl1_count || 0), 0),
            lvl2: walletRows.reduce((s: number, w: any) => s + (w.lvl2_count || 0), 0),
            lvl2super: walletRows.reduce((s: number, w: any) => s + (w.lvl2_super_count || 0), 0),
            // Note this is the sum of per-wallet freemints, not the floor of the grand total —
            // each wallet's remainder stays with that wallet.
            freemintsOwed: walletRows.reduce((s: number, w: any) => s + (w.freemints || 0), 0),
            pointsTotal: totalPointsX100 / 100,
            auditEvents: eventCount ?? 0,
        },
        wallets: walletRows.map((w: any) => ({
            wallet: w.wallet,
            droidsLocked: w.droids_locked,
            lvl1: w.lvl1_count,
            lvl2: w.lvl2_count,
            lvl2super: w.lvl2_super_count,
            points: (w.points_x100 || 0) / 100,
            freemints: w.freemints,
            // Recomputed here as a cheap cross-check on the view itself.
            freemintsRecomputed: freemintsFromPoints(w.points_x100 || 0),
            firstLockAt: w.first_lock_at,
            lastLockAt: w.last_lock_at,
        })),
        batches: (batches || []).map((b: any) => ({
            txHash: b.tx_hash,
            wallet: b.wallet,
            tokenIds: b.token_ids,
            droidCount: b.droid_count,
            points: b.points_x100 / 100,
            freemintsBefore: b.freemints_before,
            freemintsAfter: b.freemints_after,
            blockNumber: b.block_number,
            createdAt: b.created_at,
        })),
        locks: (locks || []).map((l: any) => ({
            tokenId: l.token_id,
            wallet: l.wallet,
            level: l.level,
            isSuper: l.is_super,
            multiplier: l.multiplier_x100 / 100,
            txHash: l.tx_hash,
            blockNumber: l.block_number,
            lockedAt: l.locked_at,
        })),
    }, { headers })
}
