import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { fetchAll } from '@/lib/survivalFetchAll'
import { avatarOf } from '@/lib/survivalNfts'
import { ensurePlayer, likeLiteral, NICK_RE, NO_STORE, playerRow, xHandleOf } from '@/lib/survivalMe'
import { logEvent } from '@/lib/survivalLog'

/**
 * The player's profile in the game (Settings → PROFILE; owner, 03.10.2026).
 *
 *   GET  /api/survival/me/profile
 *        → { wallet, nickname: string|null, x: string|null, avatar: {contract,tokenId,name,image}|null,
 *            clan: string|null, stats: { best, rank: number|null, runs, favHero: string|null } }
 *        best / rank — the live season's board (survival_season_best; rank = place on the whole board,
 *        banned wallets not counted, ties by who got there first — as /api/survival/board orders it);
 *        0 / null with no accepted run this season. runs — accepted (finished) runs, all seasons.
 *        favHero — the hero of most of those runs.
 *
 *   POST /api/survival/me/profile { nickname }
 *        → { ok: true, nickname } · 400 { error: 'invalid' } · 409 { error: 'taken' } · 409 { error: 'already_set' }
 *        Set ONCE: 3–16 of [A-Za-z0-9_], unique without regard to case. No word filter (owner's call).
 *
 * Signed session + play access required (authCaller): 401 { ok:false, state:'unauthenticated'|'no_access' }.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const wallet = caller.wallet

    const [player, x, seasonQ, runsQ, heroes] = await Promise.all([
        playerRow(wallet),
        xHandleOf(wallet),
        supabaseAdmin.from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle(),
        supabaseAdmin.from('survival_runs').select('id', { count: 'exact', head: true }).eq('wallet', wallet).eq('status', 'finished'),
        fetchAll<{ hero: string | null }>(() => supabaseAdmin.from('survival_runs').select('hero, id')
            .eq('wallet', wallet).eq('status', 'finished').order('id'), { cap: 5000 }),
    ])
    if (player.error) return noServer('me.profile', player.error)
    const row = player.row ?? {}

    // The live season: the best run and where it stands.
    let best = 0
    let rank: number | null = null
    const seasonId = (seasonQ.data as { id: string } | null)?.id ?? null
    if (seasonId) {
        const { data: mine } = await supabaseAdmin.from('survival_season_best').select('score, achieved_at')
            .eq('season_id', seasonId).eq('wallet', wallet).maybeSingle()
        const m = mine as { score: number; achieved_at: string } | null
        if (m) {
            best = Number(m.score)
            if (!row.banned) rank = await rankOf(seasonId, best, m.achieved_at)
        }
    }

    const tally = new Map<string, number>()
    for (const r of heroes.rows) if (r.hero) tally.set(r.hero, (tally.get(r.hero) ?? 0) + 1)
    const favHero = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    return NextResponse.json({
        wallet,
        nickname: typeof row.nickname === 'string' ? row.nickname : null,
        x,
        avatar: avatarOf(row.avatar),
        clan: typeof row.clan === 'string' ? row.clan : null,
        stats: { best, rank, runs: runsQ.count ?? 0, favHero },
    }, { headers: NO_STORE })
}

/** 1 + the wallets ahead on the board (higher score, or the same score reached earlier), banned ones not counted. */
async function rankOf(seasonId: string, score: number, achievedAt: string): Promise<number | null> {
    const ahead = `score.gt.${score},and(score.eq.${score},achieved_at.lt."${achievedAt}")`
    const [all, bannedQ] = await Promise.all([
        supabaseAdmin.from('survival_season_best').select('wallet', { count: 'exact', head: true }).eq('season_id', seasonId).or(ahead),
        supabaseAdmin.from('survival_players').select('wallet').eq('banned', true).limit(1000),
    ])
    if (all.error) { console.error('[survival/me/profile] rank', all.error.message); return null }
    const banned = ((bannedQ.data as Array<{ wallet: string }> | null) ?? []).map((b) => b.wallet)
    let bannedAhead = 0
    if (banned.length) {
        const { count } = await supabaseAdmin.from('survival_season_best').select('wallet', { count: 'exact', head: true })
            .eq('season_id', seasonId).in('wallet', banned).or(ahead)
        bannedAhead = count ?? 0
    }
    return Math.max(1, (all.count ?? 0) - bannedAhead + 1)
}

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const wallet = caller.wallet
    const body = await readBody(req)
    const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : ''
    if (!NICK_RE.test(nickname)) return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE })

    const player = await playerRow(wallet)
    if (player.error) return noServer('me.nickname', player.error)
    if (player.row && typeof player.row.nickname === 'string' && player.row.nickname) {
        return NextResponse.json({ error: 'already_set', nickname: player.row.nickname }, { status: 409, headers: NO_STORE })
    }
    // Taken by anyone, in any case. The unique index on lower(nickname) settles a race below.
    const { data: same, error: tErr } = await supabaseAdmin.from('survival_players').select('wallet')
        .ilike('nickname', likeLiteral(nickname)).neq('wallet', wallet).limit(1)
    if (tErr) return noServer('me.nickname', tErr.message)
    if ((same as unknown[] | null)?.length) return NextResponse.json({ error: 'taken' }, { status: 409, headers: NO_STORE })

    if (!player.row && !(await ensurePlayer(wallet))) return noServer('me.nickname', 'player row')
    const { data: set, error } = await supabaseAdmin.from('survival_players')
        .update({ nickname, nickname_set_at: new Date().toISOString() })
        .eq('wallet', wallet).is('nickname', null).select('nickname')
    if (error) {
        if (error.code === '23505') return NextResponse.json({ error: 'taken' }, { status: 409, headers: NO_STORE })
        if (error.code === '23514') return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE })
        return noServer('me.nickname', error.message)
    }
    // Zero rows: set between the read and the write (another tab) — it stands.
    if (!(set as unknown[] | null)?.length) return NextResponse.json({ error: 'already_set' }, { status: 409, headers: NO_STORE })
    logEvent({ level: 'info', kind: 'profile.nickname', wallet, message: nickname })
    return NextResponse.json({ ok: true, nickname }, { headers: NO_STORE })
}
