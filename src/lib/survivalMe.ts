import { supabaseAdmin } from '@/lib/supabase'

/**
 * Shared bits of /api/survival/me/* — the player's own profile (owner, 03.10.2026): nickname set
 * once, X handle, NFT avatar, clan, stats. The wallet is always the signed session's
 * (survivalRuns.authCaller), never a body field.
 */

export const NO_STORE = { 'cache-control': 'no-store' }

/** 3–16 of [A-Za-z0-9_]; the database checks the same (20261003_survival_profile.sql). */
export const NICK_RE = /^[A-Za-z0-9_]{3,16}$/

/** The same rule as /api/user/update-x: 1–15 of [A-Za-z0-9_], an optional leading @. */
export const X_HANDLE_RE = /^@?[A-Za-z0-9_]{1,15}$/

/** The player row has to exist before a column of it can be set (other tables point at it). */
export async function ensurePlayer(wallet: string): Promise<boolean> {
    const { error } = await supabaseAdmin.from('survival_players')
        .upsert({ wallet, last_seen: new Date().toISOString() }, { onConflict: 'wallet' })
    if (error) console.error('[survival/me] player row', error.message)
    return !error
}

/**
 * The player row, all columns: `*` and not a list, so the routes keep working on a database the
 * profile migration has not reached yet (nickname / avatar simply read as absent there).
 */
export async function playerRow(wallet: string): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
    const { data, error } = await supabaseAdmin.from('survival_players').select('*').eq('wallet', wallet).maybeSingle()
    return { row: (data as Record<string, unknown> | null) ?? null, error: error?.message ?? null }
}

/** The X handle the site knows for this wallet (glitch_users, any spelling of the address). */
export async function xHandleOf(wallet: string): Promise<string | null> {
    const { data } = await supabaseAdmin.from('glitch_users').select('x_handle').ilike('wallet_address', wallet).limit(5)
    const rows = (data as Array<{ x_handle: string | null }> | null) ?? []
    return rows.find((r) => r.x_handle)?.x_handle ?? null
}

/** `_` is a LIKE wildcard; a nickname is matched case-insensitively and literally. */
export const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
