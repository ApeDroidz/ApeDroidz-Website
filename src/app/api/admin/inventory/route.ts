import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/inventory
 *   ?prize_type_id=xyz       → list inventory rows for that prize
 *   ?next=1&prize_type_id&contract → suggest next sequential token_id
 *
 * The "next" mode is a quick helper: looks at all token_ids for a given
 * (prize_type_id, contract_address), finds the max numeric token_id, and
 * returns max+1. Lets the admin add NFT inventory in batch without
 * hand-typing each token id.
 */
export async function GET(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const url = req.nextUrl
    const prize = url.searchParams.get('prize_type_id') ?? ''
    const contract = url.searchParams.get('contract') ?? ''

    try {
        if (url.searchParams.get('next') === '1') {
            if (!prize) return NextResponse.json({ error: 'prize_type_id required' }, { status: 400 })

            let q = supabaseAdmin.from('nft_inventory').select('token_id').eq('prize_type_id', prize)
            if (contract) q = q.ilike('contract_address', contract)

            const { data, error } = await q
            if (error) throw error
            const ids = (data ?? [])
                .map((r: any) => parseInt(String(r.token_id), 10))
                .filter((n: number) => Number.isFinite(n))
            const maxId = ids.length > 0 ? Math.max(...ids) : -1
            const nextId = maxId + 1
            return NextResponse.json({ nextTokenId: String(nextId), currentMax: maxId, count: ids.length })
        }

        let q = supabaseAdmin.from('nft_inventory')
            .select('id, prize_type_id, contract_address, token_id, name, image_url, status, winner_wallet, won_at')
            .order('token_id', { ascending: true })
            .limit(500)
        if (prize) q = q.eq('prize_type_id', prize)
        if (contract) q = q.ilike('contract_address', contract)

        const { data, error } = await q
        if (error) throw error
        return NextResponse.json({ items: data ?? [] }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

/**
 * POST /api/admin/inventory
 * Body: { prize_type_id, contract_address, token_id, name, image_url }
 *   OR  { prize_type_id, contract_address, name, image_url, count, startTokenId? }
 *       — bulk insert N sequential token_ids starting at startTokenId (or auto-detected next)
 */
export async function POST(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    let body: any
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    // ── Batch path: разнородные позиции, каждая со своим контрактом и id ──
    // Этим ходит импорт по ссылкам: там токены из разных коллекций и
    // подряд идущих id нет, поэтому bulk-путь ниже не подходит.
    if (Array.isArray(body?.items)) {
        const items = body.items as any[]
        if (!items.length) return NextResponse.json({ error: 'items is empty' }, { status: 400 })
        if (items.length > 50) return NextResponse.json({ error: 'too many items (max 50)' }, { status: 400 })

        const rows: any[] = []
        for (const [i, it] of items.entries()) {
            const pid = String(it?.prize_type_id ?? '').trim()
            const addr = String(it?.contract_address ?? '').trim().toLowerCase()
            const tid = it?.token_id != null ? String(it.token_id) : ''
            const nm = String(it?.name ?? '').trim()
            if (!pid) return NextResponse.json({ error: `item ${i + 1}: prize_type_id required` }, { status: 400 })
            if (!/^0x[0-9a-f]{40}$/.test(addr)) return NextResponse.json({ error: `item ${i + 1}: invalid contract_address` }, { status: 400 })
            if (!tid) return NextResponse.json({ error: `item ${i + 1}: token_id required` }, { status: 400 })
            if (!nm || nm.length > 128) return NextResponse.json({ error: `item ${i + 1}: invalid name` }, { status: 400 })
            rows.push({
                prize_type_id: pid,
                contract_address: addr,
                token_id: tid,
                name: nm,
                image_url: it?.image_url ? String(it.image_url).trim() : null,
                status: 'available' as const,
            })
        }

        // Дубли не должны валить всю пачку: заводим по одной и собираем отчёт.
        const inserted: any[] = []
        const skipped: { token_id: string; reason: string }[] = []
        for (const row of rows) {
            const { data, error } = await supabaseAdmin.from('nft_inventory').insert(row).select().single()
            if (error) {
                skipped.push({
                    token_id: row.token_id,
                    reason: (error as any).code === '23505' ? 'уже в инвентаре' : error.message,
                })
            } else {
                inserted.push(data)
            }
        }
        return NextResponse.json({ success: true, inserted: inserted.length, skipped, items: inserted })
    }

    const prize_type_id = String(body?.prize_type_id ?? '').trim()
    const contract_address = String(body?.contract_address ?? '').trim().toLowerCase()
    const name = String(body?.name ?? '').trim()
    const image_url = body?.image_url ? String(body.image_url).trim() : null

    if (!prize_type_id) return NextResponse.json({ error: 'prize_type_id required' }, { status: 400 })
    if (!/^0x[0-9a-f]{40}$/.test(contract_address)) return NextResponse.json({ error: 'Invalid contract_address' }, { status: 400 })
    if (!name || name.length > 128) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })

    try {
        // ── Bulk path ────────────────────────────────────────────────────────
        if (body?.count && Number(body.count) > 0) {
            const count = Math.min(500, Math.max(1, Math.floor(Number(body.count))))
            let start: number
            if (body.startTokenId != null) {
                start = parseInt(String(body.startTokenId), 10)
                if (!Number.isFinite(start) || start < 0) return NextResponse.json({ error: 'Invalid startTokenId' }, { status: 400 })
            } else {
                // Auto-detect next: max existing + 1
                const { data } = await supabaseAdmin.from('nft_inventory').select('token_id')
                    .eq('prize_type_id', prize_type_id).ilike('contract_address', contract_address)
                const ids = (data ?? []).map((r: any) => parseInt(String(r.token_id), 10)).filter((n: number) => Number.isFinite(n))
                start = ids.length > 0 ? Math.max(...ids) + 1 : 0
            }

            const rows = Array.from({ length: count }).map((_, i) => ({
                prize_type_id,
                contract_address,
                token_id: String(start + i),
                name: name.includes('#') ? name : `${name} #${start + i}`,
                image_url,
                status: 'available' as const,
            }))

            const { data, error } = await supabaseAdmin.from('nft_inventory').insert(rows).select()
            if (error) throw error
            return NextResponse.json({ success: true, inserted: data?.length ?? 0, items: data ?? [] })
        }

        // ── Single insert ────────────────────────────────────────────────────
        const token_id = body?.token_id != null ? String(body.token_id) : null
        if (!token_id) return NextResponse.json({ error: 'token_id required (or use bulk: count + startTokenId)' }, { status: 400 })

        const { data, error } = await supabaseAdmin.from('nft_inventory').insert({
            prize_type_id, contract_address, token_id, name, image_url, status: 'available',
        }).select().single()
        if (error) {
            if ((error as any).code === '23505') return NextResponse.json({ error: 'Token already in inventory' }, { status: 409 })
            throw error
        }
        return NextResponse.json({ success: true, item: data })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
