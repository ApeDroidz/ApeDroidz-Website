import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/health/dismiss   { kind, fingerprint }
 * DELETE /api/admin/health/dismiss { kind }
 *
 * Marks a health alert as resolved so it stops showing on the panel.
 * The dismissal is keyed by `kind` and tagged with the current `fingerprint`.
 * If the underlying data changes (new error, new wallet) the fingerprint
 * recomputed by /api/admin/health will differ, and the alert resurfaces.
 *
 * DELETE clears a dismissal manually (e.g. operator wants to un-resolve).
 */
export async function POST(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    let body: any
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const kind = typeof body?.kind === 'string' ? body.kind.trim() : ''
    const fingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint.trim() : ''
    if (!kind || kind.length > 100 || !/^[a-z0-9_]+$/i.test(kind)) {
        return NextResponse.json({ error: 'kind required (lowercase identifier)' }, { status: 400 })
    }
    if (!fingerprint || !/^[a-f0-9]{64}$/i.test(fingerprint)) {
        return NextResponse.json({ error: 'fingerprint must be a 64-char hex sha256' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
        .from('health_alert_dismissals')
        .upsert({ kind, fingerprint, dismissed_at: new Date().toISOString() }, { onConflict: 'kind' })

    if (error) {
        console.error('[health/dismiss]', error.message)
        return NextResponse.json({ error: 'Failed to record dismissal' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const url = new URL(req.url)
    const kind = (url.searchParams.get('kind') ?? '').trim()
    if (!kind || !/^[a-z0-9_]+$/i.test(kind)) {
        return NextResponse.json({ error: 'kind required' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
        .from('health_alert_dismissals')
        .delete()
        .eq('kind', kind)

    if (error) {
        return NextResponse.json({ error: 'Failed to clear dismissal' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
}
