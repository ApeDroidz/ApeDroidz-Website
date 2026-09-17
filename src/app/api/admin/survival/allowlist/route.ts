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
 * and why stays on record. The table has no status column; a wallet is on the list while
 * `revoked_at` is null. Adding a revoked wallet restores it (original added_at kept, the note
 * replaced only if a new one is given).
 */
export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const wallet = typeof body.wallet === 'string' ? body.wallet.trim().toLowerCase() : ''
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ error: 'Not a wallet address' }, { status: 400, headers })
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 120) : null
    const action = body.action === 'revoke' ? 'revoke' : 'add'

    if (action === 'revoke') {
        const { data, error } = await supabaseAdmin.from('survival_allowlist')
            .update({ revoked_at: new Date().toISOString() }).eq('wallet', wallet).is('revoked_at', null).select('wallet')
        if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
        if (!data?.length) return NextResponse.json({ error: 'Not on the list, or already revoked' }, { status: 404, headers })
    } else {
        const { data: existing, error: readErr } = await supabaseAdmin.from('survival_allowlist').select('wallet, note').eq('wallet', wallet).maybeSingle()
        if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500, headers })
        const { error } = existing
            ? await supabaseAdmin.from('survival_allowlist').update({ revoked_at: null, note: note ?? (existing as { note: string | null }).note }).eq('wallet', wallet)
            : await supabaseAdmin.from('survival_allowlist').insert({ wallet, note, added_by: 'spltpnl' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
    }
    logEvent({ level: 'info', kind: `allowlist.${action}`, wallet, message: note ?? '', data: { by: 'spltpnl' } })
    return NextResponse.json({ ok: true, wallet, action }, { headers })
}
