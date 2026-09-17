import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/survival/clans — the active clans for the game's PLAY screen, alphabetical,
 * each with its collection PFP served through our own proxy (pfp/[slug]) so the game can
 * load it same-origin. Public and NOT cached: a clan deleted or hidden in spltpnl must be gone
 * from the picker on the next PLAY screen, not a minute later from the edge. One small query per
 * game load; the game keeps the list for the session itself.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
    if (!supabaseAdmin) return NextResponse.json({ clans: [] })
    const { data } = await supabaseAdmin
        .from('survival_clans').select('slug, name, image_url, contract, chain').eq('active', true)
    const rows = (data ?? []) as Array<{ slug: string; name: string; image_url: string | null; contract: string | null; chain: string | null }>
    rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    return NextResponse.json(
        { clans: rows.map((c) => ({ slug: c.slug, name: c.name, image: c.image_url ? `/api/survival/clans/pfp/${c.slug}` : null })) },
        { headers: { 'cache-control': 'no-store' } },
    )
}
