import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TWEET_URL_REGEX = /^https?:\/\/(x\.com|twitter\.com)\/\w+\/status\/\d+/i

/**
 * GET /api/admin/quests
 * Returns all daily-task quests (active + scheduled + past) with claim stats
 * joined in. Sorted by `active_from` desc so newest first.
 */
export async function GET(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    try {
        // 1. Fetch all quests
        const { data: quests, error } = await supabaseAdmin
            .from('daily_task_config')
            .select('*')
            .order('active_from', { ascending: false })
        if (error) throw error

        if (!quests || quests.length === 0) {
            return NextResponse.json({ quests: [] }, { headers: { 'cache-control': 'no-store' } })
        }

        // 2. Fetch claim counts in one batch (group by task_config_id)
        const ids = quests.map((q: any) => q.id)
        const { data: claims } = await supabaseAdmin
            .from('daily_claims_log')
            .select('task_config_id, claimed_at')
            .in('task_config_id', ids)

        const counts = new Map<string, number>()
        for (const c of (claims ?? [])) {
            const k = String(c.task_config_id)
            counts.set(k, (counts.get(k) ?? 0) + 1)
        }

        // 3. Decorate quests with status + claim count + xp totals
        const now = Date.now()
        const enriched = quests.map((q: any) => {
            const from = q.active_from ? new Date(q.active_from).getTime() : 0
            const to   = q.active_to   ? new Date(q.active_to).getTime()   : 0
            const claimsCount = counts.get(String(q.id)) ?? 0
            // Each claim grants a fixed 100 XP per /api/glitch_game/daily — reflect that.
            const xp = claimsCount * 100

            const status =
                from > now ? 'scheduled' :
                to < now   ? 'ended'     : 'active'

            return { ...q, status, claims_count: claimsCount, xp_distributed: xp }
        })

        return NextResponse.json({ quests: enriched }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        console.error('[admin/quests/GET]', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

/**
 * POST /api/admin/quests
 * Body: { title, tweet_url, active_from, active_to }
 * Creates a new daily-task quest. Dates can be ISO strings or Date.
 */
export async function POST(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    let body: any
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const title      = String(body?.title ?? '').trim()
    const tweet_url  = String(body?.tweet_url ?? '').trim()
    const active_from = body?.active_from ? new Date(body.active_from).toISOString() : null
    const active_to   = body?.active_to   ? new Date(body.active_to).toISOString()   : null

    if (!title || title.length > 200) return NextResponse.json({ error: 'Invalid title' }, { status: 400 })
    if (!TWEET_URL_REGEX.test(tweet_url)) return NextResponse.json({ error: 'Invalid tweet/post URL' }, { status: 400 })
    if (!active_from || !active_to) return NextResponse.json({ error: 'active_from + active_to required' }, { status: 400 })
    if (new Date(active_to).getTime() <= new Date(active_from).getTime()) {
        return NextResponse.json({ error: 'active_to must be after active_from' }, { status: 400 })
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('daily_task_config')
            .insert({ title, tweet_url, active_from, active_to })
            .select()
            .single()
        if (error) throw error
        return NextResponse.json({ quest: data, success: true })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
