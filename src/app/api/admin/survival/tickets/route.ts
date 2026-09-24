import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { logEvent } from '@/lib/survivalLog'
import { deliverTicketNfts } from '@/lib/survivalTicketNft'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * GET  /api/admin/survival/tickets → { prizes, draws, pendingNft }
 * POST /api/admin/survival/tickets { prize }                      — edit/add one prize (weight, stock, on/off…)
 * POST /api/admin/survival/tickets { fulfil: entitlementId, note } — an NFT prize was sent by hand
 * POST /api/admin/survival/tickets { importNfts: [{ contract, tokenId, standard, name, imageUrl }], prizeId }
 *      — NFT prizes added by link (resolved and vault-checked by /api/admin/inventory/resolve, like Glitch Cards)
 * POST /api/admin/survival/tickets { retrySend: id } · { removeNft: id }
 */
type Prize = { id: string; label: string; kind: string; spec: Record<string, unknown>; weight: number; stock: number | null; active: boolean; sort: number }
const KINDS = ['coins', 'resources', 'item', 'boost', 'runs', 'nft']

async function payload() {
    const [prizes, draws, nfts] = await Promise.all([
        supabaseAdmin.from('survival_ticket_prizes').select('id, label, kind, spec, weight, stock, active, sort').order('sort'),
        supabaseAdmin.from('survival_entitlements').select('id, wallet, grant_spec, created_at, claimed_at, fulfilled_at, fulfilled_note').eq('kind', 'ticket').order('created_at', { ascending: false }).limit(500),
        supabaseAdmin.from('survival_ticket_nfts').select('id, prize_id, contract, token_id, standard, name, image_url, status, winner, tx_hash, error, added_at, sent_at').neq('status', 'removed').order('added_at', { ascending: false }).limit(500),
    ])
    const D = (draws.data as Array<{ id: string; wallet: string; grant_spec: { prize?: { id: string; label: string; kind: string } }; created_at: string; claimed_at: string | null; fulfilled_at: string | null; fulfilled_note: string | null }> | null) ?? []
    const counts: Record<string, number> = {}
    for (const d of D) { const id = d.grant_spec?.prize?.id ?? '?'; counts[id] = (counts[id] ?? 0) + 1 }
    return {
        ok: true, prizes: (prizes.data as Prize[] | null) ?? [], drawn: counts, totalDraws: D.length,
        pendingNft: [] as unknown[],
        nfts: nfts.data ?? [],
        recent: D.slice(0, 50).map((d) => ({ id: d.id, wallet: d.wallet, prize: d.grant_spec?.prize?.label ?? '?', at: d.created_at, opened: !!d.claimed_at })),
    }
}

export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    return NextResponse.json(await payload(), { headers })
}

export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const body = await request.json().catch(() => ({})) as { prize?: Record<string, unknown>; fulfil?: unknown; note?: unknown }
    const b = body as Record<string, unknown>
    if (Array.isArray(b.importNfts)) {
        const prizeId = typeof b.prizeId === 'string' ? b.prizeId : ''
        const { data: prize } = await supabaseAdmin.from('survival_ticket_prizes').select('id, kind').eq('id', prizeId).maybeSingle()
        if (!prize || (prize as { kind: string }).kind !== 'nft') return NextResponse.json({ error: 'pick an NFT prize to put these in' }, { status: 400, headers })
        const added: string[] = [], skipped: Array<{ ref: string; reason: string }> = []
        for (const raw of (b.importNfts as Array<Record<string, unknown>>).slice(0, 50)) {
            const contract = String(raw.contract ?? '').toLowerCase(), tokenId = String(raw.tokenId ?? '')
            const ref = `${contract}/${tokenId}`
            if (!/^0x[0-9a-f]{40}$/.test(contract) || !/^[0-9]+$/.test(tokenId)) { skipped.push({ ref, reason: 'bad ref' }); continue }
            const { error } = await supabaseAdmin.from('survival_ticket_nfts').insert({
                prize_id: prizeId, contract, token_id: tokenId, standard: raw.standard === 'erc1155' ? 'erc1155' : 'erc721',
                name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : null, image_url: typeof raw.imageUrl === 'string' ? raw.imageUrl.slice(0, 500) : null,
            })
            if (error) skipped.push({ ref, reason: /glitch cards/i.test(error.message) ? 'already a Glitch Cards prize' : /duplicate|unique/i.test(error.message) ? 'already in the pool' : error.message })
            else added.push(ref)
        }
        logEvent({ level: 'info', source: 'server', kind: 'ticket.nft_added', message: prizeId, data: { added, skipped } })
        return NextResponse.json({ ...(await payload()), added, skipped }, { headers })
    }
    if (typeof b.retrySend === 'number') {
        const results = await deliverTicketNfts({ ids: [b.retrySend], retryFailed: true })
        return NextResponse.json({ ...(await payload()), results }, { headers })
    }
    if (typeof b.removeNft === 'number') {
        await supabaseAdmin.from('survival_ticket_nfts').update({ status: 'removed' }).eq('id', b.removeNft).eq('status', 'available')
        return NextResponse.json(await payload(), { headers })
    }
    if (typeof body.fulfil === 'string') {
        const { error } = await supabaseAdmin.from('survival_entitlements').update({ fulfilled_at: new Date().toISOString(), fulfilled_note: typeof body.note === 'string' ? body.note.slice(0, 300) : null }).eq('id', body.fulfil)
        if (error) return NextResponse.json({ error: error.message }, { status: 400, headers })
        logEvent({ level: 'info', source: 'server', kind: 'ticket.nft_sent', message: body.fulfil, data: { note: body.note } })
        return NextResponse.json(await payload(), { headers })
    }
    const p = body.prize ?? {}
    const id = typeof p.id === 'string' ? p.id.trim() : ''
    if (!/^[a-z0-9_]{2,40}$/.test(id)) return NextResponse.json({ error: 'id: 2–40 of a-z 0-9 _' }, { status: 400, headers })
    if (!KINDS.includes(String(p.kind))) return NextResponse.json({ error: 'kind' }, { status: 400, headers })
    const weight = Math.floor(Number(p.weight))
    if (!Number.isFinite(weight) || weight < 0 || weight > 1_000_000) return NextResponse.json({ error: 'weight ≥ 0' }, { status: 400, headers })
    const stock = p.stock === null || p.stock === '' || p.stock === undefined ? null : Math.floor(Number(p.stock))
    if (stock !== null && (!Number.isFinite(stock) || stock < 0)) return NextResponse.json({ error: 'stock: empty = unlimited, or ≥ 0' }, { status: 400, headers })
    let spec: unknown = p.spec ?? {}
    if (typeof spec === 'string') { try { spec = JSON.parse(spec || '{}') } catch { return NextResponse.json({ error: 'spec is not JSON' }, { status: 400, headers }) } }
    const row = { id, label: typeof p.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 60) : id, kind: String(p.kind), spec, weight, stock, active: p.active === true, sort: Math.floor(Number(p.sort ?? 0)) || 0, updated_at: new Date().toISOString() }
    const { error } = await supabaseAdmin.from('survival_ticket_prizes').upsert(row, { onConflict: 'id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 400, headers })
    logEvent({ level: 'info', source: 'server', kind: 'ticket.prize_change', message: id, data: { weight, stock, active: row.active } })
    return NextResponse.json(await payload(), { headers })
}
