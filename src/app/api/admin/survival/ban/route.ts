import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { logEvent } from '@/lib/survivalLog'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }

/**
 * POST /api/admin/survival/ban { wallet, banned: boolean, reason? }
 * A banned wallet cannot open a run (run/start) and is dropped from the board view.
 */
export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const wallet = typeof body.wallet === 'string' ? body.wallet.trim().toLowerCase() : ''
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ error: 'Not a wallet address' }, { status: 400, headers })
    const banned = body.banned === true
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null
    const { error } = await supabaseAdmin.from('survival_players')
        .upsert({ wallet, banned, ban_reason: banned ? reason : null }, { onConflict: 'wallet' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
    logEvent({ level: 'warn', kind: banned ? 'player.banned' : 'player.unbanned', wallet, message: reason ?? '', data: { by: 'spltpnl' } })
    return NextResponse.json({ ok: true, wallet, banned }, { headers })
}
