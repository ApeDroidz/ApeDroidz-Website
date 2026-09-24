import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { loadCatalog } from '@/lib/survivalShop'

/**
 * GET /api/survival/tickets — the lucky ticket's price and what can drop, WITH the odds. Public.
 * The game shows this list before anyone pays: a paid draw whose chances are hidden is exactly the
 * kind of thing players (and regulators) rightly distrust. Only prizes that are on and in stock.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
    if (!supabaseAdmin) return new NextResponse(null, { status: 204 })
    const [catalog, { data }] = await Promise.all([
        loadCatalog(true),
        supabaseAdmin.from('survival_ticket_prizes').select('id, label, kind, spec, weight, stock').eq('active', true).gt('weight', 0).order('sort'),
    ])
    const ticket = catalog.find((c) => c.kind === 'ticket')
    const rows = ((data as Array<{ id: string; label: string; kind: string; spec: Record<string, unknown>; weight: number; stock: number | null }> | null) ?? [])
        .filter((p) => p.stock === null || p.stock > 0)
    const total = rows.reduce((a, p) => a + p.weight, 0)
    return NextResponse.json({
        sku: ticket?.sku ?? null, priceApe: ticket?.price_ape ?? null, fullPriceApe: ticket?.list_price_ape ?? null, salePct: ticket?.sale_pct ?? 0, saleUntil: ticket?.sale_until ?? null,
        prizes: rows.map((p) => ({ id: p.id, label: p.label, kind: p.kind, spec: p.spec, chance: total ? p.weight / total : 0 })),
    }, { headers: { 'cache-control': 'public, max-age=30, s-maxage=60' } })
}
