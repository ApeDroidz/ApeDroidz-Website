import { supabaseAdmin } from '@/lib/supabase'

/**
 * May this wallet play Droidz Survival right now — one rule for both doors (the site and the
 * Otherside cabinet): on the beta list, not revoked, not expired.
 *
 * Public launch (owner, 24.09.2026: «игра откроется всем — сначала на сайте, потом в автомате»):
 * SURVIVAL_PUBLIC=1 lets every signed-in wallet play, on both doors. A wallet whose access was
 * revoked, or that is banned, stays out either way. `until` caps the play cookie (null = none).
 */
export type Access = { allowed: boolean; until: Date | null; error?: string }

export const isPublic = () => process.env.SURVIVAL_PUBLIC === '1'

export async function accessFor(wallet: string): Promise<Access> {
    if (!supabaseAdmin) return { allowed: false, until: null, error: 'Service misconfigured' }
    const w = wallet.toLowerCase()
    const [{ data: row, error }, { data: player }] = await Promise.all([
        supabaseAdmin.from('survival_allowlist').select('revoked_at, expires_at').eq('wallet', w).maybeSingle(),
        supabaseAdmin.from('survival_players').select('banned').eq('wallet', w).maybeSingle(),
    ])
    if (error) return { allowed: false, until: null, error: error.message }
    if ((player as { banned?: boolean } | null)?.banned) return { allowed: false, until: null }
    const until = row?.expires_at ? new Date(row.expires_at as string) : null
    const listed = !!row && !row.revoked_at && (!until || until.getTime() > Date.now())
    if (listed) return { allowed: true, until }
    if (isPublic() && !row?.revoked_at) return { allowed: true, until: null }
    return { allowed: false, until: null }
}
