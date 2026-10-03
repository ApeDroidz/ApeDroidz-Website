import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { logEvent } from '@/lib/survivalLog'
import { isCreatorWallet, sandboxFor, seasonOpenForAll, seasonVisibleFor } from '@/lib/survivalAccess'
import { mergeClientState, economyOf } from '@/lib/survivalEconomy'
import { loadEcon, saveEcon } from '@/lib/survivalEconomyStore'

/**
 * The player's progress, on the server.
 *
 *   GET  /api/survival/profile                → { ok, state, season: { seasonId, season, daily, passOwned, passTest } | null,
 *                                                  features: { season, seasonOpen, seasonPublic, creator, passOnSale, paidRuns, sandbox } — what the game may show this wallet }
 * seasonOpen — the season ladder (tiers, FREE/PASS rewards, LEVEL UP) is open to THIS wallet:
 * SURVIVAL_SEASON_OPEN=1 for everyone (seasonPublic), else the creator only (lib/survivalAccess.ts
 * isCreatorWallet — SURVIVAL_TEST_WALLETS or a preview wallet), who also gets the free test pass
 * (api/survival/creator-pass). passTest — the pass held is a test one (no pool, no PASS mark).
 * The Season screen is open to everyone (25.09.2026: it holds the pool and the leaderboard now); the
 * pass is on sale only where seasonVisibleFor says so (SURVIVAL_SEASON_OPEN=1, or a preview wallet).
 *                                              or { ok: true, state: null } for a wallet with none yet
 *   PUT  /api/survival/profile { state, seasonId, season, daily, clientVersion }
 *
 * `state` is the game's own MetaState minus what belongs to a season (season, daily) and minus
 * the local score list; the game owns the shape (systems/Save.ts), the server keeps it whole
 * and lifts a few numbers out for the panel. Season progress goes to its own row keyed by the
 * season, so ending a season touches nothing a player owns.
 *
 * Revisions (24.09.2026). `state.rev` counts the client's writes. A PUT carrying a LOWER revision
 * than the stored one is refused with `{ ok: false, state: 'stale', rev }` — that is an old tab or
 * a second device about to roll the player back, which is exactly how beta players lost trees and
 * resources. The write itself is a compare-and-set on `updated_at`, so two pushes racing each
 * other cannot interleave either; the loser is told to retry. GET also returns `owner` (the full
 * wallet, the caller's own) so the game can tell whose save sits in the browser.
 *
 * The economy is the SERVER's (26.09.2026, lib/survivalEconomy.ts): Ape Mini, salvage, gear,
 * unlocks, the trees, the season's XP and claims, the daily streak are written only by
 * /api/survival/economy and the run's finish. A PUT keeps the client's own business (settings,
 * keys, tips, which OWNED hero/weapon/gear it picked) and nothing else — forged coins or heroes in
 * the body are dropped by mergeClientState; the season and daily parts in the body are ignored.
 */
export const dynamic = 'force-dynamic'

const MAX_STATE_BYTES = 64 * 1024

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()

    const loaded = await loadEcon(caller.wallet)
    if (!loaded) return noServer()
    // A new epoch wiped the economy on this read: write it back now, so a PUT cannot find the old one.
    if (loaded.wiped) await saveEcon(caller.wallet, loaded, loaded.econ)
    const prof = loaded.stored ? { state: loaded.econ.state, updated_at: loaded.updatedAt } : null
    const season = loaded.seasonId
        ? { seasonId: loaded.seasonId, season: loaded.econ.season, daily: loaded.econ.daily, passOwned: loaded.passOwned, passTest: loaded.passTest }
        : null
    // Кто спрашивает — для таблицы рекордов: без этого игрок не видит в ней
    // ни себя, ни своего ника с кланом (владелец, 20.09). Кошелёк отдаём уже
    // сокращённым: полный адрес игре не нужен ни для чего, а на экране он всё
    // равно показывается в коротком виде.
    const [{ data: player }, { data: xRow }] = await Promise.all([
        supabaseAdmin.from('survival_players').select('clan').eq('wallet', caller.wallet).maybeSingle(),
        supabaseAdmin.from('glitch_users').select('x_handle').ilike('wallet_address', caller.wallet).maybeSingle(),
    ])
    const me = {
        wallet: `${caller.wallet.slice(0, 6)}…${caller.wallet.slice(-4)}`,
        x: (xRow as { x_handle: string | null } | null)?.x_handle ?? null,
        clan: (player as { clan: string | null } | null)?.clan ?? null,
    }

    return NextResponse.json(
        { ok: true, owner: caller.wallet, state: prof?.state ?? null, updatedAt: prof?.updated_at ?? null, season, me, features: { season: true, seasonOpen: seasonVisibleFor(caller.wallet), seasonPublic: seasonOpenForAll(), creator: isCreatorWallet(caller.wallet), passOnSale: seasonVisibleFor(caller.wallet), paidRuns: process.env.SURVIVAL_PAID_RUNS === '1', sandbox: sandboxFor(caller.wallet) } },
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
    const loaded = await loadEcon(caller.wallet)
    if (!loaded) return noServer()
    const rev = int(s.rev)
    const storedRev = int(loaded.stored?.rev)
    if (loaded.stored && rev < storedRev) {
        logEvent({ level: 'warn', kind: 'profile.stale', wallet: caller.wallet, message: `${rev} < ${storedRev}`, data: { rev, storedRev, clientVersion: body.clientVersion } })
        return NextResponse.json({ ok: false, state: 'stale', rev: storedRev }, { headers: { 'cache-control': 'no-store' } })
    }
    // The client's business over the server's economy: whatever coins, heroes or gear the body
    // carries, the stored ones stand (lib/survivalEconomy.ts mergeClientState).
    const merged = mergeClientState(loaded.econ.state, s)
    const eco = economyOf(merged)
    const life = eco.lifetime as { runs: number; bestScore: number }
    const row = {
        wallet: caller.wallet,
        state: { ...merged, rev },
        save_version: int(s.version, 100) || 1,
        coins: eco.coins as number,
        runs: life.runs,
        best_score: life.bestScore,
        selected_hero: typeof merged.selectedHero === 'string' ? merged.selectedHero.slice(0, 32) : null,
        client_version: typeof body.clientVersion === 'string' ? body.clientVersion.slice(0, 64) : null,
        updated_at: new Date().toISOString(),
    }

    // The player row must exist (FK); a profile save can arrive before any run does.
    await supabaseAdmin.from('survival_players').upsert({ wallet: caller.wallet, last_seen: row.updated_at }, { onConflict: 'wallet' })
    let error: { message: string; code?: string } | null = null
    let landed = true
    if (loaded.updatedAt) {
        // Compare-and-set: only over the row we just read. Zero rows = someone wrote in between.
        const upd = await supabaseAdmin.from('survival_profiles').update(row)
            .eq('wallet', caller.wallet).eq('updated_at', loaded.updatedAt).select('wallet')
        error = upd.error
        landed = !upd.error && (upd.data?.length ?? 0) > 0
    } else {
        const ins = await supabaseAdmin.from('survival_profiles').insert(row)
        error = ins.error
        if (ins.error?.code === '23505') { error = null; landed = false } // created by a racing push
    }
    if (error) { console.error('[survival/profile] put', error.message); logEvent({ level: 'error', kind: 'profile.save_failed', wallet: caller.wallet, message: error.message }); return noServer() }
    if (!landed) return NextResponse.json({ ok: false, state: 'retry' }, { headers: { 'cache-control': 'no-store' } })
    // A wiped economy (new epoch) goes to the season row too — the PUT above only wrote the save.
    if (loaded.wiped && loaded.seasonId) {
        await supabaseAdmin.from('survival_profile_seasons').upsert({ wallet: caller.wallet, season_id: loaded.seasonId, season: loaded.econ.season, daily: loaded.econ.daily, sxp: 0, tier: 0, updated_at: row.updated_at }, { onConflict: 'wallet,season_id' })
    }
    // The economy as it stands, so the game can drop anything its own copy made up.
    return NextResponse.json({ ok: true, updatedAt: row.updated_at, state: row.state, season: loaded.seasonId ? { seasonId: loaded.seasonId, season: loaded.econ.season, daily: loaded.econ.daily } : null }, { headers: { 'cache-control': 'no-store' } })
}
