/**
 * How long a wallet gets the Droidz Survival beta for, as picked in the panel
 * (owner, 19.09: «параметр — на сколько я добавляю этому валлету бета-аксесс»).
 * Pure data, shared by the panel (client) and the allowlist API (server).
 * `null` seconds = no expiry.
 */
export const ACCESS_DURATIONS: ReadonlyArray<{ key: string; label: string; seconds: number | null }> = [
    { key: '1h', label: '1 hour', seconds: 3600 },
    { key: '3h', label: '3 hours', seconds: 3 * 3600 },
    { key: '6h', label: '6 hours', seconds: 6 * 3600 },
    { key: '12h', label: '12 hours', seconds: 12 * 3600 },
    { key: '24h', label: '24 hours', seconds: 24 * 3600 },
    { key: '2d', label: '2 days', seconds: 2 * 86400 },
    { key: '3d', label: '3 days', seconds: 3 * 86400 },
    { key: '5d', label: '5 days', seconds: 5 * 86400 },
    { key: '7d', label: '7 days', seconds: 7 * 86400 },
    { key: '2w', label: '2 weeks', seconds: 14 * 86400 },
    { key: '1mo', label: '1 month', seconds: 30 * 86400 },
    { key: '3mo', label: '3 months', seconds: 90 * 86400 },
    { key: '1y', label: '1 year', seconds: 365 * 86400 },
    { key: 'forever', label: 'forever', seconds: null },
]

export const DEFAULT_ACCESS_DURATION = 'forever'

/** The expiry instant for a duration key, or null for no expiry; undefined for an unknown key. */
export function expiryFor(key: string, from = Date.now()): Date | null | undefined {
    const d = ACCESS_DURATIONS.find((x) => x.key === key)
    if (!d) return undefined
    return d.seconds === null ? null : new Date(from + d.seconds * 1000)
}
