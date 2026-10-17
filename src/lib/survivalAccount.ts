import { supabaseAdmin } from '@/lib/supabase'

/**
 * One account, several wallets (owner, 17.10.2026; supabase/migrations/20261017_survival_wallet_links.sql).
 *
 * An account IS its main wallet. A linked wallet (an Otherside Glyph wallet, a second MetaMask)
 * points at it in survival_wallet_links, and a session of a linked wallet acts as the account:
 * authCaller (lib/survivalRuns.ts) hands every route the account's wallet, so the save, the pass,
 * the runs and the place on the board are one. The wallet that signed stays the session's — it is
 * what the cookies name and what the WALLETS screen marks «this one».
 *
 * Not cached: a link takes effect on the very next request (the game reloads right after it), and
 * a lookup by primary key is one short query.
 */

export const MAX_ACCOUNT_WALLETS = 3
export const UNLINK_COOLDOWN_DAYS = 7

export interface Account {
    /** The main wallet: the account's id everywhere in the game's tables. */
    account: string
    /** Every wallet of the account, the main one first. */
    wallets: string[]
}

/** The account a wallet belongs to (itself when it is linked to nothing). null = no database. */
export async function accountOf(wallet: string): Promise<Account | null> {
    const w = wallet.toLowerCase()
    if (!supabaseAdmin || !/^0x[0-9a-f]{40}$/.test(w)) return null
    // One query for the common case: the wallet's own link (it is linked) or its links (it is a main one).
    const { data, error } = await supabaseAdmin.from('survival_wallet_links').select('wallet, account, linked_at')
        .or(`wallet.eq.${w},account.eq.${w}`).order('linked_at')
    if (error) { console.error('[survival/account] link', error.message); return null }
    const rows = (data ?? []) as Array<{ wallet: string; account: string }>
    const own = rows.find((r) => r.wallet === w)
    if (own) return walletsOf(own.account)
    return { account: w, wallets: [w, ...rows.map((r) => r.wallet)] }
}

/** The account's wallets, given its main wallet. */
export async function walletsOf(account: string): Promise<Account | null> {
    const a = account.toLowerCase()
    if (!supabaseAdmin) return null
    const { data, error } = await supabaseAdmin.from('survival_wallet_links').select('wallet').eq('account', a).order('linked_at')
    if (error) { console.error('[survival/account] wallets', error.message); return null }
    return { account: a, wallets: [a, ...((data ?? []) as Array<{ wallet: string }>).map((r) => r.wallet)] }
}

// ── Link codes ────────────────────────────────────────────────────────────────

/** 32 characters with nothing to misread (no 0/O, 1/I/L). 8 of them: ~10¹² codes for a 10-minute window. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/
/** Codes one wallet may make in ten minutes. */
const CODES_PER_WINDOW = 6

export const normCode = (raw: unknown): string | null => {
    const c = typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : ''
    return CODE_RE.test(c) ? c : null
}

export function linkPageUrl(code: string): string {
    return `https://www.apedroidz.com/droidz_survival/link?code=${code}`
}

export async function newLinkCode(wallet: string): Promise<{ code: string; expiresAt: string } | 'too_many_codes' | null> {
    if (!supabaseAdmin) return null
    const since = new Date(Date.now() - 10 * 60_000).toISOString()
    const { count, error: e1 } = await supabaseAdmin.from('survival_link_codes').select('code', { count: 'exact', head: true })
        .eq('wallet', wallet).gte('created_at', since)
    if (e1) { console.error('[survival/link] count', e1.message); return null }
    if ((count ?? 0) >= CODES_PER_WINDOW) return 'too_many_codes'
    for (let i = 0; i < 4; i++) {
        const bytes = crypto.getRandomValues(new Uint8Array(8))
        const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
        const { data, error } = await supabaseAdmin.from('survival_link_codes').insert({ code, wallet }).select('code, expires_at').single()
        if (!error && data) return { code: data.code as string, expiresAt: data.expires_at as string }
        if (error && !/duplicate/i.test(error.message)) { console.error('[survival/link] insert', error.message); return null }
    }
    return null
}

export interface CodeRow { code: string; wallet: string; expires_at: string; used_at: string | null; used_by: string | null }

export async function loadCode(code: string): Promise<CodeRow | null | 'error'> {
    if (!supabaseAdmin) return 'error'
    const { data, error } = await supabaseAdmin.from('survival_link_codes').select('code, wallet, expires_at, used_at, used_by').eq('code', code).maybeSingle()
    if (error) { console.error('[survival/link] code', error.message); return 'error' }
    return (data as CodeRow | null) ?? null
}

// ── What each side would keep ─────────────────────────────────────────────────

export interface AccountSummary {
    account: string
    wallets: string[]
    nickname: string | null
    /** Ape Mini in the save. */
    coins: number
    runs: number
    /** The live season: best score, tier, whether a pass is held. */
    best: number
    tier: number
    pass: boolean
    banned: boolean
}

export async function accountSummary(acc: Account, seasonId: string | null): Promise<AccountSummary | null> {
    if (!supabaseAdmin) return null
    const a = acc.account
    const [player, profile, season, best, pass] = await Promise.all([
        supabaseAdmin.from('survival_players').select('nickname, banned').eq('wallet', a).maybeSingle(),
        supabaseAdmin.from('survival_profiles').select('coins, runs').eq('wallet', a).maybeSingle(),
        seasonId ? supabaseAdmin.from('survival_profile_seasons').select('tier').eq('wallet', a).eq('season_id', seasonId).maybeSingle() : Promise.resolve({ data: null, error: null }),
        seasonId ? supabaseAdmin.from('survival_season_best').select('score').eq('wallet', a).eq('season_id', seasonId).maybeSingle() : Promise.resolve({ data: null, error: null }),
        // Any wallet of the account: after a link they all move to the main one anyway.
        supabaseAdmin.from('survival_entitlements').select('id').in('wallet', acc.wallets).eq('kind', 'season_pass')
            .or(seasonId ? `season_id.eq.${seasonId},season_id.is.null` : 'season_id.is.null').limit(1),
    ])
    const err = [player, profile, season, best, pass].find((r) => r.error)
    if (err?.error) { console.error('[survival/link] summary', err.error.message); return null }
    const banned = await supabaseAdmin.from('survival_players').select('wallet').in('wallet', acc.wallets).eq('banned', true).limit(1)
    return {
        account: a,
        wallets: acc.wallets,
        nickname: (player.data?.nickname as string | null) ?? null,
        coins: Number(profile.data?.coins ?? 0),
        runs: Number(profile.data?.runs ?? 0),
        best: Number((best.data as { score?: number } | null)?.score ?? 0),
        tier: Number((season.data as { tier?: number } | null)?.tier ?? 0),
        pass: ((pass.data ?? []) as unknown[]).length > 0,
        banned: !!player.data?.banned || ((banned.data ?? []) as unknown[]).length > 0,
    }
}
