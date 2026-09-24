import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { loadCatalog } from '@/lib/survivalShop'
import { logEvent } from '@/lib/survivalLog'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * GET  /api/admin/survival/catalog           → { items } — the whole price list, active or not
 * POST /api/admin/survival/catalog { item }  → create or update one row
 *
 * Owner, 25.09.2026: «цену забега хочу менять». A change applies to the next order; an order already
 * made keeps the price it was made at. Every change is written to the journal (who and what).
 * The server validates the shape; the database refuses a runs item without credits.
 */
const KINDS = ['runs', 'season_pass', 'item', 'box', 'bundle', 'ticket']

export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    return NextResponse.json({ ok: true, items: await loadCatalog(false) }, { headers })
}

export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const body = await request.json().catch(() => ({})) as { item?: Record<string, unknown> }
    const i = body.item ?? {}
    const sku = typeof i.sku === 'string' ? i.sku.trim() : ''
    const price = Number(i.price_ape)
    const credits = Math.floor(Number(i.credits ?? 0))
    const kind = typeof i.kind === 'string' ? i.kind : ''
    if (!/^[a-z0-9_]{2,32}$/.test(sku)) return NextResponse.json({ error: 'sku: 2–32 of a-z 0-9 _' }, { status: 400, headers })
    if (!KINDS.includes(kind)) return NextResponse.json({ error: 'kind' }, { status: 400, headers })
    if (!Number.isFinite(price) || price <= 0 || price > 10_000) return NextResponse.json({ error: 'price must be > 0 and ≤ 10000 APE' }, { status: 400, headers })
    if (!Number.isFinite(credits) || credits < 0 || credits > 1000 || (kind === 'runs' && credits < 1)) return NextResponse.json({ error: 'credits' }, { status: 400, headers })
    let grant: unknown = i.grant_spec ?? {}
    if (typeof grant === 'string') { try { grant = JSON.parse(grant || '{}') } catch { return NextResponse.json({ error: 'grant_spec is not JSON' }, { status: 400, headers }) } }
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return NextResponse.json({ error: 'grant_spec must be an object' }, { status: 400, headers })
    const row = {
        sku, kind, price_ape: Math.round(price * 1e6) / 1e6, credits,
        title: typeof i.title === 'string' && i.title.trim() ? i.title.trim().slice(0, 60) : sku,
        description: typeof i.description === 'string' ? i.description.slice(0, 300) : '',
        mode: i.mode === 'coop' ? 'coop' : 'solo', grant_spec: grant, active: i.active === true,
        sort: Math.floor(Number(i.sort ?? 0)) || 0, updated_at: new Date().toISOString(), updated_by: 'spltpnl',
    }
    const { data: before } = await supabaseAdmin.from('survival_catalog').select('price_ape, active').eq('sku', sku).maybeSingle()
    const { error } = await supabaseAdmin.from('survival_catalog').upsert(row, { onConflict: 'sku' })
    if (error) return NextResponse.json({ error: error.message }, { status: 400, headers })
    logEvent({ level: 'info', source: 'server', kind: 'catalog.change', message: sku, data: { before, after: { price_ape: row.price_ape, active: row.active, credits } } })
    return NextResponse.json({ ok: true, items: await loadCatalog(false) }, { headers })
}
