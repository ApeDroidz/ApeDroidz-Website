import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { isValidWallet } from '@/lib/walletAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/sys/s2-audit?wallet=0x…
 *
 * Truth-vs-leaderboard audit for one wallet's Season 2 standing. Returns:
 *   • Cards plays since the S2 cutoff (game_logs.success)
 *   • Flight plays since the S2 cutoff (flight_game_logs)
 *   • Activity-quest claims (daily_activity_claims with claim_date >= cutoff)
 *   • X-task claims (daily_claims_log with claimed_at >= cutoff)
 *   • Streak claims (weekly_streak_claims with week_monday >= cutoff)
 *   • The wallet's row in glitch_season_2 (season_xp + counters)
 *   • A "verdict" comparing each counter to truth
 *
 * Use this when a player says their leaderboard number is wrong — it shows
 * exactly which row count is off and which table to investigate.
 */

const S2_START_ISO  = '2026-04-09T00:00:00.000Z'
const S2_START_DATE = '2026-04-09'

export async function GET(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const wallet = req.nextUrl.searchParams.get('wallet')
    if (!wallet || !isValidWallet(wallet)) {
        return NextResponse.json({ error: 'wallet=0x… required' }, { status: 400 })
    }
    const w = wallet.toLowerCase()

    const [
        s2Row,
        cardsCount, flightCount,
        dac, dcl, wsc,
        cardsPre, dclPre,
    ] = await Promise.all([
        supabaseAdmin.from('glitch_season_2')
            .select('season_xp, games_played, flights_played, updated_at')
            .ilike('wallet_address', w).maybeSingle(),

        supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
            .ilike('wallet_address', w).eq('status', 'success')
            .gte('created_at', S2_START_ISO),

        supabaseAdmin.from('flight_game_logs').select('id', { count: 'exact', head: true })
            .ilike('wallet_address', w)
            .gte('created_at', S2_START_ISO),

        supabaseAdmin.from('daily_activity_claims')
            .select('quest_type, claim_date, xp_gained')
            .ilike('wallet_address', w)
            .gte('claim_date', S2_START_DATE)
            .order('claim_date', { ascending: false }),

        // S2 X-task claims live in the dedicated daily_claims_log_s2 table —
        // no date filter needed, every row in there is by definition S2.
        supabaseAdmin.from('daily_claims_log_s2')
            .select('claimed_at, x_handle')
            .ilike('wallet_address', w)
            .order('claimed_at', { ascending: false }),

        supabaseAdmin.from('weekly_streak_claims')
            .select('week_monday, streak_day, xp_gained')
            .ilike('wallet_address', w)
            .gte('week_monday', S2_START_DATE)
            .order('week_monday', { ascending: false }),

        // Pre-S2 noise still lives in the legacy game_logs and daily_claims_log
        // tables — count it from there so the operator can see how much
        // historic data is being correctly excluded from the S2 view.
        supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
            .ilike('wallet_address', w).eq('status', 'success')
            .lt('created_at', S2_START_ISO),

        supabaseAdmin.from('daily_claims_log').select('id', { count: 'exact', head: true })
            .ilike('wallet_address', w),
    ])

    const truth = {
        cards:  cardsCount.count  ?? 0,
        flights: flightCount.count ?? 0,
        dac: dac.data?.length ?? 0,
        dcl: dcl.data?.length ?? 0,
        streak: wsc.data?.length ?? 0,
    }
    const questsTotal = truth.dac + truth.dcl + truth.streak
    const s2 = s2Row.data ?? null

    const issues: string[] = []
    if (s2 && truth.cards !== s2.games_played) {
        issues.push(
            `glitch_season_2.games_played = ${s2.games_played}, but S2 game_logs has ${truth.cards}.` +
            (s2.games_played > truth.cards ? ' (over-count — counter migration likely included pre-S2 plays)' : '')
        )
    }
    if (s2 && truth.flights !== s2.flights_played) {
        issues.push(`glitch_season_2.flights_played = ${s2.flights_played}, but S2 flight_game_logs has ${truth.flights}.`)
    }
    if (!s2 && (truth.cards > 0 || truth.flights > 0)) {
        issues.push('Wallet has S2 plays but no row in glitch_season_2 — a play after deploy will create it.')
    }

    return NextResponse.json({
        wallet: w,
        cutoff: S2_START_ISO,

        truth_from_logs: {
            cards_plays_s2:   truth.cards,
            flight_plays_s2:  truth.flights,
            activity_quest_claims_s2: truth.dac,
            x_task_claims_s2:         truth.dcl,
            streak_claims_s2:         truth.streak,
            quests_finished_total:    questsTotal,   // what leaderboard should show
        },

        glitch_season_2_row: s2,

        pre_s2_noise_for_this_wallet: {
            cards_pre_s2:  cardsPre.count ?? 0,
            x_task_pre_s2: dclPre.count   ?? 0,
        },

        latest_claims: {
            activity_quests: dac.data ?? [],
            x_tasks:         dcl.data ?? [],
            streaks:         wsc.data ?? [],
        },

        issues,
        verdict: issues.length === 0
            ? 'OK — leaderboard counters match the source-of-truth logs.'
            : `${issues.length} mismatch(es). Run /supabase/migrations/20260430_season2_counter_fix_v2.sql to re-backfill counters with the S2 cutoff.`,
    }, { headers: { 'cache-control': 'no-store' } })
}
