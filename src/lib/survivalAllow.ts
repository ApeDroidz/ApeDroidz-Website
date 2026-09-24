import { supabaseAdmin } from '@/lib/supabase'

/**
 * May this wallet play Droidz Survival right now — the beta allowlist rule in one place:
 * on the list, not revoked, not expired. `until` caps the play cookie (null = no expiry).
 *
 * Otherside: with SURVIVAL_OTHERSIDE_OPEN=1 every wallet that signs in from the Otherside
 * cabinet may play, list or not — the owner decides when the arcade opens to everyone.
 * The site's own door (/api/survival/access) keeps the list regardless.
 */
export type Access = { allowed: boolean; until: Date | null; error?: string }

export async function accessFor(wallet: string, opts: { otherside?: boolean } = {}): Promise<Access> {
    if (!supabaseAdmin) return { allowed: false, until: null, error: 'Service misconfigured' }
    const { data: row, error } = await supabaseAdmin.from('survival_allowlist')
        .select('revoked_at, expires_at').eq('wallet', wallet.toLowerCase()).maybeSingle()
    if (error) return { allowed: false, until: null, error: error.message }
    const until = row?.expires_at ? new Date(row.expires_at as string) : null
    const listed = !!row && !row.revoked_at && (!until || until.getTime() > Date.now())
    if (listed) return { allowed: true, until }
    // A revoked wallet stays out even when the cabinet is open to all.
    if (opts.otherside && process.env.SURVIVAL_OTHERSIDE_OPEN === '1' && !row?.revoked_at) return { allowed: true, until: null }
    return { allowed: false, until: null }
}
