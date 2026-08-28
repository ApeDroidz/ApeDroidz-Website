import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/** ApeDroidz is a fixed 3333 and always will be — the contract is minted out and non-upgradeable. */
const COLLECTION_SUPPLY = 3333

/**
 * GET /api/locker/stats — collection-wide staking numbers, for everyone.
 *
 * Deliberately aggregate only: no wallets, no token ids, nothing that identifies a holder. The
 * admin route is where per-wallet detail lives, behind admin auth. This one is safe to render on a
 * public page.
 */
export async function GET() {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    }

    const [{ data: totals, error }, { count: lockCount }] = await Promise.all([
        supabaseAdmin.from('locker_wallet_totals').select('*'),
        supabaseAdmin.from('locker_locks').select('token_id', { count: 'exact', head: true }),
    ])

    if (error) {
        console.error('[locker/stats] db error:', error)
        return NextResponse.json({ error: 'Database error' }, { status: 500, headers })
    }

    const rows: any[] = totals || []
    const locked = lockCount ?? 0

    return NextResponse.json({
        supply: COLLECTION_SUPPLY,
        locked,
        lockedPct: COLLECTION_SUPPLY > 0 ? (locked / COLLECTION_SUPPLY) * 100 : 0,
        wallets: rows.length,
        // Sum of each wallet's floored entitlement — not the floor of the grand total, because a
        // remainder belongs to the wallet that earned it and never merges with anyone else's.
        freemintsIssued: rows.reduce((sum: number, r: any) => sum + (r.freemints || 0), 0),
        breakdown: {
            lvl1: rows.reduce((sum: number, r: any) => sum + (r.lvl1_count || 0), 0),
            lvl2: rows.reduce((sum: number, r: any) => sum + (r.lvl2_count || 0), 0),
            lvl2super: rows.reduce((sum: number, r: any) => sum + (r.lvl2_super_count || 0), 0),
        },
    }, { headers })
}
