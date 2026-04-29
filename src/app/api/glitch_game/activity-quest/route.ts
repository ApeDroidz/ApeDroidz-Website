import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isValidWallet, requireWalletAuth } from '@/lib/walletAuth'

export type QuestType = 'cards_2' | 'cards_5' | 'flight_2' | 'flight_5'
                      | 'cards_20' | 'cards_50' | 'flight_20' | 'flight_50'
                      | 'streak_1' | 'streak_2' | 'streak_3' | 'streak_4'
                      | 'streak_5' | 'streak_6' | 'streak_7'

const QUEST_CONFIG: Record<
    'cards_2' | 'cards_5' | 'flight_2' | 'flight_5' | 'cards_20' | 'cards_50' | 'flight_20' | 'flight_50',
    { required: number; xp: number; game: 'cards' | 'flight'; period: 'daily' | 'weekly' }
> = {
    cards_2:   { required: 2,  xp: 100,  game: 'cards',  period: 'daily'  },
    cards_5:   { required: 5,  xp: 200,  game: 'cards',  period: 'daily'  },
    flight_2:  { required: 2,  xp: 100,  game: 'flight', period: 'daily'  },
    flight_5:  { required: 5,  xp: 200,  game: 'flight', period: 'daily'  },
    cards_20:  { required: 20, xp: 500,  game: 'cards',  period: 'weekly' },
    cards_50:  { required: 50, xp: 1000, game: 'cards',  period: 'weekly' },
    flight_20: { required: 20, xp: 500,  game: 'flight', period: 'weekly' },
    flight_50: { required: 50, xp: 1000, game: 'flight', period: 'weekly' },
}

const STREAK_CONFIG: Record<number, { xp: number; ticket?: number; apes?: number }> = {
    1: { xp: 50 },
    2: { xp: 75 },
    3: { xp: 100 },
    4: { xp: 150, ticket: 1 },
    5: { xp: 150 },
    6: { xp: 200 },
    7: { xp: 300, apes: 5 },
}

const STREAK_QUEST_TYPES = ['cards_2', 'cards_5', 'flight_2', 'flight_5']

function utcToday(): string {
    return new Date().toISOString().slice(0, 10)
}

// Week boundary — Wednesday 00:00 UTC. Pick the most recent Wed (today, if
// today IS Wednesday). This is the single source of truth for the weekly
// reset; the UI label ("Wed–Wed UTC") must mirror this.
function utcWeekStart(): string {
    const d = new Date()
    const day = d.getUTCDay()        // 0=Sun … 3=Wed
    const diff = (day - 3 + 7) % 7   // days since last Wed (0 if today is Wed)
    const start = new Date(d)
    start.setUTCDate(d.getUTCDate() - diff)
    return start.toISOString().slice(0, 10)
}

function rangeFor(period: 'daily' | 'weekly') {
    if (period === 'daily') {
        const today = utcToday()
        return { start: `${today}T00:00:00.000Z`, end: `${today}T23:59:59.999Z`, key: today }
    }
    const weekStart = utcWeekStart()
    const next = new Date(weekStart)
    next.setUTCDate(next.getUTCDate() + 7)
    return { start: `${weekStart}T00:00:00.000Z`, end: next.toISOString(), key: weekStart }
}

async function countStreakDays(wallet: string, monday: string): Promise<number> {
    const { data } = await supabaseAdmin
        .from('daily_activity_claims')
        .select('claim_date')
        .ilike('wallet_address', wallet)   // case-insensitive (legacy mixed-case rows)
        .in('quest_type', STREAK_QUEST_TYPES)
        .gte('claim_date', monday)
        .lte('claim_date', utcToday())
    return new Set((data ?? []).map((r: any) => r.claim_date)).size
}

async function grantXp(wallet: string, xp: number) {
    // Atomic — replaces previous read-then-write upsert.
    await Promise.all([
        supabaseAdmin.rpc('increment_user_xp', { p_wallet: wallet, p_xp: xp })
            .then(({ error }: any) => { if (error) console.warn('[ActivityQuest] increment_user_xp:', error.message) }),
        supabaseAdmin.rpc('increment_season2_xp', { p_wallet: wallet, p_xp: xp })
            .then(({ error }: any) => { if (error) console.warn('[ActivityQuest] increment_season2_xp:', error.message) }),
    ])
}

async function grantTickets(wallet: string, count: number) {
    await supabaseAdmin
        .rpc('add_glitch_user_tickets', { p_wallet: wallet, p_amount: count })
        .then(({ error }: any) => { if (error) console.warn('[ActivityQuest] add_glitch_user_tickets:', error.message) })
}

async function grantFlightApe(wallet: string, amount: number) {
    // credit_flight_balance is already atomic per gameLoop.ts usage.
    await supabaseAdmin
        .rpc('credit_flight_balance', { p_wallet: wallet, p_amount: amount })
        .then(({ error }: any) => { if (error) console.warn('[ActivityQuest] credit_flight_balance:', error.message) })
}

/**
 * GET /api/glitch_game/activity-quest?wallet=0x...
 * Read-only. Wallet validated to prevent ilike wildcard abuse.
 */
export async function GET(req: NextRequest) {
    const wallet = req.nextUrl.searchParams.get('wallet')
    if (!wallet || !isValidWallet(wallet)) {
        return NextResponse.json({ error: 'wallet required' }, { status: 400 })
    }
    const w = wallet.toLowerCase()

    const today   = utcToday()
    const monday  = utcWeekStart()
    const dayRange = rangeFor('daily')
    const wkRange  = rangeFor('weekly')

    const [cardsDay, flightDay, cardsWeek, flightWeek, claims, streakRes, streakClaimsRes] =
        await Promise.all([
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .ilike('wallet_address', w).eq('status', 'success')
                .gte('created_at', dayRange.start).lte('created_at', dayRange.end),

            supabaseAdmin.from('flight_game_logs').select('id', { count: 'exact', head: true })
                .ilike('wallet_address', w)
                .gte('created_at', dayRange.start).lte('created_at', dayRange.end),

            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .ilike('wallet_address', w).eq('status', 'success')
                .gte('created_at', wkRange.start).lte('created_at', wkRange.end),

            supabaseAdmin.from('flight_game_logs').select('id', { count: 'exact', head: true })
                .ilike('wallet_address', w)
                .gte('created_at', wkRange.start).lte('created_at', wkRange.end),

            supabaseAdmin.from('daily_activity_claims').select('quest_type, claim_date')
                .ilike('wallet_address', w)
                .in('claim_date', [today, monday]),

            supabaseAdmin.from('daily_activity_claims').select('claim_date')
                .ilike('wallet_address', w)
                .in('quest_type', STREAK_QUEST_TYPES)
                .gte('claim_date', monday)
                .lte('claim_date', today),

            supabaseAdmin.from('weekly_streak_claims').select('streak_day')
                .ilike('wallet_address', w)
                .eq('week_monday', monday),
        ])

    const claimed = new Set((claims.data ?? []).map((r: any) => r.quest_type as string))
    const cd = cardsDay.count  ?? 0
    const fd = flightDay.count ?? 0
    const cw = cardsWeek.count  ?? 0
    const fw = flightWeek.count ?? 0

    type BaseQuestType = keyof typeof QUEST_CONFIG
    const countFor = (qt: BaseQuestType) => {
        const { game, period } = QUEST_CONFIG[qt]
        if (period === 'daily') return game === 'cards' ? cd : fd
        return game === 'cards' ? cw : fw
    }

    const quests = Object.fromEntries(
        (Object.keys(QUEST_CONFIG) as BaseQuestType[]).map(qt => [
            qt,
            { count: countFor(qt), claimed: claimed.has(qt) },
        ])
    )

    const streakDays = new Set((streakRes.data ?? []).map((r: any) => r.claim_date)).size
    const streakClaimed = (streakClaimsRes.data ?? []).map((r: any) => r.streak_day as number)

    return NextResponse.json({ today, weekMonday: monday, quests, streakDays, streakClaimed })
}

/**
 * POST /api/glitch_game/activity-quest
 * Body: { questType }   (wallet comes from session cookie)
 *
 * Auth: requires session. Replay/griefing is prevented because:
 *   - the wallet is read from the cookie, not the body;
 *   - daily_activity_claims has UNIQUE(wallet, quest_type, claim_date);
 *   - weekly_streak_claims has UNIQUE(wallet, week_monday, streak_day).
 */
export async function POST(req: Request) {
    try {
        // Authentication ─ wallet from cookie only
        const auth = requireWalletAuth(req)
        if (auth instanceof Response) return auth
        const wallet = auth.wallet

        const body = await req.json().catch(() => ({}))
        const questType = body?.questType
        if (typeof questType !== 'string' || questType.length === 0 || questType.length > 32) {
            return NextResponse.json({ error: 'invalid questType' }, { status: 400 })
        }

        // ── Streak milestone claim ─────────────────────────────────────────
        if (questType.startsWith('streak_')) {
            const day = parseInt(questType.replace('streak_', ''), 10)
            const cfg = STREAK_CONFIG[day]
            if (!cfg) return NextResponse.json({ error: 'invalid streak day' }, { status: 400 })

            const monday = utcWeekStart()

            const { data: existing } = await supabaseAdmin
                .from('weekly_streak_claims').select('id')
                .ilike('wallet_address', wallet).eq('week_monday', monday).eq('streak_day', day)
                .maybeSingle()
            if (existing) return NextResponse.json({ error: 'Already claimed' }, { status: 429 })

            const activeDays = await countStreakDays(wallet, monday)
            if (activeDays < day) {
                return NextResponse.json(
                    { error: `Need ${day} active days, you have ${activeDays}` },
                    { status: 400 }
                )
            }

            const { error: claimErr } = await supabaseAdmin
                .from('weekly_streak_claims')
                .insert({ wallet_address: wallet, week_monday: monday, streak_day: day, xp_gained: cfg.xp })
            if (claimErr) {
                if ((claimErr as any).code === '23505') return NextResponse.json({ error: 'Already claimed' }, { status: 429 })
                return NextResponse.json({ error: 'Failed to log claim' }, { status: 500 })
            }

            await grantXp(wallet, cfg.xp)

            const rewards: Record<string, number> = {}
            if (cfg.ticket) { await grantTickets(wallet, cfg.ticket); rewards.tickets = cfg.ticket }
            if (cfg.apes)   { await grantFlightApe(wallet, cfg.apes); rewards.apes = cfg.apes }

            return NextResponse.json({ success: true, xp_gained: cfg.xp, ...rewards })
        }

        // ── Activity quest claim ───────────────────────────────────────────
        const cfg = QUEST_CONFIG[questType as keyof typeof QUEST_CONFIG]
        if (!cfg) return NextResponse.json({ error: 'invalid questType' }, { status: 400 })

        const { start, end, key: claimDate } = rangeFor(cfg.period)

        const { data: existing } = await supabaseAdmin
            .from('daily_activity_claims').select('id')
            .ilike('wallet_address', wallet)
            .eq('quest_type', questType).eq('claim_date', claimDate)
            .maybeSingle()
        if (existing) return NextResponse.json({ error: 'Already claimed' }, { status: 429 })

        const table = cfg.game === 'cards' ? 'game_logs' : 'flight_game_logs'
        let query = supabaseAdmin.from(table).select('id', { count: 'exact', head: true })
            .ilike('wallet_address', wallet).gte('created_at', start).lte('created_at', end)
        if (cfg.game === 'cards') query = query.eq('status', 'success')

        const { count } = await query
        if ((count ?? 0) < cfg.required) {
            return NextResponse.json(
                { error: `Need ${cfg.required} games, you have ${count ?? 0}` },
                { status: 400 }
            )
        }

        const { error: claimErr } = await supabaseAdmin
            .from('daily_activity_claims')
            .insert({ wallet_address: wallet, quest_type: questType, claim_date: claimDate, xp_gained: cfg.xp })
        if (claimErr) {
            if ((claimErr as any).code === '23505') return NextResponse.json({ error: 'Already claimed' }, { status: 429 })
            return NextResponse.json({ error: 'Failed to log claim' }, { status: 500 })
        }

        await grantXp(wallet, cfg.xp)

        const bonus: Record<string, number> = {}
        if (questType === 'cards_20') {
            await grantTickets(wallet, 1)
            bonus.tickets = 1
        }
        if (questType === 'cards_50') {
            await grantTickets(wallet, 2)
            bonus.tickets = 2
        }
        if (questType === 'flight_20') {
            await grantFlightApe(wallet, 5)
            bonus.apes = 5
        }
        if (questType === 'flight_50') {
            await grantFlightApe(wallet, 10)
            bonus.apes = 10
        }

        return NextResponse.json({ success: true, xp_gained: cfg.xp, ...bonus })

    } catch (err: any) {
        console.error('[ActivityQuest] error:', err.message)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
