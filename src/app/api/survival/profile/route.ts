import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { logEvent } from '@/lib/survivalLog'

/**
 * The player's progress, on the server.
 *
 *   GET  /api/survival/profile                → { ok, state, season: { seasonId, season, daily } | null }
 *                                              or { ok: true, state: null } for a wallet with none yet
 *   PUT  /api/survival/profile { state, seasonId, season, daily, clientVersion }
 *
 * `state` is the game's own MetaState minus what belongs to a season (season, daily) and minus
 * the local score list; the game owns the shape (systems/Save.ts), the server keeps it whole
 * and lifts a few numbers out for the panel. Season progress goes to its own row keyed by the
 * season, so ending a season touches nothing a player owns.
 *
 * Ape Mini is an in-game currency with no way out (the owner: «конвертацию не делаем»), so
 * the client's count is accepted as is, bounded to sane integers; the run ledger keeps the
 * server's own idea of what was earned for the day that changes.
 */
export const dynamic = 'force-dynamic'

const MAX_STATE_BYTES = 64 * 1024

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()

    const { data: prof, error } = await supabaseAdmin
        .from('survival_profiles').select('state, save_version, updated_at').eq('wallet', caller.wallet).maybeSingle()
    if (error) { console.error('[survival/profile] get', error.message); return noServer() }

    const { data: live } = await supabaseAdmin.from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle()
    let season: { seasonId: string; season: unknown; daily: unknown } | null = null
    if (live) {
        const { data: ps } = await supabaseAdmin
            .from('survival_profile_seasons').select('season, daily').eq('wallet', caller.wallet).eq('season_id', live.id).maybeSingle()
        season = { seasonId: live.id, season: ps?.season ?? null, daily: ps?.daily ?? null }
    }
    return NextResponse.json(
        { ok: true, state: prof?.state ?? null, updatedAt: prof?.updated_at ?? null, season },
        { headers: { 'cache-control': 'no-store' } },
    )
}

export async function PUT(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    const state = body.state
    if (!state || typeof state !== 'object' || JSON.stringify(state).length > MAX_STATE_BYTES) {
        return NextResponse.json({ ok: false, state: 'malformed' })
    }
    const s = state as Record<string, unknown>
    const int = (v: unknown, max = 1e9): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0)
    const lifetime = (s.lifetime && typeof s.lifetime === 'object' ? s.lifetime : {}) as Record<string, unknown>
    const row = {
        wallet: caller.wallet,
        state: s,
        save_version: int(s.version, 100) || 1,
        coins: int(s.coins),
        runs: int(lifetime.runs),
        best_score: int(lifetime.bestScore),
        selected_hero: typeof s.selectedHero === 'string' ? s.selectedHero.slice(0, 32) : null,
        client_version: typeof body.clientVersion === 'string' ? body.clientVersion.slice(0, 64) : null,
        updated_at: new Date().toISOString(),
    }
    // The player row must exist (FK); a profile save can arrive before any run does.
    await supabaseAdmin.from('survival_players').upsert({ wallet: caller.wallet, last_seen: row.updated_at }, { onConflict: 'wallet' })
    const { error } = await supabaseAdmin.from('survival_profiles').upsert(row, { onConflict: 'wallet' })
    if (error) { console.error('[survival/profile] put', error.message); logEvent({ level: 'error', kind: 'profile.save_failed', wallet: caller.wallet, message: error.message }); return noServer() }

    if (typeof body.seasonId === 'string' && body.season && typeof body.season === 'object') {
        const season = body.season as Record<string, unknown>
        const { error: sErr } = await supabaseAdmin.from('survival_profile_seasons').upsert({
            wallet: caller.wallet, season_id: body.seasonId.slice(0, 32),
            season, daily: body.daily && typeof body.daily === 'object' ? body.daily : {},
            sxp: int(season.sxp), tier: int(season.tier, 100), updated_at: row.updated_at,
        }, { onConflict: 'wallet,season_id' })
        // An unknown season id is not worth failing the save over — the profile itself landed.
        if (sErr) console.warn('[survival/profile] season', sErr.message)
    }
    return NextResponse.json({ ok: true, updatedAt: row.updated_at }, { headers: { 'cache-control': 'no-store' } })
}
