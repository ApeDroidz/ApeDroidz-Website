import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['available', 'claimed', 'reserved'] as const

/**
 * PATCH /api/admin/inventory/[id]
 * Body: подмножество { prize_type_id, name, image_url, status }
 *
 * Позиция склада — это конкретный NFT. Менять у неё контракт и token_id
 * нельзя: это уже другой токен, его надо заводить заново через импорт,
 * который проверит владение волтом. Категорию менять можно — из-за неверно
 * выставленной категории приз попадает не в тот сегмент барабана.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    let body: any
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const update: Record<string, any> = {}

    if ('prize_type_id' in body) {
        const pid = String(body.prize_type_id ?? '').trim()
        if (!pid) return NextResponse.json({ error: 'prize_type_id cannot be empty' }, { status: 400 })
        const { data: prize } = await supabaseAdmin
            .from('prize_types').select('id, type').eq('id', pid).maybeSingle()
        if (!prize) return NextResponse.json({ error: `unknown prize_type_id "${pid}"` }, { status: 400 })
        if (prize.type !== 'nft') {
            return NextResponse.json({ error: `"${pid}" is a ${prize.type} prize — inventory holds NFTs only` }, { status: 400 })
        }
        update.prize_type_id = pid
    }

    if ('name' in body) {
        const s = String(body.name ?? '').trim()
        if (!s || s.length > 128) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
        update.name = s
    }

    if ('image_url' in body) {
        update.image_url = body.image_url ? String(body.image_url).trim() : null
    }

    // Себестоимость: во сколько APE обошёлся нам этот NFT. Пустое значение —
    // это «цена не проставлена», а не ноль: ноль занижал бы расход в профите.
    if ('acquisition_ape' in body) {
        const raw = body.acquisition_ape
        if (raw === null || raw === '') {
            update.acquisition_ape = null
        } else {
            const n = Number(raw)
            if (!Number.isFinite(n) || n < 0) {
                return NextResponse.json({ error: 'acquisition_ape must be a non-negative number' }, { status: 400 })
            }
            update.acquisition_ape = n
        }
    }

    if ('status' in body) {
        const s = String(body.status ?? '').trim()
        if (!STATUSES.includes(s as any)) {
            return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 })
        }
        update.status = s
        // Возврат в пул — значит выигрыша не было: чистим следы, иначе позиция
        // выглядит одновременно свободной и уже кем-то выигранной.
        if (s === 'available') {
            update.winner_wallet = null
            update.won_at = null
            update.tx_hash = null
        }
    }

    if (!Object.keys(update).length) {
        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
        .from('nft_inventory').update(update).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, item: data })
}

/**
 * DELETE /api/admin/inventory/[id]
 * Выданные призы удалять нельзя — это история выдачи, по ней разбираются
 * спорные случаи.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { data: row } = await supabaseAdmin
        .from('nft_inventory').select('status').eq('id', id).maybeSingle()
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
    if (row.status === 'claimed') {
        return NextResponse.json({ error: 'позиция уже выдана — удалять нельзя' }, { status: 409 })
    }

    const { error } = await supabaseAdmin.from('nft_inventory').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
}
