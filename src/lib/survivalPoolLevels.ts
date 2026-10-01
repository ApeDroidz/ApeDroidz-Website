/**
 * The PRIZE POOL's levels, shared by the admin API and the panel (spltpnl → pool prizes).
 *
 * MUST match the game: `Droidz Survival on Ape/game/src/config/season.ts` → SEASON.milestones and
 * poolLevel(). The game shows an NFT prize locked while `unlock_level > poolLevel(poolApe)`, where
 * poolApe = solo + coop of survival_pool_stats (as /api/survival/pool serves it) — the admin side
 * judges «locked» by the very same numbers, so what the owner awards is what players saw open.
 */
export const POOL_MILESTONES = [10, 30, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000] as const

/** 1 + the goals the pool has passed (LVL 1 from 0 APE). */
export function poolLevel(ape: number): number {
    return 1 + POOL_MILESTONES.filter((m) => m <= ape).length
}

/** The APE at which level L opens (LVL 1 → 0). */
export function levelAt(level: number): number {
    return level <= 1 ? 0 : POOL_MILESTONES[level - 2] ?? POOL_MILESTONES[POOL_MILESTONES.length - 1]
}

/** Every level the scale has, 1…12. */
export const POOL_LEVELS: number[] = Array.from({ length: POOL_MILESTONES.length + 1 }, (_, i) => i + 1)

/** Pool APE as /api/survival/pool rounds it (the number the game levels by). */
export function poolApeOf(soloApe: unknown, coopApe: unknown): number {
    return Math.round((Number(soloApe ?? 0) + Number(coopApe ?? 0)) * 1e6) / 1e6
}
