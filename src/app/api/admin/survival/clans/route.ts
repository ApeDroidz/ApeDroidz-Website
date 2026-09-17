import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { logEvent } from '@/lib/survivalLog'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }
const OPENSEA = 'https://api.opensea.io/api/v2'

/**
 * The clan registry from the panel.
 *
 *   GET  /api/admin/survival/clans                          → every clan, active or not
 *   POST /api/admin/survival/clans { action: 'add', openseaSlug, name? }
 *        Looks the collection up on OpenSea (name, image, first contract) and stores it;
 *        the name can be overridden, the image is the collection's own.
 *   POST /api/admin/survival/clans { action: 'refresh', slug }   — re-read OpenSea
 *   POST /api/admin/survival/clans { action: 'remove', slug }    — deactivate (never delete: players point at it)
 *   POST /api/admin/survival/clans { action: 'restore', slug }
 */
interface OsCollection { name?: string; image_url?: string | null; contracts?: Array<{ address: string; chain: string }> }

async function lookup(openseaSlug: string): Promise<OsCollection | null> {
    const key = process.env.OPENSEA_API_KEY
    if (!key) return null
    const r = await fetch(`${OPENSEA}/collections/${encodeURIComponent(openseaSlug)}`, { headers: { 'x-api-key': key, accept: 'application/json' }, cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as OsCollection
}

export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const { data } = await supabaseAdmin.from('survival_clans').select('*').order('name', { ascending: true })
    return NextResponse.json({ clans: data ?? [] }, { headers })
}

export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action ?? '')
    const now = new Date().toISOString()

    if (action === 'add' || action === 'refresh') {
        let slug = typeof body.slug === 'string' ? body.slug : ''
        let openseaSlug = typeof body.openseaSlug === 'string' ? body.openseaSlug.trim().toLowerCase() : ''
        if (action === 'refresh') {
            const { data: cur } = await supabaseAdmin.from('survival_clans').select('opensea_slug').eq('slug', slug).maybeSingle()
            openseaSlug = (cur as { opensea_slug: string | null } | null)?.opensea_slug ?? ''
        }
        if (!/^[a-z0-9-]{1,80}$/.test(openseaSlug)) return NextResponse.json({ error: 'Not an OpenSea collection slug' }, { status: 400, headers })
        const os = await lookup(openseaSlug)
        if (!os) return NextResponse.json({ error: `OpenSea does not know "${openseaSlug}"` }, { status: 404, headers })
        if (!slug) slug = openseaSlug
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 40) : (os.name ?? openseaSlug).slice(0, 40)
        const c = os.contracts?.[0]
        const row = {
            slug, name, opensea_slug: openseaSlug, chain: c?.chain ?? null, contract: c?.address?.toLowerCase() ?? null,
            image_url: os.image_url ?? null, active: true, updated_at: now,
        }
        const { error } = await supabaseAdmin.from('survival_clans').upsert(row, { onConflict: 'slug' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
        logEvent({ level: 'info', kind: `clan.${action}`, message: name, data: { slug, openseaSlug, image: !!row.image_url, by: 'spltpnl' } })
        return NextResponse.json({ ok: true, clan: row }, { headers })
    }
    if (action === 'remove' || action === 'restore') {
        const slug = typeof body.slug === 'string' ? body.slug : ''
        const { error } = await supabaseAdmin.from('survival_clans').update({ active: action === 'restore', updated_at: now }).eq('slug', slug)
        if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
        logEvent({ level: 'info', kind: `clan.${action}`, message: slug, data: { by: 'spltpnl' } })
        return NextResponse.json({ ok: true }, { headers })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers })
}
