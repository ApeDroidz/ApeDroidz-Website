import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { logEvent } from '@/lib/survivalLog'
import { poolApeOf, poolLevel } from '@/lib/survivalPoolLevels'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * NFT prizes of the season's PRIZE POOL (owner, 28.09.2026: «в прайз пул — окошки под другие NFT; в
 * сплитпанели добавлять призы именно сюда, как в лаки тикет»). The table is survival_pool_prizes.
 *
 * GET  → { liveSeason, seasons, prizes, poolApe, poolLevel, pools }
 *      — poolApe/poolLevel of the live season; pools[seasonId] for every season a prize is listed in
 * POST { importNfts: [{ contract, tokenId, standard, name, imageUrl }], seasonId, place, unlockLevel }
 *      — tokens added by link (resolved and vault-checked by /api/admin/inventory/resolve, as the ticket's)
 * POST { update: { id, place?, unlockLevel?, status?, winner?, txHash?, note?, force? } }
 *      — move a listed prize to another place or level; the status only goes
 *        listed → awarded (winner 0x+40 hex; refused while the prize is locked by the pool level
 *        unless force: true), awarded → listed (undo a wrong Award, winner cleared) and
 *        awarded → sent (tx 0x+64 hex). sent is final. A note can be edited at any status.
 * POST { remove: id } — takes a listed prize off the pool
 */
const COLS = 'id, season_id, place, unlock_level, contract, token_id, standard, name, image_url, status, winner, tx_hash, note, added_at, sent_at'

const WALLET = /^0x[0-9a-f]{40}$/
const TX = /^0x[0-9a-f]{64}$/

/** The pool of a season in APE and its level, counted as the game counts them (survival_pool_stats). */
async function poolOf(seasonId: string): Promise<{ poolApe: number; poolLevel: number } | null> {
    const { data, error } = await supabaseAdmin.rpc('survival_pool_stats', { p_season: seasonId })
    if (error) { console.warn('[admin/pool-prizes]', error.message); return null }
    const r = ((data as Array<Record<string, number | string>> | null) ?? [])[0] ?? {}
    const poolApe = poolApeOf(r.solo_ape, r.coop_ape)
    return { poolApe, poolLevel: poolLevel(poolApe) }
}

async function payload() {
    const [live, seasons, prizes] = await Promise.all([
        supabaseAdmin.from('survival_seasons').select('id, name').eq('status', 'live').limit(1).maybeSingle(),
        supabaseAdmin.from('survival_seasons').select('id, name, status').order('starts_at', { ascending: false }).limit(20),
        supabaseAdmin.from('survival_pool_prizes').select(COLS).neq('status', 'removed').order('season_id').order('place').order('id'),
    ])
    const rows = (prizes.data ?? []) as Array<{ season_id: string }>
    const ids = [...new Set([...(live.data ? [live.data.id as string] : []), ...rows.map((p) => p.season_id)])]
    const counted = await Promise.all(ids.map(async (id) => [id, await poolOf(id)] as const))
    const pools: Record<string, { poolApe: number; poolLevel: number }> = {}
    for (const [id, p] of counted) if (p) pools[id] = p
    const livePool = live.data ? pools[live.data.id as string] ?? null : null
    return {
        ok: true, liveSeason: live.data ?? null, seasons: seasons.data ?? [], prizes: prizes.data ?? [],
        poolApe: livePool?.poolApe ?? null, poolLevel: livePool?.poolLevel ?? null, pools,
    }
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
        const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers })

        const { data: row, error: rErr } = await supabaseAdmin.from('survival_pool_prizes')
            .select('season_id, unlock_level, status, winner').eq('id', id).maybeSingle()
        if (rErr) return bad(rErr.message)
        if (!row || row.status === 'removed') return bad('no such prize', 404)
        const from = String(row.status)
        const to = u.status === undefined ? from : String(u.status)
        if (!['listed', 'awarded', 'sent'].includes(to)) return bad('bad status')
        const moves = from === to || (from === 'listed' && to === 'awarded') || (from === 'awarded' && (to === 'listed' || to === 'sent'))
        if (!moves) return bad(`a prize goes listed → awarded → sent (or awarded → listed); this one is ${from}`, 409)

        const patch: Record<string, unknown> = {}
        const editsSlot = u.place !== undefined || u.unlockLevel !== undefined
        if (editsSlot && !(from === 'listed' && to === 'listed')) return bad('place and level change only while the prize is listed', 409)
        if (u.place !== undefined) { const p = int(u.place, 1, 1000); if (p === null) return bad('bad place'); patch.place = p }
        if (u.unlockLevel !== undefined) {
            const l = u.unlockLevel === null || u.unlockLevel === '' ? null : int(u.unlockLevel, 1, 100)
            if (u.unlockLevel !== null && u.unlockLevel !== '' && l === null) return bad('bad level')
            patch.unlock_level = l
        }

        const winner = typeof u.winner === 'string' ? u.winner.trim().toLowerCase() : ''
        const txHash = typeof u.txHash === 'string' ? u.txHash.trim().toLowerCase() : ''
        if (winner && !(from === 'listed' && to === 'awarded')) return bad('the winner is set only by Award (listed → awarded)')
        if (txHash && !(from === 'awarded' && to === 'sent')) return bad('the tx is set only by Mark sent (awarded → sent)')

        if (from !== to) {
            patch.status = to
            if (to === 'awarded') {
                if (!WALLET.test(winner)) return bad('winner must be 0x + 40 hex')
                if (row.unlock_level !== null && u.force !== true) {
                    const pool = await poolOf(String(row.season_id))
                    if (!pool) return bad('could not count the pool to check the prize level — try again', 503)
                    if (row.unlock_level > pool.poolLevel) return bad(`prize is locked: pool LVL ${pool.poolLevel}, prize opens at LVL ${row.unlock_level}`, 409)
                }
                patch.winner = winner
            } else if (to === 'listed') {
                patch.winner = null   // undo of a wrong Award
            } else if (to === 'sent') {
                if (!TX.test(txHash)) return bad('tx hash must be 0x + 64 hex')
                if (!row.winner) return bad('the prize has no winner — Award it first', 409)
                patch.tx_hash = txHash
                patch.sent_at = new Date().toISOString()
            }
        }
        if (typeof u.note === 'string') patch.note = u.note.slice(0, 300) || null
        if (!Object.keys(patch).length) return bad('nothing to change')

        // Conditional on the status read above: a second click / tab racing this one gets 409, not a double move.
        let q = supabaseAdmin.from('survival_pool_prizes').update(patch).eq('id', id).eq('status', from)
        if (to === 'sent' && from !== to) q = q.not('winner', 'is', null)
        const { data: done, error } = await q.select('id')
        if (error) return bad(error.message)
        if (!done?.length) return bad('prize is not in the expected state — reload', 409)
        const forced = u.force === true && to === 'awarded' && from !== to && row.unlock_level !== null
        logEvent({ level: forced ? 'warn' : 'info', source: 'server', kind: 'pool.prize_updated', message: String(id), data: { from, ...patch, ...(forced ? { forced: true } : {}) } })
        return NextResponse.json(await payload(), { headers })
    }

    if (typeof b.remove === 'number') {
        await supabaseAdmin.from('survival_pool_prizes').update({ status: 'removed' }).eq('id', b.remove).eq('status', 'listed')
        logEvent({ level: 'info', source: 'server', kind: 'pool.prize_removed', message: String(b.remove) })
        return NextResponse.json(await payload(), { headers })
    }
    return NextResponse.json({ error: 'nothing to do' }, { status: 400, headers })
}
