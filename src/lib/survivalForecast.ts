import { supabaseAdmin } from '@/lib/supabase'

/**
 * The season pool, split the way it will be paid (game/docs/PRIZE_POOL.md §2–3), and what a given
 * player would take if the season ended right now (owner, 25.09.2026: «калькулятор — учитывается скор
 * человека в сезоне, количество участников, пул, и просчитывается, сколько от пула ты сейчас
 * прогнозно получишь»).
 *
 *   reserve   (1 − payout_pct) of the pool is frozen for the next season's start — shown, not paid;
 *   eligible  only season-pass holders share the pool (owner, 25.09): everyone plays and levels up,
 *             the pool goes to those who bought in;
 *   places    K = clamp(ceil(N × paid_pct_of_field), min_places, max_places), never more than N;
 *   share     place r takes r^(−s) / Σ_{i≤K} i^(−s) of the payout (s = curve_s, 1.0 «harmonic»).
 *
 * Ranks are by each wallet's best accepted score this season — the same number the season board shows.
 */

export type Standing = { wallet: string; best: number; hasPass: boolean }
export type SeasonRules = { payoutPct: number; curveS: number; paidPctOfField: number; minPlaces: number; maxPlaces: number }

export type Forecast = {
    poolApe: number; reserveApe: number; reservePct: number; payoutApe: number
    /** Pass holders with a scored run — the field the pool is split across. */
    eligible: number; passHolders: number; places: number
    /** The best score that is paid right now (the K-th place), null with nobody eligible. */
    cutoffScore: number | null
    me?: {
        best: number; hasPass: boolean
        /** Where this wallet stands among pass holders — as it is, or as it would with a pass. */
        rank: number | null; forecastApe: number
    }
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

export function placesFor(n: number, rules: SeasonRules): number {
    if (n <= 0) return 0
    return Math.min(n, Math.max(rules.minPlaces, Math.min(rules.maxPlaces, Math.ceil(n * rules.paidPctOfField))))
}

/** Share of the payout for place r (1-based) of K. */
export function shareOf(r: number, k: number, s: number): number {
    if (r < 1 || r > k) return 0
    let sum = 0
    for (let i = 1; i <= k; i++) sum += Math.pow(i, -s)
    return Math.pow(r, -s) / sum
}

export function forecast(poolApe: number, rules: SeasonRules, standings: Standing[], wallet?: string): Forecast {
    const payout = poolApe * rules.payoutPct
    const eligible = standings.filter((s) => s.hasPass && s.best > 0).sort((a, b) => b.best - a.best)
    const k = placesFor(eligible.length, rules)
    const out: Forecast = {
        poolApe: r6(poolApe), reserveApe: r6(poolApe - payout), reservePct: Math.round((1 - rules.payoutPct) * 100), payoutApe: r6(payout),
        eligible: eligible.length, passHolders: standings.filter((s) => s.hasPass).length, places: k,
        cutoffScore: k > 0 ? eligible[k - 1].best : null,
    }
    if (!wallet) return out
    const w = wallet.toLowerCase()
    const mine = standings.find((s) => s.wallet.toLowerCase() === w)
    const best = mine?.best ?? 0
    const hasPass = mine?.hasPass ?? false
    if (best <= 0) { out.me = { best, hasPass, rank: null, forecastApe: 0 }; return out }
    // With a pass the player is in the field as it is; without one, the question is «what would I
    // take if I had one» — the same field with this player added.
    const field = hasPass ? eligible : [...eligible, { wallet: w, best, hasPass: true }].sort((a, b) => b.best - a.best)
    const rank = field.findIndex((s) => s.wallet.toLowerCase() === w) + 1
    const kk = placesFor(field.length, rules)
    out.me = { best, hasPass, rank, forecastApe: r6(payout * shareOf(rank, kk, rules.curveS)) }
    return out
}

/** The live season's pool, rules and standings, read fresh. null when no season is live. */
export async function loadForecast(wallet?: string): Promise<(Forecast & { seasonId: string }) | null> {
    const { data: season } = await supabaseAdmin.from('survival_seasons')
        .select('id, payout_pct, curve_s, paid_pct_of_field, min_places, max_places').eq('status', 'live').limit(1).maybeSingle()
    if (!season) return null
    const [{ data: st }, { data: rows }] = await Promise.all([
        supabaseAdmin.rpc('survival_pool_stats', { p_season: season.id }),
        supabaseAdmin.rpc('survival_season_standings', { p_season: season.id }),
    ])
    const p = ((st as Array<Record<string, number | string>> | null) ?? [])[0] ?? {}
    const pool = Number(p.solo_ape ?? 0) + Number(p.coop_ape ?? 0)
    const rules: SeasonRules = {
        payoutPct: Number(season.payout_pct ?? 0.9), curveS: Number(season.curve_s ?? 1),
        paidPctOfField: Number(season.paid_pct_of_field ?? 0.1), minPlaces: Number(season.min_places ?? 3), maxPlaces: Number(season.max_places ?? 100),
    }
    const standings = ((rows as Array<{ wallet: string; best: number | string; has_pass: boolean }> | null) ?? [])
        .map((r) => ({ wallet: r.wallet, best: Number(r.best), hasPass: r.has_pass }))
    return { seasonId: season.id, ...forecast(pool, rules, standings, wallet) }
}
