import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { isCreatorWallet } from '@/lib/survivalAccess'

/**
 * Droidz Survival co-op on the site's side (game/docs/COOP.md, «Решения 15.10»).
 *
 * The rooms and the fight live on the relay (workers/coop-relay — Cloudflare Durable Objects); the
 * site does three things for it:
 *   1. says who may play co-op (coopFor) and signs a room token for them (api/survival/coop/token);
 *   2. opens the team's runs at START, all or none (api/survival/coop/start — called by the relay
 *      with the shared secret, never by a browser);
 *   3. keeps the co-op board (survival_coop_runs, settled as members finish — settleCoop).
 *
 * SURVIVAL_COOP_SECRET — the same value as the relay's COOP_SECRET. Unset: co-op is off.
 * SURVIVAL_COOP_RELAY  — the relay's address (https://…workers.dev or a custom domain).
 * SURVIVAL_COOP_PUBLIC — '1' opens co-op to every wallet; otherwise the beta testers only.
 */

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000

export const coopSecret = (): string => process.env.SURVIVAL_COOP_SECRET ?? ''
export const coopRelay = (): string => (process.env.SURVIVAL_COOP_RELAY ?? '').replace(/\/$/, '')
export const coopConfigured = (): boolean => coopSecret().length >= 16 && coopRelay().length > 0

/**
 * May this wallet play co-op (owner, 15.10.2026: «включаем только для тестеров — бета-тест аксесс на
 * сайте у нас есть»): a row on the beta list (survival_allowlist) not revoked and not expired, or
 * the creator; everyone once SURVIVAL_COOP_PUBLIC=1. Fails closed on a read error.
 */
export async function coopFor(wallet: string): Promise<boolean> {
    if (!coopConfigured()) return false
    if (process.env.SURVIVAL_COOP_PUBLIC === '1') return true
    const w = wallet.toLowerCase()
    if (isCreatorWallet(w)) return true
    if (!supabaseAdmin) return false
    const { data, error } = await supabaseAdmin.from('survival_allowlist').select('revoked_at, expires_at').eq('wallet', w).maybeSingle()
    if (error || !data) return false
    const row = data as { revoked_at: string | null; expires_at: string | null }
    if (row.revoked_at) return false
    return !row.expires_at || Date.parse(row.expires_at) > Date.now()
}

const b64url = (s: string | Buffer): string => Buffer.from(s).toString('base64url')

/** `base64url(json).base64url(hmac-sha256(base64url(json)))` — the relay's token.ts reads exactly this. */
export function signCoopToken(wallet: string, name: string): { token: string; expiresAt: number } {
    const expiresAt = Date.now() + TOKEN_TTL_MS
    const body = b64url(JSON.stringify({ w: wallet.toLowerCase(), n: name.slice(0, 24), exp: expiresAt }))
    const sig = createHmac('sha256', coopSecret()).update(body).digest('base64url')
    return { token: `${body}.${sig}`, expiresAt }
}

/** The relay's call: the shared secret in `x-coop-secret`, compared in constant time. */
export function relayAuthorized(header: string | null): boolean {
    const secret = coopSecret()
    if (!header || secret.length < 16) return false
    const a = Buffer.from(header)
    const b = Buffer.from(secret)
    return a.length === b.length && timingSafeEqual(a, b)
}

interface MemberRun { id: string; wallet: string; status: string; score: number; wave: number; kills: number; hero: string | null; server_duration_ms: number | null }

/**
 * The members' reports, checked against each other (owner, 15.10.2026: «каждый участник отправляет
 * своё, сервер сверяет»). Every member's run already passed the envelope on its own (its waves,
 * kills and score against its own clock). What only the team can show: the team is on ONE wave, so
 * a member who claims a wave beyond every teammate's by more than WAVE_SLACK, in a run no longer
 * than theirs, made it up — his run is left out of the team's row and the row says so. A member
 * who left early has a shorter run and a lower wave; that is not a lie and is not flagged.
 */
const WAVE_SLACK = 2
const DURATION_SLACK_MS = 30_000
export function waveOutliers(runs: Pick<MemberRun, 'wallet' | 'wave' | 'server_duration_ms'>[]): string[] {
    if (runs.length < 2) return []
    return runs.filter((r) => {
        const others = runs.filter((o) => o !== r)
        const top = Math.max(...others.map((o) => o.wave ?? 0))
        const longest = Math.max(...others.map((o) => o.server_duration_ms ?? 0))
        return (r.wave ?? 0) > top + WAVE_SLACK && (r.server_duration_ms ?? 0) <= longest + DURATION_SLACK_MS
    }).map((r) => r.wallet)
}

/**
 * The team's row from its members' runs, once a member's finish lands (api/survival/run/finish)
 * and whenever a member's run is closed some other way. The score is the members' counted runs
 * summed; the wave is the furthest a counted member reached; a rejected member counts nothing (and
 * the row says so in `flags`). The row is final when no member's run is still open — until then
 * it stands as `started` with what is known, so a team whose last member is still playing is not
 * on the board yet.
 */
export async function settleCoop(coopId: string): Promise<void> {
    if (!supabaseAdmin || !coopId) return
    const { data, error } = await supabaseAdmin.from('survival_runs')
        .select('id, wallet, status, score, wave, kills, hero, server_duration_ms').eq('coop_id', coopId)
    if (error || !data) { if (error) console.error('[survival/coop] settle', error.message); return }
    const runs = data as MemberRun[]
    const open = runs.some((r) => r.status === 'started')
    const finished = runs.filter((r) => r.status === 'finished')
    const outliers = open ? [] : waveOutliers(finished)
    const counted = finished.filter((r) => !outliers.includes(r.wallet))
    const flags = [
        ...runs.filter((r) => r.status === 'rejected').map((r) => `member_rejected:${r.wallet}`),
        ...outliers.map((w) => `wave_outlier:${w}`),
    ]
    const row = {
        score: counted.reduce((n, r) => n + (r.score ?? 0), 0),
        kills: counted.reduce((n, r) => n + (r.kills ?? 0), 0),
        wave: counted.reduce((n, r) => Math.max(n, r.wave ?? 0), 0),
        members: runs.map((r) => ({ wallet: r.wallet, run_id: r.id, status: r.status, score: r.score, wave: r.wave, kills: r.kills, hero: r.hero })),
        flags,
        status: open ? 'started' : counted.length ? 'finished' : 'void',
        ...(open ? {} : { finished_at: new Date().toISOString() }),
    }
    const { error: uErr } = await supabaseAdmin.from('survival_coop_runs').update(row).eq('id', coopId)
    if (uErr) console.error('[survival/coop] settle write', uErr.message)
}
