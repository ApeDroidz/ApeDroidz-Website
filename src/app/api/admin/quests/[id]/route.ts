import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TWEET_URL_REGEX = /^https?:\/\/(x\.com|twitter\.com)\/\w+\/status\/\d+/i
const ALLOWED_FIELDS = new Set(['title', 'tweet_url', 'active_from', 'active_to'])

function parseId(raw: string): number | null {
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 0) return null
    return n
}

/**
 * PATCH /api/admin/quests/[id]
 * Body: any subset of { title, tweet_url, active_from, active_to }
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const { id: rawId } = await ctx.params
    const id = parseId(rawId)
    if (id == null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    let body: any
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const update: Record<string, any> = {}
    for (const k of Object.keys(body ?? {})) {
        if (!ALLOWED_FIELDS.has(k)) continue
        update[k] = body[k]
    }
    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    if ('title' in update) {
        const t = String(update.title).trim()
        if (!t || t.length > 200) return NextResponse.json({ error: 'Invalid title' }, { status: 400 })
        update.title = t
    }
    if ('tweet_url' in update) {
        const u = String(update.tweet_url).trim()
        if (!TWEET_URL_REGEX.test(u)) return NextResponse.json({ error: 'Invalid tweet/post URL' }, { status: 400 })
        update.tweet_url = u
    }
    if ('active_from' in update) update.active_from = new Date(update.active_from).toISOString()
    if ('active_to' in update)   update.active_to   = new Date(update.active_to).toISOString()
    if (update.active_from && update.active_to &&
        new Date(update.active_to).getTime() <= new Date(update.active_from).getTime()) {
        return NextResponse.json({ error: 'active_to must be after active_from' }, { status: 400 })
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('daily_task_config').update(update).eq('id', id).select().single()
        if (error) throw error
        return NextResponse.json({ quest: data, success: true })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

/**
 * DELETE /api/admin/quests/[id]
 * Soft-end (set active_to = now) by default, or ?hard=1 to physically remove.
 * Hard delete will fail if any daily_claims_log row references this id (FK).
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const { id: rawId } = await ctx.params
    const id = parseId(rawId)
    if (id == null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const hard = req.nextUrl.searchParams.get('hard') === '1'

    try {
        if (hard) {
            const { error } = await supabaseAdmin.from('daily_task_config').delete().eq('id', id)
            if (error) {
                if ((error as any).code === '23503') return NextResponse.json({
                    error: 'Cannot hard-delete: this quest has claims attached. Use soft-end instead.',
                }, { status: 409 })
                throw error
            }
            return NextResponse.json({ success: true, mode: 'hard' })
        }
        // Soft-end: set active_to to "just now" so it disappears from /state
        const { error } = await supabaseAdmin
            .from('daily_task_config').update({ active_to: new Date().toISOString() }).eq('id', id)
        if (error) throw error
        return NextResponse.json({ success: true, mode: 'soft' })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

/**
 * GET /api/admin/quests/[id]
 * Detailed stats for one quest: claim count, claims-per-day distribution,
 * top 20 X handles, and recent 50 claim entries with proof links.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const { id: rawId } = await ctx.params
    const id = parseId(rawId)
    if (id == null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    try {
        // Per-task stats reflect Season 2 only — pre-S2 history sits in the
        // legacy daily_claims_log and isn't shown here.
        const [questRes, claimsRes] = await Promise.all([
            supabaseAdmin.from('daily_task_config').select('*').eq('id', id).maybeSingle(),
            supabaseAdmin.from('daily_claims_log_s2')
                .select('wallet_address, x_handle, proof_link, claimed_at')
                .eq('task_config_id', id)
                .order('claimed_at', { ascending: false })
                .limit(500),
        ])

        if (questRes.error) throw questRes.error
        if (!questRes.data) return NextResponse.json({ error: 'Quest not found' }, { status: 404 })

        const claims = claimsRes.data ?? []

        // Claims per day histogram
        const perDay: Record<string, number> = {}
        for (const c of claims) {
            const d = c.claimed_at ? String(c.claimed_at).slice(0, 10) : 'unknown'
            perDay[d] = (perDay[d] ?? 0) + 1
        }

        // Top X handles (count of distinct wallets per handle)
        const handleStats: Record<string, Set<string>> = {}
        for (const c of claims) {
            const h = c.x_handle ?? '(no handle)'
            if (!handleStats[h]) handleStats[h] = new Set()
            handleStats[h].add(String(c.wallet_address ?? '').toLowerCase())
        }
        const topHandles = Object.entries(handleStats)
            .map(([handle, set]) => ({ handle, wallets: set.size }))
            .sort((a, b) => b.wallets - a.wallets)
            .slice(0, 20)

        return NextResponse.json({
            quest: questRes.data,
            stats: {
                total_claims: claims.length,
                xp_distributed: claims.length * 100,
                per_day: Object.entries(perDay).map(([day, count]) => ({ day, count }))
                    .sort((a, b) => a.day.localeCompare(b.day)),
                top_handles: topHandles,
            },
            recentClaims: claims.slice(0, 50),
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
