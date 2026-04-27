import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_FIELDS = new Set([
    'name', 'type', 'drop_chance', 'xp_reward', 'image_url', 'amount', 'is_active',
])
const ALLOWED_TYPES = ['nft', 'shard', 'token']

function sanitiseId(raw: string): string | null {
    const id = String(raw ?? '').trim()
    if (!id || id.length > 64 || !/^[a-z0-9_-]+$/i.test(id)) return null
    return id
}

/**
 * PATCH /api/admin/prizes/[id]
 * Body: any subset of { name, type, drop_chance, xp_reward, image_url, amount, is_active }
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const { id: rawId } = await ctx.params
    const id = sanitiseId(rawId)
    if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    let body: any
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    // Whitelist fields
    const update: Record<string, any> = {}
    for (const key of Object.keys(body ?? {})) {
        if (!ALLOWED_FIELDS.has(key)) continue
        update[key] = body[key]
    }
    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Type-check critical fields
    if ('type' in update && !ALLOWED_TYPES.includes(String(update.type).toLowerCase())) {
        return NextResponse.json({ error: `type must be one of ${ALLOWED_TYPES.join(', ')}` }, { status: 400 })
    }
    if ('drop_chance' in update) {
        const n = Number(update.drop_chance)
        if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'Invalid drop_chance' }, { status: 400 })
        update.drop_chance = n
    }
    if ('xp_reward' in update) {
        const n = Number(update.xp_reward)
        if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'Invalid xp_reward' }, { status: 400 })
        update.xp_reward = n
    }
    if ('is_active' in update) update.is_active = !!update.is_active
    if ('name' in update) {
        const s = String(update.name).trim()
        if (!s || s.length > 128) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
        update.name = s
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('prize_types').update(update).eq('id', id).select().single()
        if (error) throw error
        return NextResponse.json({ prize: data, success: true })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

/**
 * DELETE /api/admin/prizes/[id]
 * Soft-delete by default — toggles is_active=false. Pass ?hard=1 to actually
 * remove the row (only works if no game_logs reference it).
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const { id: rawId } = await ctx.params
    const id = sanitiseId(rawId)
    if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    const hard = req.nextUrl.searchParams.get('hard') === '1'

    try {
        if (hard) {
            const { error } = await supabaseAdmin.from('prize_types').delete().eq('id', id)
            if (error) {
                if ((error as any).code === '23503') return NextResponse.json({
                    error: 'Cannot hard-delete — this prize is referenced by game_logs. Use soft-delete instead.',
                }, { status: 409 })
                throw error
            }
            return NextResponse.json({ success: true, mode: 'hard' })
        }

        const { error } = await supabaseAdmin
            .from('prize_types').update({ is_active: false }).eq('id', id)
        if (error) throw error
        return NextResponse.json({ success: true, mode: 'soft' })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
