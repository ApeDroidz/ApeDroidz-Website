import { supabaseAdmin } from '@/lib/supabase'

/**
 * May this wallet play Droidz Survival right now — one rule for both doors (the site and the
 * Otherside cabinet): on the beta list, not revoked, not expired.
 *
 * Open beta (owner, 28.09.2026: «просто снять лок»): every signed-in wallet plays, on both
 * doors. SURVIVAL_PUBLIC=0 closes it back to the beta list — the kill switch, no code change.
 * A wallet whose access was revoked, or that is banned, stays out either way. `until` caps the
 * play cookie (null = none).
 */
export type Access = { allowed: boolean; until: Date | null; error?: string }

export const isPublic = () => process.env.SURVIVAL_PUBLIC !== '0'

export async function accessFor(wallet: string): Promise<Access> {
    if (!supabaseAdmin) return { allowed: false, until: null, error: 'Service misconfigured' }
    const w = wallet.toLowerCase()
    const [{ data: row, error }, { data: player, error: pErr }] = await Promise.all([
        supabaseAdmin.from('survival_allowlist').select('revoked_at, expires_at').eq('wallet', w).maybeSingle(),
        supabaseAdmin.from('survival_players').select('banned').eq('wallet', w).maybeSingle(),
    ])
    // Fail closed: a ban that could not be read is not a ban that was checked.
    if (error || pErr) return { allowed: false, until: null, error: (error ?? pErr)!.message }
    if ((player as { banned?: boolean } | null)?.banned) return { allowed: false, until: null }
    if (row?.revoked_at) return { allowed: false, until: null }
    // Open beta: every wallet plays, with no countdown — a beta-list expiry means nothing while
    // the door is open for all. SURVIVAL_PUBLIC=0 brings the list and its dates back.
    if (isPublic()) return { allowed: true, until: null }
    const until = row?.expires_at ? new Date(row.expires_at as string) : null
    const listed = !!row && (!until || until.getTime() > Date.now())
    if (listed) return { allowed: true, until }
    return { allowed: false, until: null }
}
