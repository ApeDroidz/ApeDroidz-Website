import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { closeAbandoned, noServer, readBody, RUN_COLUMNS, type RunRow } from '@/lib/survivalRuns'
import { RUN_TTL_MS } from '@/lib/survivalEnvelope'
import { economyOf, RETIRED_HEROES, type SaveState } from '@/lib/survivalEconomy'
import { currentEpoch } from '@/lib/survivalEconomyStore'
import { accessFor } from '@/lib/survivalAllow'
import { coopFor, relayAuthorized } from '@/lib/survivalCoop'
import { logEvent } from '@/lib/survivalLog'

/**
 * POST /api/survival/coop/start — the co-op relay's call when the host presses START (never a
 * browser's: `x-coop-secret` must be SURVIVAL_COOP_SECRET).
 *
 *   { roomId, host, members: [{ wallet, hero, weapon, clientVersion }] }   2–4 members
 *   → { ok: true, coopId, seed, runs: { <wallet>: <runId> } }
 *   → { ok: false, state, wallet? }   nothing was spent for anyone
 *
 * Every member is checked the way a solo run/start checks its one player — the gate (co-op open to
 * him, not banned), a hero he owns, not too many starts this hour — and his still-open runs are
 * closed (counted from their last pulse, or refunded) BEFORE anything is spent. Then one
 * transaction opens a run per member and, when runs are paid, spends one run of each (the welcome
 * gift first): survival_coop_open. One member without a run undoes it all, and the reply names
 * him — the room takes him off READY and says why (owner, 15.10.2026: «всё или ничего»).
 */
export const dynamic = 'force-dynamic'

const STARTS_PER_HOUR = 40
const WALLET = /^0x[0-9a-f]{40}$/

interface Member { wallet: string; hero: string; weapon: string; clientVersion: string }

export async function POST(req: NextRequest) {
    if (!relayAuthorized(req.headers.get('x-coop-secret'))) return NextResponse.json({ ok: false, state: 'forbidden' }, { status: 403 })
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    const str = (v: unknown, max = 40): string => (typeof v === 'string' ? v.slice(0, max) : '')
    const roomId = str(body.roomId, 16)
    const raw = Array.isArray(body.members) ? (body.members as Record<string, unknown>[]) : []
    const members: Member[] = raw.map((m) => ({ wallet: str(m.wallet, 64).toLowerCase(), hero: str(m.hero), weapon: str(m.weapon), clientVersion: str(m.clientVersion, 64) }))
    if (!roomId || members.length < 2 || members.length > 4) return NextResponse.json({ ok: false, state: 'malformed' })
    if (new Set(members.map((m) => m.wallet)).size !== members.length || members.some((m) => !WALLET.test(m.wallet))) {
        return NextResponse.json({ ok: false, state: 'malformed' })
    }
    const host = str(body.host, 64).toLowerCase()
    const now = Date.now()

    const { data: season, error: sErr } = await supabaseAdmin.from('survival_seasons').select('id, ends_at').eq('status', 'live').limit(1).maybeSingle()
    if (sErr) return noServer('coop.start.season', sErr.message)
    if (!season) return NextResponse.json({ ok: false, state: 'no_season' })
    const s = season as { id: string; ends_at: string | null }
    if (s.ends_at && Date.parse(s.ends_at) <= now) return NextResponse.json({ ok: false, state: 'season_over' })

    // Every member, as run/start would check him.
    const since = new Date(now - 60 * 60 * 1000).toISOString()
    const epoch = currentEpoch()
    for (const m of members) {
        const [access, coop, profQ, startsQ] = await Promise.all([
            accessFor(m.wallet),
            coopFor(m.wallet),
            supabaseAdmin.from('survival_profiles').select('state').eq('wallet', m.wallet).maybeSingle(),
            supabaseAdmin.from('survival_runs').select('id', { count: 'exact', head: true }).eq('wallet', m.wallet).gte('started_at', since),
        ])
        if (access.error || profQ.error || startsQ.error) return noServer('coop.start.member', access.error ?? profQ.error?.message ?? startsQ.error?.message)
        if (!access.allowed) return NextResponse.json({ ok: false, state: 'no_access', wallet: m.wallet })
        if (!coop) return NextResponse.json({ ok: false, state: 'no_coop', wallet: m.wallet })
        if ((startsQ.count ?? 0) >= STARTS_PER_HOUR) return NextResponse.json({ ok: false, state: 'rate_limited', wallet: m.wallet })
        const saved = ((profQ.data as { state?: SaveState } | null)?.state ?? {}) as SaveState
        const owned = economyOf(epoch && saved.epoch !== epoch ? {} : saved).unlockedHeroes as string[]
        if (!m.hero || !owned.includes(m.hero) || RETIRED_HEROES.includes(m.hero)) {
            return NextResponse.json({ ok: false, state: 'not_owned', wallet: m.wallet })
        }
    }

    // The players' rows exist (credits and runs reference them), and what each left open is closed.
    const wallets = members.map((m) => m.wallet)
    const { error: pErr } = await supabaseAdmin.from('survival_players')
        .upsert(wallets.map((w) => ({ wallet: w, last_seen: new Date(now).toISOString() })), { onConflict: 'wallet' })
    if (pErr) return noServer('coop.start.players', pErr.message)
    const { data: openRows, error: oErr } = await supabaseAdmin.from('survival_runs').select(RUN_COLUMNS).in('wallet', wallets).eq('status', 'started')
    if (oErr) return noServer('coop.start.open_runs', oErr.message)
    const stale = now - RUN_TTL_MS
    await Promise.all(((openRows ?? []) as unknown as RunRow[]).map((r) => closeAbandoned(r, Date.parse(r.last_pulse_at ?? r.started_at) < stale ? 'expired' : 'superseded')))

    const seed = Number(BigInt.asUintN(52, BigInt('0x' + crypto.randomUUID().replace(/-/g, '').slice(0, 13))))
    const paid = process.env.SURVIVAL_PAID_RUNS === '1'
    const { data, error } = await supabaseAdmin.rpc('survival_coop_open', {
        p_season: s.id, p_room: roomId, p_host: WALLET.test(host) ? host : null,
        p_wallets: wallets, p_heroes: members.map((m) => m.hero), p_weapons: members.map((m) => m.weapon || null),
        p_versions: members.map((m) => m.clientVersion || null), p_seed: seed, p_paid: paid,
    })
    if (error) {
        const short = /no_credit:(0x[0-9a-f]{40})/.exec(error.message)
        if (short) {
            logEvent({ level: 'info', kind: 'coop.start_no_credit', wallet: short[1], message: `room ${roomId}`, data: { wallets } })
            return NextResponse.json({ ok: false, state: 'no_credit', wallet: short[1] })
        }
        return noServer('coop.start.open', error.message)
    }
    const rows = (data ?? []) as { o_wallet: string; o_run: string; o_coop: string }[]
    if (rows.length !== wallets.length) return noServer('coop.start.open', `opened ${rows.length} of ${wallets.length}`)
    const runs: Record<string, string> = {}
    for (const r of rows) runs[r.o_wallet] = r.o_run
    const coopId = rows[0].o_coop
    logEvent({ level: 'info', kind: 'coop.start', message: `room ${roomId}: ${wallets.length} players`, data: { coopId, wallets, paid } })
    return NextResponse.json({ ok: true, coopId, seed, runs }, { headers: { 'cache-control': 'no-store' } })
}
