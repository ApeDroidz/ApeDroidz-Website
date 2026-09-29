import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { logEvent } from '@/lib/survivalLog'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * NFT prizes of the season's PRIZE POOL (owner, 28.09.2026: «в прайз пул — окошки под другие NFT; в
 * сплитпанели добавлять призы именно сюда, как в лаки тикет»). The table is survival_pool_prizes.
 *
 * GET  → { liveSeason, seasons, prizes }
 * POST { importNfts: [{ contract, tokenId, standard, name, imageUrl }], seasonId, place, unlockLevel }
 *      — tokens added by link (resolved and vault-checked by /api/admin/inventory/resolve, as the ticket's)
 * POST { update: { id, place?, unlockLevel?, status?, winner?, txHash?, note? } }
 *      — move a prize to another place or level; mark it awarded (winner) or sent (tx)
 * POST { remove: id } — takes a listed prize off the pool
 */
const COLS = 'id, season_id, place, unlock_level, contract, token_id, standard, name, image_url, status, winner, tx_hash, note, added_at, sent_at'

async function payload() {
    const [live, seasons, prizes] = await Promise.all([
        supabaseAdmin.from('survival_seasons').select('id, name').eq('status', 'live').limit(1).maybeSingle(),
        supabaseAdmin.from('survival_seasons').select('id, name, status').order('starts_at', { ascending: false }).limit(20),
        supabaseAdmin.from('survival_pool_prizes').select(COLS).neq('status', 'removed').order('season_id').order('place').order('id'),
    ])
    return { ok: true, liveSeason: live.data ?? null, seasons: seasons.data ?? [], prizes: prizes.data ?? [] }
}

const int = (v: unknown, lo: number, hi: number): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isInteger(n) && n >= lo && n <= hi ? n : null
}

export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    return NextResponse.json(await payload(), { headers })
}

export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

    if (Array.isArray(b.importNfts)) {
        const seasonId = typeof b.seasonId === 'string' ? b.seasonId : ''
        const { data: season } = await supabaseAdmin.from('survival_seasons').select('id').eq('id', seasonId).maybeSingle()
        if (!season) return NextResponse.json({ error: 'pick the season these prizes are for' }, { status: 400, headers })
        const place = int(b.place, 1, 1000)
        if (place === null) return NextResponse.json({ error: 'place must be 1 or more' }, { status: 400, headers })
        const unlockLevel = b.unlockLevel === null || b.unlockLevel === '' || b.unlockLevel === undefined ? null : int(b.unlockLevel, 1, 100)
        if (b.unlockLevel && unlockLevel === null) return NextResponse.json({ error: 'unlock level must be 1–100 or empty' }, { status: 400, headers })
        const added: string[] = [], skipped: Array<{ ref: string; reason: string }> = []
        for (const raw of (b.importNfts as Array<Record<string, unknown>>).slice(0, 50)) {
            const contract = String(raw.contract ?? '').toLowerCase(), tokenId = String(raw.tokenId ?? '')
            const ref = `${contract}/${tokenId}`
            if (!/^0x[0-9a-f]{40}$/.test(contract) || !/^[0-9]+$/.test(tokenId)) { skipped.push({ ref, reason: 'bad ref' }); continue }
            const { error } = await supabaseAdmin.from('survival_pool_prizes').insert({
                season_id: seasonId, place, unlock_level: unlockLevel, contract, token_id: tokenId,
                standard: raw.standard === 'erc1155' ? 'erc1155' : 'erc721',
                name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : null,
                image_url: typeof raw.imageUrl === 'string' ? raw.imageUrl.slice(0, 500) : null,
            })
            if (error) skipped.push({ ref, reason: /glitch cards|lucky ticket/i.test(error.message) ? error.message.replace(/^.*is already /, 'already ') : /duplicate|unique/i.test(error.message) ? 'already in the pool' : error.message })
            else added.push(ref)
        }
        logEvent({ level: 'info', source: 'server', kind: 'pool.nft_added', message: seasonId, data: { place, unlockLevel, added, skipped } })
        return NextResponse.json({ ...(await payload()), added, skipped }, { headers })
    }

    if (b.update && typeof b.update === 'object') {
        const u = b.update as Record<string, unknown>
        const id = int(u.id, 1, Number.MAX_SAFE_INTEGER)
        if (id === null) return NextResponse.json({ error: 'bad id' }, { status: 400, headers })
        const patch: Record<string, unknown> = {}
        if (u.place !== undefined) { const p = int(u.place, 1, 1000); if (p === null) return NextResponse.json({ error: 'bad place' }, { status: 400, headers }); patch.place = p }
        if (u.unlockLevel !== undefined) {
            const l = u.unlockLevel === null || u.unlockLevel === '' ? null : int(u.unlockLevel, 1, 100)
            if (u.unlockLevel !== null && u.unlockLevel !== '' && l === null) return NextResponse.json({ error: 'bad level' }, { status: 400, headers })
            patch.unlock_level = l
        }
        if (u.status !== undefined) {
            if (!['listed', 'awarded', 'sent'].includes(String(u.status))) return NextResponse.json({ error: 'bad status' }, { status: 400, headers })
            patch.status = u.status
            if (u.status === 'sent') patch.sent_at = new Date().toISOString()
        }
        if (typeof u.winner === 'string') patch.winner = u.winner.trim().toLowerCase().slice(0, 64) || null
        if (typeof u.txHash === 'string') patch.tx_hash = u.txHash.trim().slice(0, 80) || null
        if (typeof u.note === 'string') patch.note = u.note.slice(0, 300) || null
        const { error } = await supabaseAdmin.from('survival_pool_prizes').update(patch).eq('id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 400, headers })
        logEvent({ level: 'info', source: 'server', kind: 'pool.prize_updated', message: String(id), data: patch })
        return NextResponse.json(await payload(), { headers })
    }

    if (typeof b.remove === 'number') {
        await supabaseAdmin.from('survival_pool_prizes').update({ status: 'removed' }).eq('id', b.remove).eq('status', 'listed')
        logEvent({ level: 'info', source: 'server', kind: 'pool.prize_removed', message: String(b.remove) })
        return NextResponse.json(await payload(), { headers })
    }
    return NextResponse.json({ error: 'nothing to do' }, { status: 400, headers })
}
