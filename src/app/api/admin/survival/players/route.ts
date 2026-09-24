import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * GET /api/admin/survival/players              — every player, one row each, for the Players tab
 * GET /api/admin/survival/players?wallet=0x…   — one player in full: the save (heroes, trees,
 *                                                resources, bag, weapons), the season row, runs,
 *                                                journal, payments, review and access
 *
 * The owner, 24.09.2026: «вкладку всех юзеров, чтобы смотреть детальный отчёт по каждому юзеру
 * в игре: его статы, ресурсы, прокачки и прочее».
 *
 * `drift` = runs that reached Game Over on the server minus runs the save counts. The save
 * counts every Game Over (Save.recordRun), so a save behind the server was rolled back at some
 * point (the stale-profile bug fixed the same day) — the number is how many runs of progress
 * that player lost. Abandoned runs (void: superseded / expired) never reach Game Over and are
 * not counted; a negative gap (runs played off the site) is shown as zero.
 */
const ROW_LIMIT = 5_000

type Player = { wallet: string; display_name: string | null; clan: string | null; first_seen: string; last_seen: string; banned: boolean; ban_reason: string | null }
type Profile = { wallet: string; coins: number; runs: number; best_score: number; selected_hero: string | null; client_version: string | null; updated_at: string; state: Record<string, unknown> }
type RunAgg = { wallet: string; status: string; reject_reason: string | null; score: number | null; server_duration_ms: number | null; started_at: string }

/** A run the game saw to its Game Over — the only kind the save's own run counter counts. */
const ended = (r: { status: string; reject_reason: string | null }) =>
    r.status === 'finished' || r.status === 'rejected' || (r.status === 'void' && r.reject_reason === 'too_short')

const isWallet = (w: string) => /^0x[0-9a-f]{40}$/.test(w)

export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const wallet = (request.nextUrl.searchParams.get('wallet') ?? '').toLowerCase()
    if (wallet) {
        if (!isWallet(wallet)) return NextResponse.json({ error: 'Bad wallet' }, { status: 400, headers })
        return detail(wallet)
    }
    return list()
}

async function list() {
    const db = supabaseAdmin
    const problems: string[] = []
    const note = (label: string) => (r: { error: { message: string } | null }) => { if (r.error) problems.push(`${label}: ${r.error.message}`) }
    const [players, profiles, runs, allow, xs, payments] = await Promise.all([
        db.from('survival_players').select('wallet, display_name, clan, first_seen, last_seen, banned, ban_reason').order('last_seen', { ascending: false }).limit(ROW_LIMIT),
        db.from('survival_profiles').select('wallet, coins, runs, best_score, selected_hero, client_version, updated_at, state').limit(ROW_LIMIT),
        db.from('survival_runs').select('wallet, status, reject_reason, score, server_duration_ms, started_at').order('started_at', { ascending: false }).limit(50_000),
        db.from('survival_allowlist').select('wallet, note, revoked_at, expires_at').limit(ROW_LIMIT),
        db.from('glitch_users').select('wallet_address, x_handle').not('x_handle', 'is', null).limit(ROW_LIMIT),
        db.from('survival_payments').select('wallet, amount_ape, confirmed_at').limit(50_000),
    ])
    ;[['players', players], ['profiles', profiles], ['runs', runs], ['allowlist', allow], ['glitch_users', xs], ['payments', payments]]
        .forEach(([l, r]) => note(l as string)(r as { error: { message: string } | null }))

    const prof = new Map((profiles.data as Profile[] | null ?? []).map((p) => [p.wallet, p]))
    const agg = new Map<string, { runs: number; ended: number; finished: number; rejected: number; best: number; playMs: number; lastRun: string | null }>()
    for (const r of (runs.data as RunAgg[] | null) ?? []) {
        const a = agg.get(r.wallet) ?? { runs: 0, ended: 0, finished: 0, rejected: 0, best: 0, playMs: 0, lastRun: null }
        a.runs++
        if (ended(r)) a.ended++
        if (r.status === 'finished') { a.finished++; a.best = Math.max(a.best, r.score ?? 0) }
        if (r.status === 'rejected') a.rejected++
        a.playMs += r.server_duration_ms ?? 0
        if (!a.lastRun || r.started_at > a.lastRun) a.lastRun = r.started_at
        agg.set(r.wallet, a)
    }
    const notes = new Map((allow.data as Array<{ wallet: string; note: string | null; revoked_at: string | null; expires_at: string | null }> | null ?? [])
        .map((a) => [a.wallet.toLowerCase(), a]))
    const xh = new Map((xs.data as Array<{ wallet_address: string; x_handle: string }> | null ?? []).map((x) => [x.wallet_address.toLowerCase(), x.x_handle]))
    const paid = new Map<string, { count: number; ape: number }>()
    for (const p of (payments.data as Array<{ wallet: string; amount_ape: number; confirmed_at: string | null }> | null) ?? []) {
        if (!p.confirmed_at) continue
        const a = paid.get(p.wallet) ?? { count: 0, ape: 0 }
        a.count++; a.ape += Number(p.amount_ape) || 0
        paid.set(p.wallet, a)
    }

    const rows = ((players.data as Player[] | null) ?? []).map((p) => {
        const pr = prof.get(p.wallet)
        const a = agg.get(p.wallet)
        const st = (pr?.state ?? {}) as Record<string, unknown>
        const res = (st.resources ?? {}) as Record<string, number>
        const trees = (st.heroTrees ?? {}) as Record<string, Record<string, number>>
        const treeNodes = Object.values(trees).reduce((n, t) => n + Object.values(t ?? {}).reduce((m, v) => m + (Number(v) || 0), 0), 0)
        const access = notes.get(p.wallet)
        return {
            wallet: p.wallet,
            name: access?.note ?? p.display_name ?? null,
            x: xh.get(p.wallet) ?? null,
            clan: p.clan,
            banned: p.banned,
            firstSeen: p.first_seen,
            lastSeen: p.last_seen,
            access: !access ? 'none' : access.revoked_at ? 'revoked' : access.expires_at && Date.parse(access.expires_at) < Date.now() ? 'expired' : 'active',
            coins: pr?.coins ?? 0,
            heroes: Array.isArray(st.unlockedHeroes) ? (st.unlockedHeroes as string[]) : [],
            selectedHero: pr?.selected_hero ?? null,
            resources: { scrap: res.scrap ?? 0, circuit: res.circuit ?? 0, cell: res.cell ?? 0, core: res.core ?? 0 },
            treeLevels: treeNodes,
            items: Array.isArray(st.items) ? (st.items as unknown[]).length : 0,
            saveRuns: pr?.runs ?? 0,
            serverRuns: a?.runs ?? 0,
            drift: pr ? Math.max(0, (a?.ended ?? 0) - (pr.runs ?? 0)) : 0,
            finished: a?.finished ?? 0,
            rejected: a?.rejected ?? 0,
            best: a?.best ?? 0,
            playMs: a?.playMs ?? 0,
            lastRun: a?.lastRun ?? null,
            paidCount: paid.get(p.wallet)?.count ?? 0,
            paidApe: paid.get(p.wallet)?.ape ?? 0,
            clientVersion: pr?.client_version ?? null,
            savedAt: pr?.updated_at ?? null,
        }
    })
    return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), players: rows, problems }, { headers })
}

async function detail(wallet: string) {
    const db = supabaseAdmin
    const problems: string[] = []
    const one = async <T,>(label: string, q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> => {
        const r = await q
        if (r.error) problems.push(`${label}: ${r.error.message}`)
        return r.data
    }
    const [player, profile, seasons, runs, events, payments, feedback, access, x] = await Promise.all([
        one('player', db.from('survival_players').select('*').eq('wallet', wallet).maybeSingle()),
        one('profile', db.from('survival_profiles').select('state, coins, runs, best_score, selected_hero, client_version, created_at, updated_at').eq('wallet', wallet).maybeSingle()),
        one('seasons', db.from('survival_profile_seasons').select('season_id, season, daily, sxp, tier, updated_at').eq('wallet', wallet).order('updated_at', { ascending: false })),
        one('runs', db.from('survival_runs').select('id, season_id, status, reject_reason, flags, score, wave, kills, hero, weapon, started_at, finished_at, server_duration_ms, client_duration_ms, client_version')
            .eq('wallet', wallet).order('started_at', { ascending: false }).limit(1000)),
        one('events', db.from('survival_events').select('id, at, level, kind, message, data, client_version').eq('wallet', wallet).order('at', { ascending: false }).limit(100)),
        one('payments', db.from('survival_payments').select('tx_hash, amount_ape, confirmed_at, credits_granted, created_at').eq('wallet', wallet).order('created_at', { ascending: false }).limit(100)),
        one('feedback', db.from('survival_feedback').select('rating, comment, runs_at_submit, coins_awarded, created_at, updated_at, edited_count').eq('wallet', wallet).maybeSingle()),
        one('allowlist', db.from('survival_allowlist').select('note, added_by, added_at, revoked_at, expires_at').eq('wallet', wallet).maybeSingle()),
        one('glitch_users', db.from('glitch_users').select('x_handle').ilike('wallet_address', wallet).maybeSingle()),
    ])
    if (!player && !profile) return NextResponse.json({ error: 'No such player' }, { status: 404, headers })
    const runList = (runs as Array<{ status: string; reject_reason: string | null; score: number | null; server_duration_ms: number | null }> | null) ?? []
    const stats = {
        serverRuns: runList.length,
        ended: runList.filter(ended).length,
        finished: runList.filter((r) => r.status === 'finished').length,
        rejected: runList.filter((r) => r.status === 'rejected').length,
        voided: runList.filter((r) => r.status === 'void').length,
        best: runList.reduce((m, r) => (r.status === 'finished' ? Math.max(m, r.score ?? 0) : m), 0),
        playMs: runList.reduce((m, r) => m + (r.server_duration_ms ?? 0), 0),
        saveRuns: (profile as { runs?: number } | null)?.runs ?? 0,
    }
    return NextResponse.json({
        ok: true, wallet, player, profile, seasons, runs, events, payments, feedback, access,
        x: (x as { x_handle: string | null } | null)?.x_handle ?? null,
        stats: { ...stats, drift: profile ? Math.max(0, stats.ended - stats.saveRuns) : 0 },
        problems,
    }, { headers })
}
