import { supabaseAdmin } from '@/lib/supabase'
import { economyOf, freshEconomy, seasonOf, dailyOf, type Econ, type SaveState } from '@/lib/survivalEconomy'
import { logEvent } from '@/lib/survivalLog'

/**
 * Reading and writing the server's economy (lib/survivalEconomy.ts) — the save row and the season
 * row, together.
 *
 * The EPOCH is the wipe (Beta Season 0, a new season with a clean start): SURVIVAL_SAVE_EPOCH names
 * the current one, and a save from an older epoch has its economy reset the first time it is read —
 * here, on the server, so a browser still holding the old progress cannot bring it back (its
 * economy fields are ignored by the profile PUT anyway). Unset = no wipe, nothing changes.
 *
 * The season pass is the paid entitlement's, not the save's: whatever the row says, a pass on
 * record is held.
 */

export const currentEpoch = (): string => (process.env.SURVIVAL_SAVE_EPOCH ?? '').trim()

export interface Loaded {
    econ: Econ
    /** The stored save as it was (null: no row yet). */
    stored: SaveState | null
    updatedAt: string | null
    seasonId: string | null
    /** The season row's updated_at as read (null: no row yet) — its compare-and-set. */
    seasonUpdatedAt: string | null
    /** The economy was reset for a new epoch on this read (and must be written back). */
    wiped: boolean
    passOwned: boolean
}

export async function liveSeasonId(): Promise<string | null> {
    const { data } = await supabaseAdmin.from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle()
    return (data as { id: string } | null)?.id ?? null
}

export async function loadEcon(wallet: string, seasonId?: string | null): Promise<Loaded | null> {
    const sid = seasonId === undefined ? await liveSeasonId() : seasonId
    const [prof, ps, pass] = await Promise.all([
        supabaseAdmin.from('survival_profiles').select('state, updated_at').eq('wallet', wallet).maybeSingle(),
        sid ? supabaseAdmin.from('survival_profile_seasons').select('season, daily, updated_at').eq('wallet', wallet).eq('season_id', sid).maybeSingle() : Promise.resolve({ data: null, error: null }),
        sid ? supabaseAdmin.from('survival_entitlements').select('id').eq('wallet', wallet).eq('kind', 'season_pass').or(`season_id.eq.${sid},season_id.is.null`).limit(1)
            : Promise.resolve({ data: [], error: null }),
    ])
    if (prof.error) { console.error('[survival/economy] load', prof.error.message); return null }
    const row = prof.data as { state: SaveState | null; updated_at: string } | null
    if (ps.error) { console.error('[survival/economy] load season', ps.error.message); return null }
    const psRow = ps.data as { season: unknown; daily: unknown; updated_at?: string } | null
    const stored = row?.state ?? null
    let state: SaveState = { ...(stored ?? {}), ...economyOf(stored ?? {}) }
    let season = seasonOf(psRow?.season, sid ?? '')
    let daily = dailyOf(psRow?.daily)
    // The daily streak outlives a season: a new season's row starts with the streak the player
    // carried out of the last one (its quests do not carry). Read once per player per season —
    // the first write stores it in the new row. «Miss a day and it starts over», not «a new
    // season starts it over» (dailyClaim.ts, the 14- and 30-day chests).
    if (sid && !psRow && stored) {
        const { data: prev } = await supabaseAdmin.from('survival_profile_seasons').select('daily')
            .eq('wallet', wallet).neq('season_id', sid).order('updated_at', { ascending: false }).limit(1).maybeSingle()
        const p = dailyOf((prev as { daily?: unknown } | null)?.daily)
        if (p.lastClaimDay) daily = { ...daily, lastClaimDay: p.lastClaimDay, streak: p.streak }
    }
    let wiped = false
    const epoch = currentEpoch()
    if (epoch && (state.epoch as string) !== epoch) {
        state = { ...state, ...freshEconomy(epoch) }
        season = seasonOf({}, sid ?? '')
        daily = dailyOf({})
        wiped = !!stored // a brand-new player has nothing to wipe
    }
    const passOwned = ((pass.data as unknown[] | null)?.length ?? 0) > 0
    if (passOwned) season.pass = true
    return { econ: { state, season, daily }, stored, updatedAt: row?.updated_at ?? null, seasonId: sid, seasonUpdatedAt: psRow?.updated_at ?? null, wiped, passOwned }
}

/**
 * Writes an economy change: the save row and the season row in ONE transaction, each by
 * compare-and-set on the updated_at we read (survival_econ_write, migration 20260929_survival_econ_write):
 * a racing write makes this 'conflict' and nothing is written — the caller retries from a fresh
 * read. Written one after the other, a request re-reading between the two saw the new coins with
 * the old claim marks and paid a claim twice; a failed season write left coins without the mark.
 * Until that migration is applied, the two writes as before (writeTwoSteps).
 * The save's revision moves on, so an older copy in a browser is refused as stale afterwards.
 * `clientState` (optional) is the client part to keep — the stored one otherwise.
 */
export async function saveEcon(wallet: string, loaded: Loaded, next: Econ, clientState?: SaveState): Promise<'ok' | 'conflict' | 'error'> {
    const base = (clientState ?? loaded.stored ?? {}) as SaveState
    const eco = economyOf(next.state)
    const storedRev = typeof (loaded.stored?.rev) === 'number' ? (loaded.stored!.rev as number) : 0
    const clientRev = typeof base.rev === 'number' ? base.rev : 0
    const state: SaveState = { ...base, ...eco, rev: Math.max(storedRev, clientRev) + 1 }
    delete state.season
    delete state.daily
    const life = eco.lifetime as { runs: number; bestScore: number }
    const now = new Date().toISOString()
    const row = {
        wallet, state, coins: eco.coins as number, runs: life.runs, best_score: life.bestScore,
        selected_hero: typeof state.selectedHero === 'string' ? state.selectedHero.slice(0, 32) : null,
        save_version: typeof state.version === 'number' ? state.version : 1, updated_at: now,
    }
    const rpc = await supabaseAdmin.rpc('survival_econ_write', {
        p_wallet: wallet, p_prof_updated_at: loaded.updatedAt,
        p_profile: { state, coins: row.coins, runs: row.runs, best_score: row.best_score, selected_hero: row.selected_hero, save_version: row.save_version },
        p_season_id: loaded.seasonId, p_season_updated_at: loaded.seasonUpdatedAt,
        p_season: next.season, p_daily: next.daily, p_sxp: next.season.sxp, p_tier: next.season.tier, p_now: now,
    })
    const missing = rpc.error && (rpc.error.code === 'PGRST202' || /could not find the function/i.test(rpc.error.message))
    if (missing) {
        const w = await writeTwoSteps(wallet, loaded, next, row, now)
        if (w !== 'ok') return w
    } else if (rpc.error) {
        console.error('[survival/economy] save', rpc.error.message)
        logEvent({ level: 'warn', kind: 'profile.season_failed', wallet, message: rpc.error.message })
        return 'error'
    } else if (rpc.data !== 'ok') {
        return 'conflict'
    }
    if (loaded.wiped) logEvent({ level: 'info', kind: 'economy.wiped', wallet, message: `epoch ${currentEpoch()}` })
    // The routes hand `next.state` back to the game; it must carry the revision just stored, or
    // the game's next PUT is one behind and refused as stale (two spends in a row rolled back a
    // hero pick or worn gear). act/runReward work on a clone, so this touches nothing else.
    next.state.rev = state.rev
    return 'ok'
}

/** The two writes of before survival_econ_write: the save by compare-and-set, the season by upsert. */
async function writeTwoSteps(wallet: string, loaded: Loaded, next: Econ, row: Record<string, unknown>, now: string): Promise<'ok' | 'conflict' | 'error'> {
    await supabaseAdmin.from('survival_players').upsert({ wallet, last_seen: now }, { onConflict: 'wallet' })
    if (loaded.updatedAt) {
        const upd = await supabaseAdmin.from('survival_profiles').update(row).eq('wallet', wallet).eq('updated_at', loaded.updatedAt).select('wallet')
        if (upd.error) { console.error('[survival/economy] save', upd.error.message); return 'error' }
        if ((upd.data?.length ?? 0) === 0) return 'conflict'
    } else {
        const ins = await supabaseAdmin.from('survival_profiles').insert(row)
        if (ins.error?.code === '23505') return 'conflict'
        if (ins.error) { console.error('[survival/economy] insert', ins.error.message); return 'error' }
    }
    if (loaded.seasonId) {
        const { error } = await supabaseAdmin.from('survival_profile_seasons').upsert({
            wallet, season_id: loaded.seasonId, season: next.season, daily: next.daily,
            sxp: next.season.sxp, tier: next.season.tier, updated_at: now,
        }, { onConflict: 'wallet,season_id' })
        if (error) { logEvent({ level: 'warn', kind: 'profile.season_failed', wallet, message: error.message }); return 'error' }
    }
    return 'ok'
}

/** A read-modify-write with retries on a racing write. `change` returns null to write nothing. */
export async function withEcon<T>(
    wallet: string, seasonId: string | null | undefined,
    change: (l: Loaded) => { next: Econ; out: T } | { fail: string } | null,
): Promise<{ ok: true; out: T | null; econ: Econ; loaded: Loaded } | { ok: false; error: string }> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const loaded = await loadEcon(wallet, seasonId)
        if (!loaded) return { ok: false, error: 'no_server' }
        const c = change(loaded)
        if (c === null) {
            if (loaded.wiped) { const w = await saveEcon(wallet, loaded, loaded.econ); if (w === 'conflict') continue }
            return { ok: true, out: null, econ: loaded.econ, loaded }
        }
        if ('fail' in c) return { ok: false, error: c.fail }
        const w = await saveEcon(wallet, loaded, c.next)
        if (w === 'ok') return { ok: true, out: c.out, econ: c.next, loaded }
        if (w === 'error') return { ok: false, error: 'no_server' }
    }
    return { ok: false, error: 'busy' }
}
