import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { logEvent } from '@/lib/survivalLog'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }

/**
 * POST /api/admin/survival/allowlist { action: 'add' | 'revoke', wallet, note? }
 *
 * The beta list from the panel — the same table and the same rule as
 * scripts/survival-allowlist.mjs: access is revoked, never deleted, so who was in the beta
 * and why stays on record. Adding a revoked wallet restores it.
 */
export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const wallet = typeof body.wallet === 'string' ? body.wallet.trim().toLowerCase() : ''
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ error: 'Not a wallet address' }, { status: 400, headers })
    const note = typeof body.note === 'string' ? body.note.slice(0, 120) : null
    const action = body.action === 'revoke' ? 'revoke' : 'add'

    const row = action === 'add'
        ? { wallet, status: 'active', note, added_at: new Date().toISOString(), revoked_at: null }
        : { wallet, status: 'revoked', revoked_at: new Date().toISOString() }
    const { error } = await supabaseAdmin.from('survival_allowlist').upsert(row, { onConflict: 'wallet' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
    logEvent({ level: 'info', kind: `allowlist.${action}`, wallet, message: note ?? '', data: { by: 'spltpnl' } })
    return NextResponse.json({ ok: true, wallet, action }, { headers })
}
