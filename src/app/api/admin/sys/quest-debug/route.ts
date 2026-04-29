import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { isValidWallet } from '@/lib/walletAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Diagnostic + cleanup for the activity-quest counters for a single wallet.
 *
 *   GET    /api/admin/sys/quest-debug?wallet=0x…
 *     → returns the same view the UI sees, plus the raw rows that feed it,
 *       so you can confirm whether a "Flight counted as Cards" complaint is
 *       a code bug or a real Cards play sitting in game_logs.
 *
 *   DELETE /api/admin/sys/quest-debug?wallet=0x…
 *     → wipes that wallet's daily_activity_claims + weekly_streak_claims so
 *       the player starts the next session with an empty quest panel.
 *       Does NOT touch game_logs / flight_game_logs (the underlying play
 *       counters) — that's intentional, the source-of-truth is the play log.
 */

function utcToday(): string {
    return new Date().toISOString().slice(0, 10)
}

// Mirrors activity-quest/route.ts → utcWeekStart() (Wednesday-anchored).
function utcWeekStart(): string {
    const d = new Date()
    const day = d.getUTCDay()
    const diff = (day - 3 + 7) % 7
    const start = new Date(d)
    start.setUTCDate(d.getUTCDate() - diff)
    return start.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const wallet = req.nextUrl.searchParams.get('wallet')
    if (!wallet || !isValidWallet(wallet)) {
        return NextResponse.json({ error: 'wallet=0x… required' }, { status: 400 })
    }
    const w = wallet.toLowerCase()

    const today = utcToday()
    const weekStart = utcWeekStart()
    const dayStart = `${today}T00:00:00.000Z`
    const dayEnd   = `${today}T23:59:59.999Z`
    const wkEnd    = new Date(weekStart)
    wkEnd.setUTCDate(wkEnd.getUTCDate() + 7)

    const [
        cardsDayCount, flightDayCount, cardsWeekCount, flightWeekCount,
        cardsRecent, flightRecent,
        dailyClaims, streakClaims,
    ] = await Promise.all([
        supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
            .ilike('wallet_address', w).eq('status', 'success')
            .gte('created_at', dayStart).lte('created_at', dayEnd),

        supabaseAdmin.from('flight_game_logs').select('id', { count: 'exact', head: true })
            .ilike('wallet_address', w)
            .gte('created_at', dayStart).lte('created_at', dayEnd),

        supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
            .ilike('wallet_address', w).eq('status', 'success')
            .gte('created_at', `${weekStart}T00:00:00.000Z`).lte('created_at', wkEnd.toISOString()),

        supabaseAdmin.from('flight_game_logs').select('id', { count: 'exact', head: true })
            .ilike('wallet_address', w)
            .gte('created_at', `${weekStart}T00:00:00.000Z`).lte('created_at', wkEnd.toISOString()),

        supabaseAdmin.from('game_logs').select('id, prize_type_id, status, created_at')
            .ilike('wallet_address', w)
            .order('created_at', { ascending: false }).limit(20),

        supabaseAdmin.from('flight_game_logs').select('id, bet_amount, cashout_at, profit, created_at')
            .ilike('wallet_address', w)
            .order('created_at', { ascending: false }).limit(20),

        supabaseAdmin.from('daily_activity_claims').select('quest_type, claim_date, xp_gained')
            .ilike('wallet_address', w)
            .order('claim_date', { ascending: false }),

        supabaseAdmin.from('weekly_streak_claims').select('streak_day, week_monday, xp_gained')
            .ilike('wallet_address', w)
            .order('week_monday', { ascending: false }),
    ])

    return NextResponse.json({
        wallet: w,
        window: {
            today,
            weekStart,
            weekEnd: wkEnd.toISOString().slice(0, 10),
        },
        counters: {
            cardsToday:  cardsDayCount.count   ?? 0,
            flightToday: flightDayCount.count  ?? 0,
            cardsWeek:   cardsWeekCount.count  ?? 0,
            flightWeek:  flightWeekCount.count ?? 0,
        },
        recent: {
            game_logs:        cardsRecent.data  ?? [],
            flight_game_logs: flightRecent.data ?? [],
        },
        claims: {
            daily_activity_claims_total: dailyClaims.data?.length ?? 0,
            weekly_streak_claims_total:  streakClaims.data?.length ?? 0,
            daily_activity_claims: dailyClaims.data  ?? [],
            weekly_streak_claims:  streakClaims.data ?? [],
        },
    }, { headers: { 'cache-control': 'no-store' } })
}

export async function DELETE(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const wallet = req.nextUrl.searchParams.get('wallet')
    if (!wallet || !isValidWallet(wallet)) {
        return NextResponse.json({ error: 'wallet=0x… required' }, { status: 400 })
    }
    const w = wallet.toLowerCase()

    const [daily, streak] = await Promise.all([
        supabaseAdmin.from('daily_activity_claims').delete({ count: 'exact' }).ilike('wallet_address', w),
        supabaseAdmin.from('weekly_streak_claims').delete({ count: 'exact' }).ilike('wallet_address', w),
    ])

    if (daily.error || streak.error) {
        return NextResponse.json({
            error: 'Cleanup failed',
            details: { daily: daily.error?.message, streak: streak.error?.message },
        }, { status: 500 })
    }

    return NextResponse.json({
        wallet: w,
        deleted: {
            daily_activity_claims: daily.count ?? 0,
            weekly_streak_claims:  streak.count ?? 0,
        },
    })
}
