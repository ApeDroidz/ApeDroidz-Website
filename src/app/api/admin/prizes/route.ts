import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = ['nft', 'shard', 'token']

/**
 * GET /api/admin/prizes
 * Returns the full prize_types catalogue, sorted by drop_chance desc.
 */
export async function GET(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    try {
        const { data, error } = await supabaseAdmin
            .from('prize_types')
            .select('*')
            .order('drop_chance', { ascending: false })
        if (error) throw error
        return NextResponse.json({ prizes: data ?? [] }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

/**
 * POST /api/admin/prizes
 * Body: { id, name, type, drop_chance, xp_reward, image_url?, amount?, is_active? }
 */
export async function POST(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    let body: any
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const id = String(body?.id ?? '').trim()
    const name = String(body?.name ?? '').trim()
    const type = String(body?.type ?? '').trim().toLowerCase()
    const drop_chance = Number(body?.drop_chance ?? NaN)
    const xp_reward = Number(body?.xp_reward ?? 0)
    const image_url = body?.image_url ? String(body.image_url).trim() : null
    const amount = body?.amount != null ? Number(body.amount) : null
    const is_active = body?.is_active === undefined ? true : !!body.is_active

    if (!id || id.length > 64 || !/^[a-z0-9_-]+$/i.test(id)) {
        return NextResponse.json({ error: 'Invalid id (lowercase alphanum + _ -)' }, { status: 400 })
    }
    if (!name || name.length > 128) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    if (!ALLOWED_TYPES.includes(type)) return NextResponse.json({ error: `type must be one of ${ALLOWED_TYPES.join(', ')}` }, { status: 400 })
    if (!Number.isFinite(drop_chance) || drop_chance < 0) return NextResponse.json({ error: 'Invalid drop_chance' }, { status: 400 })
    if (!Number.isFinite(xp_reward) || xp_reward < 0) return NextResponse.json({ error: 'Invalid xp_reward' }, { status: 400 })

    try {
        const { data, error } = await supabaseAdmin
            .from('prize_types')
            .insert({ id, name, type, drop_chance, xp_reward, image_url, amount, is_active })
            .select()
            .single()

        if (error) {
            if ((error as any).code === '23505') return NextResponse.json({ error: 'Prize id already exists' }, { status: 409 })
            throw error
        }
        return NextResponse.json({ prize: data, success: true })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
