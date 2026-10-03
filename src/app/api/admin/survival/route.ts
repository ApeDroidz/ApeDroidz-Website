import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { scoreTypical, waveCap } from '@/lib/survivalEnvelope'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * GET /api/admin/survival — everything the Droidz Survival tab shows, in one payload:
 * the numbers (players, runs by verdict, activity, averages, payments), the live season's
 * board, the journal, the rejected runs (each one a suspicion with a reason), the wallets
 * caught cheating (rejected ≥ 1, with their ban state), and the beta allowlist.
 * All derived from the tables; nothing here is a stored figure that can drift.
 *
 * Column names follow the migrations, not the wish list: the allowlist has no `status`
 * column — a wallet is active while `revoked_at` is null (survival_has_access says the same),
 * so the status the tab shows is derived here. PostgREST aggregates are off on this project,
 * so averages and sums are computed from the rows.
 */
const AGG_LIMIT = 10_000

type AllowRow = { wallet: string; note: string | null; added_by: string | null; added_at: string; revoked_at: string | null; expires_at: string | null }
type RejectedRow = { wallet: string; reject_reason: string | null; started_at: string }
type BanRow = { wallet: string; banned: boolean; ban_reason: string | null }

export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const db = supabaseAdmin
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const minutesAgo = new Date(Date.now() - 3 * 60_000).toISOString()
    const problems: string[] = []
    const note = (label: string) => (r: { error: { message: string } | null }) => { if (r.error) problems.push(`${label}: ${r.error.message}`) }

    const count = async (table: string, f?: (q: any) => any) => {
        let q = db.from(table).select('*', { count: 'exact', head: true })
        if (f) q = f(q)
        const { count: n, error } = await q
        if (error) problems.push(`${table}: ${error.message}`)
        return n ?? 0
    }

    // The live season first: the board and the averages are cut by it.
    const live = await db.from('survival_seasons').select('id, name, status, starts_at, ends_at').eq('status', 'live').limit(1).maybeSingle()
    note('survival_seasons')(live)
    const seasonId = (live.data as { id: string } | null)?.id ?? null
    const bySeason = (q: any) => (seasonId ? q.eq('season_id', seasonId) : q)

    const [online, playing, players, players24, banned, runsAll, runs24, finished, rejected, voided, started, runs7, board, events, rejectedRuns, allowlist, recent, profiles, finishedRows, payments, feedback, durations] = await Promise.all([
        count('survival_players', (q) => q.gte('last_seen', minutesAgo)),
        count('survival_runs', (q) => q.eq('status', 'started').gte('last_pulse_at', minutesAgo)),
        count('survival_players'),
        count('survival_players', (q) => q.gte('last_seen', dayAgo)),
        count('survival_players', (q) => q.eq('banned', true)),
        count('survival_runs'),
        count('survival_runs', (q) => q.gte('started_at', dayAgo)),
        count('survival_runs', (q) => q.eq('status', 'finished')),
        count('survival_runs', (q) => q.eq('status', 'rejected')),
        count('survival_runs', (q) => q.eq('status', 'void')),
        count('survival_runs', (q) => q.eq('status', 'started')),
        count('survival_runs', (q) => q.gte('started_at', weekAgo)),
        bySeason(db.from('survival_board').select('*')).order('rank', { ascending: true }).limit(20),
        db.from('survival_events').select('id, at, wallet, source, level, kind, message, data, run_id, client_version')
            .order('at', { ascending: false }).limit(200),
        db.from('survival_runs').select('id, wallet, status, reject_reason, flags, score, wave, kills, started_at, finished_at, server_duration_ms, client_duration_ms, client_version, hero')
            .eq('status', 'rejected').order('started_at', { ascending: false }).limit(200),
        db.from('survival_allowlist').select('wallet, note, added_by, added_at, revoked_at, expires_at').order('added_at', { ascending: false }),
        db.from('survival_runs').select('id, wallet, status, reject_reason, score, wave, kills, started_at, hero, client_version, server_duration_ms, client_duration_ms')
            .order('started_at', { ascending: false }).limit(60),
        db.from('survival_profiles').select('wallet, coins, runs, best_score, selected_hero, updated_at').order('updated_at', { ascending: false }).limit(200),
        bySeason(db.from('survival_runs').select('score, wave, kills')).eq('status', 'finished').order('started_at', { ascending: false }).limit(AGG_LIMIT),
        db.from('survival_payments').select('amount_ape, confirmed_at').order('created_at', { ascending: false }).limit(AGG_LIMIT),
        db.from('survival_feedback').select('wallet, rating, comment, runs_at_submit, coins_awarded, client_version, created_at, updated_at, edited_count')
            .order('updated_at', { ascending: false }).limit(500),
        // Наигранное время — по ВСЕМ забегам, без сезонного среза: это вопрос
        // «сколько вообще наиграли», а не «сколько наиграли в этом сезоне».
        db.from('survival_runs').select('server_duration_ms, client_duration_ms, wallet')
            .not('finished_at', 'is', null).order('started_at', { ascending: false }).limit(AGG_LIMIT),
    ])
    note('survival_board')(board); note('survival_events')(events); note('survival_runs.rejected')(rejectedRuns)
    note('survival_allowlist')(allowlist); note('survival_runs.recent')(recent); note('survival_profiles')(profiles)
    note('survival_runs.finished')(finishedRows); note('survival_payments')(payments); note('survival_feedback')(feedback)
    note('survival_runs.durations')(durations)

    // Наигранное время. Берём серверную длительность (её нельзя подрисовать с
    // клиента), клиентская — запасной вариант для старых строк, где серверной
    // нет. Заодно самый долгий забег: по бете это был показатель на 4 с лишним
    // часа, и такие цифры видно сразу.
    const durRows = (durations.data ?? []) as Array<{ server_duration_ms: number | null; client_duration_ms: number | null; wallet: string }>
    const durOf = (r: { server_duration_ms: number | null; client_duration_ms: number | null }) => Math.max(0, r.server_duration_ms ?? r.client_duration_ms ?? 0)
    const playtimeMs = durRows.reduce((s2, r) => s2 + durOf(r), 0)
    const longestRunMs = durRows.reduce((m, r) => Math.max(m, durOf(r)), 0)

    // Averages over the accepted runs of the live season (the whole table if no season is live).
    const acc = (finishedRows.data ?? []) as Array<{ score: number; wave: number; kills: number }>
    const avg = (k: 'score' | 'wave' | 'kills') => (acc.length ? acc.reduce((s, r) => s + (r[k] ?? 0), 0) / acc.length : 0)
    const paid = (payments.data ?? []) as Array<{ amount_ape: number | string; confirmed_at: string | null }>
    const ape = (rows: typeof paid) => rows.reduce((s, p) => s + Number(p.amount_ape ?? 0), 0)

    // Review (before any pool payout): the top of the season board and every accepted run with a
    // flag, with the numbers that tell a played run from a forged finish — pulses against waves,
    // how much of the score the last pulse covers, score per kill.
    const review = seasonId ? await reviewRuns(seasonId, problems) : []

    // Cheaters: the rejected runs grouped by wallet, with the ban switch's current state.
    // A refusal by the old «25 s a wave» rule (pulse_wave_ahead_of_clock, before 29.09) was an
    // honest run the rule got wrong: those wallets are listed apart, never as cheaters.
    const byWallet = new Map<string, { rejected: number; last: string; reasons: Set<string> }>()
    const OLD_RULE = new Set(['pulse_wave_ahead_of_clock', 'wave_ahead_of_clock'])
    for (const r of (rejectedRuns.data ?? []) as RejectedRow[]) {
        if (r.reject_reason && OLD_RULE.has(r.reject_reason)) continue
        const w = r.wallet.toLowerCase()
        const cur = byWallet.get(w) ?? { rejected: 0, last: r.started_at, reasons: new Set<string>() }
        cur.rejected += 1
        if (r.started_at > cur.last) cur.last = r.started_at
        if (r.reject_reason) cur.reasons.add(r.reject_reason)
        byWallet.set(w, cur)
    }
    const wallets = [...byWallet.keys()]
    const bans = wallets.length
        ? await db.from('survival_players').select('wallet, banned, ban_reason').in('wallet', wallets)
        : { data: [] as BanRow[], error: null }
    note('survival_players.bans')(bans)
    const banOf = new Map<string, BanRow>(((bans.data ?? []) as BanRow[]).map((b) => [b.wallet, b]))
    const caught = wallets.map((w) => ({
        wallet: w, rejected: byWallet.get(w)!.rejected, last: byWallet.get(w)!.last,
        reasons: [...byWallet.get(w)!.reasons], banned: banOf.get(w)?.banned ?? false, ban_reason: banOf.get(w)?.ban_reason ?? null,
    })).sort((a, b) => b.rejected - a.rejected)

    // Отзывы о бете: средняя оценка, разбивка по звёздам и сколько Ape Mini это стоило.
    // Считается здесь, а не в SQL, по той же причине, что и остальные средние в этом файле —
    // агрегаты PostgREST на проекте выключены.
    const fb = (feedback.data ?? []) as Array<{ rating: number; comment: string | null; coins_awarded: number }>
    const withComment = fb.filter((f) => (f.comment ?? '').trim().length > 0)
    const feedbackStats = {
        count: fb.length,
        avgRating: fb.length ? Math.round((fb.reduce((s, f) => s + (f.rating ?? 0), 0) / fb.length) * 100) / 100 : 0,
        // Индекс от 1 до 5: [сколько единиц, ..., сколько пятёрок].
        histogram: [1, 2, 3, 4, 5].map((n) => fb.filter((f) => f.rating === n).length),
        withComment: withComment.length,
        coinsPaid: fb.reduce((s, f) => s + (f.coins_awarded ?? 0), 0),
    }

    return NextResponse.json({
        generatedAt: new Date().toISOString(),
        season: live.data ?? null,
        stats: {
            online, playing, players, players24, banned, runsAll, runs24, runs7, finished, rejected, voided, started,
            rejectRate: runsAll ? rejected / runsAll : 0,
            cheatWallets: wallets.length,
            avgScore: Math.round(avg('score')), avgWave: Math.round(avg('wave') * 10) / 10, avgKills: Math.round(avg('kills')),
            playtimeMs, longestRunMs, avgRunMs: durRows.length ? Math.round(playtimeMs / durRows.length) : 0,
            payments: { count: paid.length, ape: ape(paid), confirmed: paid.filter((p) => p.confirmed_at).length, confirmedApe: ape(paid.filter((p) => p.confirmed_at)) },
        },
        board: board.data ?? [],
        events: events.data ?? [],
        suspicious: rejectedRuns.data ?? [],
        review,
        cheaters: caught,
        // revoked beats expired: a revoked wallet stays revoked whatever its clock says.
        allowlist: ((allowlist.data ?? []) as AllowRow[]).map((a) => ({
            ...a,
            status: a.revoked_at ? 'revoked' : a.expires_at && new Date(a.expires_at).getTime() <= Date.now() ? 'expired' : 'active',
        })),
        recentRuns: recent.data ?? [],
        profiles: profiles.data ?? [],
        feedback: feedback.data ?? [],
        feedbackStats,
        problems,
    }, { headers })
}

type ReviewRun = {
    id: string; wallet: string; score: number; wave: number; kills: number; pulse_count: number
    last_pulse_wave: number | null; last_pulse_score: number | null; server_duration_ms: number | null
    client_duration_ms: number | null; flags: string[] | null; client_version: string | null; hero: string | null; finished_at: string | null
}

/** The season's top 30 and its flagged accepted runs, with what a reviewer compares. */
async function reviewRuns(seasonId: string, problems: string[]) {
    const db = supabaseAdmin
    const COLS = 'id, wallet, score, wave, kills, pulse_count, last_pulse_wave, last_pulse_score, server_duration_ms, client_duration_ms, flags, client_version, hero, finished_at'
    const { data: top, error: tErr } = await db.from('survival_season_best').select('run_id').eq('season_id', seasonId)
        .order('score', { ascending: false }).order('achieved_at', { ascending: true }).limit(30)
    if (tErr) problems.push(`review.top: ${tErr.message}`)
    const topIds = ((top as Array<{ run_id: string }> | null) ?? []).map((t) => t.run_id)
    const [byTop, flagged] = await Promise.all([
        topIds.length ? db.from('survival_runs').select(COLS).in('id', topIds) : Promise.resolve({ data: [], error: null }),
        db.from('survival_runs').select(COLS).eq('season_id', seasonId).eq('status', 'finished')
            // The review flags only (not the telemetry tags like died_boss_alive:w5).
            .or('flags.cs.["pulses_missing"],flags.cs.["wave_ahead_of_clock"],flags.cs.["pulse_wave_ahead_of_clock"],flags.cs.["score_above_typical"]')
            .order('score', { ascending: false }).limit(100),
    ])
    if (byTop.error) problems.push(`review.runs: ${byTop.error.message}`)
    if (flagged.error) problems.push(`review.flagged: ${flagged.error.message}`)
    const runs = new Map<string, ReviewRun>()
    for (const r of [...((byTop.data as ReviewRun[] | null) ?? []), ...((flagged.data as ReviewRun[] | null) ?? [])]) runs.set(r.id, r)
    const wallets = [...new Set([...runs.values()].map((r) => r.wallet))]
    const { data: passRows } = wallets.length
        ? await db.from('survival_entitlements').select('wallet').eq('kind', 'season_pass').not('sku', 'like', 'test_%').or(`season_id.eq.${seasonId},season_id.is.null`).in('wallet', wallets)
        : { data: [] }
    const pass = new Set(((passRows as Array<{ wallet: string }> | null) ?? []).map((p) => p.wallet))
    const topRank = new Map(topIds.map((id, i) => [id, i + 1]))
    return [...runs.values()].map((r) => ({
        ...r,
        flags: Array.isArray(r.flags) ? r.flags : [],
        rank: topRank.get(r.id) ?? null,
        pass: pass.has(r.wallet),
        // One pulse per wave after the first: the gap is how many checkpoints never arrived.
        pulsesMissing: Math.max(0, r.wave - 1 - r.pulse_count),
        perKill: r.kills > 0 ? Math.round(r.score / r.kills) : null,
        typicalRatio: Math.round((r.score / Math.max(1, scoreTypical(r.kills, r.wave))) * 100) / 100,
        waveCap: r.server_duration_ms != null ? waveCap(r.server_duration_ms) : null,
        // The share of the score no pulse ever vouched for: 0 = the finish is its last checkpoint.
        uncovered: r.score > 0 ? Math.round(((r.score - (r.last_pulse_score ?? 0)) / r.score) * 100) / 100 : 0,
    })).sort((a, b) => b.score - a.score)
}
