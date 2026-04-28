import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/stats/season
 *
 * Season 2 view: total XP, leaderboard, DAU, today's quests, weekly streaks,
 * XP tier distribution histogram (group-by RPC), quest completion summary.
 */
export async function GET(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const now = Date.now()
    const since24h = new Date(now - 86400_000).toISOString()
    const since7d = new Date(now - 7 * 86400_000).toISOString()
    const since30d = new Date(now - 30 * 86400_000).toISOString()
    const today = new Date().toISOString().slice(0, 10)
    const monday = (() => {
        const d = new Date()
        const day = d.getUTCDay()
        const diff = day === 0 ? -6 : 1 - day
        const m = new Date(d)
        m.setUTCDate(d.getUTCDate() + diff)
        return m.toISOString().slice(0, 10)
    })()

    try {
        const [
            top50, totalXp, dau24, dau7, dau30,
            questsToday, streakRows, registeredUsers,
            xpTiers, questCompletionToday,
            sevenDayQuestClaims,
        ] = await Promise.all([
            supabaseAdmin.from('glitch_season_2')
                .select('wallet_address, season_xp, games_played, updated_at')
                .order('season_xp', { ascending: false }).limit(50),

            supabaseAdmin.from('glitch_season_2').select('season_xp'),

            supabaseAdmin.from('glitch_season_2').select('wallet_address').gte('updated_at', since24h),
            supabaseAdmin.from('glitch_season_2').select('wallet_address').gte('updated_at', since7d),
            supabaseAdmin.from('glitch_season_2').select('wallet_address').gte('updated_at', since30d),

            supabaseAdmin.from('daily_activity_claims').select('quest_type, claim_date, xp_gained')
                .eq('claim_date', today),

            supabaseAdmin.from('weekly_streak_claims').select('streak_day')
                .eq('week_monday', monday),

            supabaseAdmin.from('glitch_season_2').select('wallet_address', { count: 'exact', head: true }),

            // XP tier histogram (RPC)
            supabaseAdmin.rpc('admin_xp_tier_distribution'),
            supabaseAdmin.rpc('admin_quest_completion_today'),

            // 7-day quest activity for trend
            supabaseAdmin.from('daily_activity_claims').select('claim_date, xp_gained')
                .gte('claim_date', since7d.slice(0, 10)),
        ])

        const totalSeasonXp = (totalXp.data ?? []).reduce((s: number, r: any) => s + Number(r.season_xp || 0), 0)
        const distinct = (rows: any) => new Set((rows.data ?? []).map((r: any) => String(r.wallet_address).toLowerCase())).size

        // Aggregate today's quests in JS (small set)
        const questBreakdown: Record<string, number> = {}
        let xpFromQuestsToday = 0
        for (const r of (questsToday.data ?? [])) {
            const q = r.quest_type ?? 'unknown'
            questBreakdown[q] = (questBreakdown[q] ?? 0) + 1
            xpFromQuestsToday += Number(r.xp_gained || 0)
        }

        const streakDist: Record<number, number> = {}
        for (const r of (streakRows.data ?? [])) {
            const d = r.streak_day
            streakDist[d] = (streakDist[d] ?? 0) + 1
        }

        // 7-day quest XP per day
        const sevenDayMap: Record<string, number> = {}
        for (const r of (sevenDayQuestClaims.data ?? [])) {
            const d = String(r.claim_date)
            sevenDayMap[d] = (sevenDayMap[d] ?? 0) + Number(r.xp_gained || 0)
        }
        const last7Days: { day: string; xp: number }[] = []
        for (let i = 6; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
            last7Days.push({ day: d, xp: sevenDayMap[d] ?? 0 })
        }

        return NextResponse.json({
            totalSeasonXp,
            registeredUsers: registeredUsers.count ?? 0,
            top50: top50.data ?? [],
            dau: {
                last24h: distinct(dau24),
                last7d: distinct(dau7),
                last30d: distinct(dau30),
            },
            questsToday: {
                total: (questsToday.data ?? []).length,
                xpDistributed: xpFromQuestsToday,
                breakdown: Object.entries(questBreakdown)
                    .map(([k, v]) => ({ quest: k, count: v }))
                    .sort((a, b) => b.count - a.count),
            },
            streaksThisWeek: {
                weekMonday: monday,
                distribution: Object.entries(streakDist)
                    .map(([k, v]) => ({ day: Number(k), count: v }))
                    .sort((a, b) => a.day - b.day),
            },

            // ── Enrichments ────────────────────────────────────────────────
            xpTiers: xpTiers.data ?? [],
            questCompletionToday: questCompletionToday.data ?? [],
            xpDistributedTrend7d: last7Days,
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        console.error('[admin/stats/season]', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
