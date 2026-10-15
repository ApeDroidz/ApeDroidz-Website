import { supabase } from '@/lib/supabase'

/**
 * The prize pool pushed live (owner, 15.10.2026: «как только в пул попадает новая деньга он должен
 * везде обновляться сразу же»). Every booking into the live season's ledger is broadcast by the
 * database on the public Realtime channel `survival-pool`, event `pool` (migration 20261015d), with the
 * season's fresh totals. A page subscribes once and redraws from the message — no request back.
 * The game listens to the same channel (its SeasonPool.ts); /api/survival/pool stays the first load.
 */
export type PoolPush = {
    seasonId: string
    soloApe: number
    coopApe: number
    players: number
    games: number
    payoutPct: number
}

const listeners = new Set<(p: PoolPush) => void>()
let channel: ReturnType<typeof supabase.channel> | null = null

/**
 * Calls `on` with every push; returns the unsubscribe. One channel per page however many parts listen
 * (the client hands back the same channel for the same name, and a second subscribe would clash).
 */
export function subscribePoolLive(on: (p: PoolPush) => void): () => void {
    listeners.add(on)
    if (!channel) {
        channel = supabase.channel('survival-pool')
            .on('broadcast', { event: 'pool' }, ({ payload }) => {
                const p = payload as Partial<PoolPush> | undefined
                if (!p || typeof p.soloApe !== 'number' || typeof p.coopApe !== 'number') return
                const push: PoolPush = {
                    seasonId: String(p.seasonId ?? ''),
                    soloApe: p.soloApe, coopApe: p.coopApe,
                    players: Number(p.players ?? 0), games: Number(p.games ?? 0),
                    payoutPct: typeof p.payoutPct === 'number' ? p.payoutPct : 0.9,
                }
                for (const l of listeners) l(push)
            })
            .subscribe()
    }
    return () => {
        listeners.delete(on)
        if (listeners.size === 0 && channel) { void supabase.removeChannel(channel); channel = null }
    }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6

/** A pool answer of /api/survival/pool with a push applied (same sums the route makes). */
export function applyPoolPush<T extends { seasonId: string; poolApe: number; players: number; games: number; reserveApe: number; payoutApe: number }>(pool: T, p: PoolPush): T {
    if (p.seasonId && pool.seasonId && p.seasonId !== pool.seasonId) return pool
    const total = round(p.soloApe + p.coopApe)
    return { ...pool, poolApe: total, players: p.players, games: p.games, payoutApe: round(total * p.payoutPct), reserveApe: round(total * (1 - p.payoutPct)) }
}
