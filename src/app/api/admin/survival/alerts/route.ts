import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { eth_getBalance } from 'thirdweb/rpc'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { CASHIER, weiToApe } from '@/lib/survivalShop'
import { rpc } from '@/lib/survivalSettle'
import { fetchAll } from '@/lib/survivalFetchAll'
import { closeAbandoned, RUN_COLUMNS, type RunRow } from '@/lib/survivalRuns'
import { RUN_TTL_MS } from '@/lib/survivalEnvelope'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * GET  /api/admin/survival/alerts                  → { alerts: Alert[] } — what needs fixing, now
 * POST /api/admin/survival/alerts { fingerprint, action: 'done' | 'snooze', note? }
 *
 * Owner, 24.09.2026: «в панели есть античит-инфа, инфа о багах, но нет чёткого CTA, когда надо
 * что-то поправить». Each alert is one concrete problem with what to do about it, computed from
 * the journal and the tables on every read — never stored, so it cannot go stale. Marking it done
 * stores only its fingerprint; it comes back by itself if it happens again after the mark.
 * Snooze hides it for 24 hours.
 */
type Severity = 'critical' | 'high' | 'medium'
type Alert = {
    fingerprint: string; severity: Severity; area: 'game' | 'payments' | 'server' | 'anticheat' | 'config'
    title: string; detail: string; action: string; count: number; wallets: number; lastSeen: string | null
    sample?: unknown
}

const VAULTS = { solo_pool: '0x84B732Da60a0955e890c58C344a8E9ED4C2aB8f2', coop_pool: '0xA7E56FC068dfc0Dd1F2799d8c3826Cd27631203c' } as const
const fp = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)
const H24 = 86_400_000

type Ev = { at: string; wallet: string | null; kind: string; level: string; message: string; data: Record<string, unknown> | null; client_version: string | null; source?: string }

/**
 * A monitor reads the alerts with a token of its own (`Authorization: Bearer $SURVIVAL_ALERTS_TOKEN`,
 * GET only): n8n on a schedule → Telegram, so the owner hears about a critical one without the
 * panel open. Never the admin cookie in the monitor — it lives 30 days and opens the whole panel.
 * Unset (or shorter than 24 characters) = no such door.
 */
function monitorAllowed(request: NextRequest): boolean {
    const token = process.env.SURVIVAL_ALERTS_TOKEN ?? ''
    if (token.length < 24) return false
    const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
    if (!m) return false
    const a = createHash('sha256').update(m[1]).digest()
    const b = createHash('sha256').update(token).digest()
    return timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
    const denied = monitorAllowed(request) ? null : await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const db = supabaseAdmin
    const now = Date.now()
    const dayAgo = new Date(now - H24).toISOString()
    const weekAgo = new Date(now - 7 * H24).toISOString()
    // Two narrow reads instead of «every warn and error of the week»: PostgREST answers at most
    // 1000 rows, and a flood of one kind used to push the payment refusals out of the window.
    // The SERVER's own lines (money, saves, failures) and the GAME's crash reports — a client line
    // can never raise a server alert (anyone can POST /api/survival/log).
    const EV_COLS = 'at, wallet, kind, level, message, data, client_version, source'
    const [evServer, evClient, runs, orders, ledgerAll, acks, live, verdicts, expiredQ] = await Promise.all([
        db.from('survival_events').select(EV_COLS).eq('source', 'server').gte('at', weekAgo).in('level', ['warn', 'error'])
            .or('kind.like.pay.%,kind.like.server.%,kind.like.profile.%,kind.like.economy.%,kind.like.credits.%,kind.eq.run.flagged')
            .order('at', { ascending: false }).limit(1000),
        db.from('survival_events').select(EV_COLS).eq('source', 'client').gte('at', weekAgo)
            .in('kind', ['client.error', 'client.rejection', 'spawn_ceiling_stall']).order('at', { ascending: false }).limit(1000),
        db.from('survival_runs').select('status, reject_reason, wallet').gte('started_at', dayAgo).limit(20_000),
        db.from('survival_orders').select('id, wallet, sku, created_at').eq('status', 'pending').is('dismissed_at', null).gte('created_at', weekAgo).limit(5_000),
        // Every ledger row (paged — one read of 1000 would under-book the pool and hide a missing vault).
        fetchAll<{ bucket: string; amount_ape: number; source: string }>(() => db.from('survival_pool_ledger').select('bucket, amount_ape, source').order('id')),
        db.from('survival_alert_acks').select('fingerprint, acked_at, snooze_until'),
        db.from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle(),
        // The game's own word on how each run ended (info level, so not in `ev`).
        db.from('survival_events').select('at, wallet, kind, level, message, data, client_version').eq('kind', 'run.verdict').eq('message', 'offline').gte('at', weekAgo).order('at', { ascending: false }).limit(5_000),
        // Runs that went silent for a day while they were pulsing.
        db.from('survival_runs').select('id, wallet, status, last_pulse_wave, last_pulse_at').gte('started_at', weekAgo).gt('pulse_count', 0)
            .or('reject_reason.eq.expired,flags.cs.["closed_expired"]').order('started_at', { ascending: false }).limit(500),
    ])
    // Runs left open for a day with nobody to close them (their wallet never started another):
    // closed here as expired — counted at their last pulse (lib/survivalRuns.ts closeAbandoned),
    // so they are on the board before the season is paid, not lost with it.
    const { data: abandoned } = await db.from('survival_runs').select(RUN_COLUMNS).eq('status', 'started')
        .lt('started_at', new Date(now - RUN_TTL_MS).toISOString()).limit(50)
    for (const r of (abandoned as unknown as RunRow[] | null) ?? []) {
        if (Date.parse(r.last_pulse_at ?? r.started_at) < now - RUN_TTL_MS) await closeAbandoned(r, 'expired')
    }
    const events = [...((evServer.data as Ev[] | null) ?? []), ...((evClient.data as Ev[] | null) ?? [])]
        .sort((a, b) => b.at.localeCompare(a.at))
    const ledger = { data: ledgerAll.rows }
    const alerts: Alert[] = []
    const push = (a: Alert) => alerts.push(a)
    const walletsOf = (rows: Ev[]) => new Set(rows.map((r) => r.wallet).filter(Boolean)).size

    // ── config: a switch that makes money or play impossible ──────────────────
    if (process.env.SURVIVAL_PAID_RUNS === '1' && !CASHIER) push({
        fingerprint: fp('config', 'paid-no-cashier'), severity: 'critical', area: 'config', count: 1, wallets: 0, lastSeen: new Date().toISOString(),
        title: 'Runs are paid, but there is no cashier', detail: 'SURVIVAL_PAID_RUNS=1 while SURVIVAL_CASHIER is empty: nobody can buy a run, so nobody can play.',
        action: 'Set SURVIVAL_CASHIER / NEXT_PUBLIC_SURVIVAL_CASHIER on Vercel, or turn SURVIVAL_PAID_RUNS off.',
    })
    if (!live.data) push({
        fingerprint: fp('config', 'no-season'), severity: 'critical', area: 'config', count: 1, wallets: 0, lastSeen: new Date().toISOString(),
        title: 'No live season', detail: 'Every run start answers no_season — runs are not recorded and nothing can be bought.',
        action: 'Set one season to status «live» in survival_seasons.',
    })

    // ── game: the same crash for more than one player ─────────────────────────
    const crashes = new Map<string, Ev[]>()
    for (const e of events) {
        if (e.source !== 'client' || (e.kind !== 'client.error' && e.kind !== 'client.rejection')) continue
        const key = e.message.replace(/\d+/g, '#').slice(0, 160)
        crashes.set(key, [...(crashes.get(key) ?? []), e])
    }
    for (const [msg, rows] of crashes) {
        const recent = rows.filter((r) => r.at >= dayAgo)
        const w = walletsOf(rows)
        if (rows.length < 3 && w < 2) continue
        push({
            fingerprint: fp('crash', msg), severity: recent.length >= 5 || w >= 3 ? 'high' : 'medium', area: 'game',
            title: `Game error: ${msg.slice(0, 90)}`, count: rows.length, wallets: w, lastSeen: rows[0].at,
            detail: `${rows.length} times this week (${recent.length} in 24h), ${w} player${w === 1 ? '' : 's'}, builds ${[...new Set(rows.map((r) => r.client_version))].slice(0, 3).join(', ')}.`,
            action: 'Reproduce it from the stack in the journal (data.stack), fix in the game, ship a build.', sample: rows[0].data,
        })
    }

    // ── server: failures that lose a player's work ───────────────────────────
    const srv = events.filter((e) => e.source === 'server')
    const saveFails = srv.filter((e) => e.level === 'error' && e.kind === 'profile.save_failed')
    if (saveFails.length) push({
        fingerprint: fp('server', 'save_failed'), severity: 'critical', area: 'server', count: saveFails.length, wallets: walletsOf(saveFails), lastSeen: saveFails[0].at,
        title: 'Saves are failing on the server', detail: `${saveFails.length} failed profile writes this week. Last: ${saveFails[0].message.slice(0, 120)}`,
        action: 'Check Supabase status and the Vercel logs for /api/survival/profile; players keep progress locally and retry, but not forever.',
    })
    // The API answered no_server (lib/survivalRuns.ts noServer): the database or the chain did not answer.
    const down = srv.filter((e) => e.kind.startsWith('server.'))
    if (down.length) {
        const lastHour = down.filter((e) => Date.parse(e.at) > now - 3_600_000).length
        const byKind = [...new Set(down.map((e) => e.kind))].map((k) => `${k.replace('server.', '')} ×${down.filter((e) => e.kind === k).length}`).join(', ')
        push({
            fingerprint: fp('server', 'no_server', down[0].at.slice(0, 13)), severity: lastHour >= 10 || walletsOf(down) >= 3 ? 'critical' : 'high', area: 'server', count: down.length, wallets: walletsOf(down), lastSeen: down[0].at,
            title: 'The API answers «no server»', detail: `${down.length} this week (${lastHour} in the last hour): ${byKind}. Last: ${down[0].message.slice(0, 120)}`,
            action: 'Check Supabase status and the Vercel logs for those routes; players see «server unreachable» and paid actions wait.',
        })
    }
    const unpaid = srv.filter((e) => e.kind === 'economy.run_unpaid')
    if (unpaid.length) push({
        fingerprint: fp('server', 'run_unpaid', unpaid[0].at), severity: 'critical', area: 'server', count: unpaid.length, wallets: walletsOf(unpaid), lastSeen: unpaid[0].at,
        title: 'Runs counted but not paid', detail: `${unpaid.length} accepted runs this week whose Ape Mini / salvage / season XP was not written (${unpaid[0].message.slice(0, 80)}).`,
        action: 'Journal → economy.run_unpaid: runId and wallet. Pay by hand (Players) — the run is on the board, its pay is not.',
        sample: unpaid.slice(0, 5).map((e) => ({ at: e.at, wallet: e.wallet, message: e.message })),
    })
    const noRefund = srv.filter((e) => e.kind === 'credits.refund_failed')
    if (noRefund.length) push({
        fingerprint: fp('server', 'refund_failed', noRefund[0].at), severity: 'critical', area: 'payments', count: noRefund.length, wallets: walletsOf(noRefund), lastSeen: noRefund[0].at,
        title: 'A paid run was closed and its credit not returned', detail: `${noRefund.length} this week. Last: ${noRefund[0].message.slice(0, 120)}`,
        action: 'Players → the wallet → Give runs (one per failed refund).', sample: noRefund.slice(0, 5).map((e) => ({ at: e.at, wallet: e.wallet, data: e.data })),
    })
    const seasonFails = srv.filter((e) => e.kind === 'profile.season_failed')
    if (seasonFails.length) push({
        fingerprint: fp('server', 'season_failed', seasonFails[0].at.slice(0, 10)), severity: 'high', area: 'server', count: seasonFails.length, wallets: walletsOf(seasonFails), lastSeen: seasonFails[0].at,
        title: 'Season rows fail to save', detail: `${seasonFails.length} this week: a claim or a run's season XP was not written. Last: ${seasonFails[0].message.slice(0, 120)}`,
        action: 'Check survival_profile_seasons in Supabase and the Vercel logs for /api/survival/economy.',
    })
    const stale = srv.filter((e) => e.kind === 'profile.stale' && e.at >= dayAgo)
    if (stale.length >= 20) push({
        fingerprint: fp('server', 'stale-saves'), severity: 'medium', area: 'server', count: stale.length, wallets: walletsOf(stale), lastSeen: stale[0].at,
        title: 'Many out-of-date saves refused', detail: `${stale.length} saves in 24h were older than the server's copy (second tab / device). The guard worked — but this many means something keeps an old save alive.`,
        action: 'Look at which wallets and builds (data.clientVersion) — an old cached build is the usual cause.',
    })

    // ── payments: money that did not become runs ─────────────────────────────
    const refused = srv.filter((e) => ['pay.underpaid', 'pay.wrong_mode', 'pay.mismatch', 'pay.used', 'pay.no_order', 'pay.late'].includes(e.kind))
    if (refused.length) push({
        fingerprint: fp('pay', 'refused', refused[0].at.slice(0, 10)), severity: 'high', area: 'payments', count: refused.length, wallets: walletsOf(refused), lastSeen: refused[0].at,
        title: 'Payments refused by the server', detail: `${refused.length} this week: ${[...new Set(refused.map((r) => r.kind.replace('pay.', '')))].join(', ')}. Some may be real money that was not credited.`,
        action: 'Open Payments → Refused. For each: check the tx on apescan; if it paid the cashier for the right player, use «Recheck tx».', sample: refused.slice(0, 5),
    })
    const stuck = ((orders.data as Array<{ id: string; wallet: string; created_at: string }> | null) ?? []).filter((o) => now - Date.parse(o.created_at) > 30 * 60_000)
    if (stuck.length) push({
        fingerprint: fp('pay', 'stuck', stuck[0].created_at.slice(0, 10)), severity: stuck.length >= 5 ? 'high' : 'medium', area: 'payments', count: stuck.length, wallets: new Set(stuck.map((o) => o.wallet)).size, lastSeen: stuck[0].created_at,
        title: 'Orders pending for over 30 minutes', detail: 'Usually a player who opened the wallet dialog and walked away (harmless). If one of them did pay, the next credits check books it — unless its client never comes back.',
        action: 'Open Payments → Stuck orders: «Check all» books any that were paid; «Close» the rest.',
    })

    // ── payments: the books against the chain ────────────────────────────────
    if (CASHIER) {
        const sums: Record<string, number> = {}
        // A rollover moves pool between seasons inside the books — the vault never saw it.
        for (const l of ledger.data) if (l.source !== 'rollover') sums[l.bucket] = (sums[l.bucket] ?? 0) + Number(l.amount_ape)
        for (const [bucket, addr] of Object.entries(VAULTS)) {
            const booked = sums[bucket] ?? 0
            if (booked <= 0) continue
            const held = await eth_getBalance(rpc(), { address: addr }).then((b) => weiToApe(b)).catch(() => null)
            if (held !== null && held + 0.000001 < booked) push({
                fingerprint: fp('ledger', bucket, booked.toFixed(3)), severity: 'critical', area: 'payments', count: 1, wallets: 0, lastSeen: new Date().toISOString(),
                title: `${bucket === 'solo_pool' ? 'Solo' : 'Co-op'} vault holds less than the pool says`, detail: `The ledger books ${booked.toFixed(4)} APE, the vault ${addr} holds ${held.toFixed(4)} APE on chain.`,
                action: 'Only a payout (booked as source «payout») may take APE out of a vault. Check the vault\'s outgoing transactions now.',
            })
        }
    }

    // ── lucky ticket: an NFT prize the vault could not send ───────────────────
    const { data: stuckNfts } = await db.from('survival_ticket_nfts').select('id, winner, name, token_id, error, status, added_at')
        .or(`status.eq.failed,and(status.eq.reserved,added_at.lt.${new Date(now - 15 * 60_000).toISOString()})`).limit(50)
    for (const n of (stuckNfts as Array<{ id: number; winner: string; name: string | null; token_id: string; error: string | null; status: string; added_at: string }> | null) ?? []) push({
        fingerprint: fp('nft', String(n.id), n.status), severity: 'critical', area: 'payments', count: 1, wallets: 1, lastSeen: new Date().toISOString(),
        title: `A won NFT was not delivered: ${n.name ?? '#' + n.token_id}`, detail: `Winner ${n.winner}. ${n.error ? `Error: ${n.error}` : 'Still waiting to be sent.'}`,
        action: 'Payments → Lucky ticket → NFT pool: check the prize vault holds it and has APE for gas, then press Retry.',
    })

    // ── anti-cheat: rejections worth a look ──────────────────────────────────
    const R = (runs.data as Array<{ status: string; reject_reason: string | null; wallet: string }> | null) ?? []
    const rejected = R.filter((r) => r.status === 'rejected')
    const finished = R.filter((r) => r.status === 'finished').length
    if (rejected.length >= 3 && rejected.length / Math.max(1, rejected.length + finished) >= 0.15) push({
        fingerprint: fp('anticheat', new Date().toISOString().slice(0, 10)), severity: 'high', area: 'anticheat', count: rejected.length, wallets: new Set(rejected.map((r) => r.wallet)).size, lastSeen: new Date().toISOString(),
        title: 'Many runs rejected in the last 24h', detail: `${rejected.length} rejected vs ${finished} accepted. Reasons: ${[...new Set(rejected.map((r) => r.reject_reason))].join(', ')}.`,
        action: 'One wallet → Players → ban if it is cheating. Many wallets with the same reason → the envelope is out of date for the current build; check it before players are wrongly refused.',
    })
    else if (rejected.length) push({
        fingerprint: fp('anticheat', 'rejected', String(rejected.length), new Date().toISOString().slice(0, 10)), severity: 'medium', area: 'anticheat', count: rejected.length, wallets: new Set(rejected.map((r) => r.wallet)).size, lastSeen: new Date().toISOString(),
        title: `${rejected.length} run${rejected.length === 1 ? '' : 's'} rejected in the last 24h`, detail: `Reasons: ${[...new Set(rejected.map((r) => r.reject_reason))].join(', ')}. The player was told «cheating detected».`,
        action: 'Anti-cheat → Rejected: check each against the envelope (lib/survivalEnvelope.ts). A wrong rejection is a blocker — fix the rule, not the player.',
    })

    // ── server: results the game played but the server never recorded ────────
    const offline = ((verdicts.data as Ev[] | null) ?? []).filter((e) => Number((e.data as { wave?: unknown } | null)?.wave ?? 0) >= 10)
    if (offline.length) push({
        fingerprint: fp('runs', 'offline', String(offline.length)), severity: offline.filter((e) => e.at >= dayAgo).length ? 'high' : 'medium', area: 'server', count: offline.length, wallets: walletsOf(offline), lastSeen: offline[0].at,
        title: 'Long runs ended «not recorded»', detail: `${offline.length} runs at wave 10+ this week ended with the game saying OFFLINE (deepest: wave ${Math.max(...offline.map((e) => Number((e.data as { wave?: unknown }).wave) || 0))}). Builds ${[...new Set(offline.map((e) => e.client_version))].slice(0, 3).join(', ')}.`,
        action: 'Journal → run.verdict offline: data.why says what failed (no ticket, 401, timeout). Check the run rows of those wallets for superseded / restored runs.', sample: offline.slice(0, 5).map((e) => ({ at: e.at, wallet: e.wallet, ...e.data })),
    })
    const expired = (expiredQ.data as Array<{ id: string; wallet: string; status: string; last_pulse_wave: number | null; last_pulse_at: string | null }> | null) ?? []
    if (expired.length) push({
        fingerprint: fp('runs', 'expired', String(expired.length)), severity: 'medium', area: 'server', count: expired.length, wallets: new Set(expired.map((r) => r.wallet)).size, lastSeen: expired[0].last_pulse_at,
        title: 'Pulsing runs expired without a finish', detail: `${expired.length} runs this week pulsed and then went silent for 24 h (${expired.filter((r) => r.status === 'finished').length} counted from their last pulse, the rest voided by the old rule). Their game lost the finish — a closed tab, a crash, or a 401.`,
        action: 'Look at those wallets\' events around the last pulse (data.why on run.verdict, client.error). Restored runs are on the board but unpaid (lib/survivalRuns.ts payRestoredRun).', sample: expired.slice(0, 5),
    })

    // ── anti-cheat: accepted runs a human should look at before the pool is paid ─
    const review = srv.filter((e) => e.kind === 'run.flagged')
    if (review.length) push({
        fingerprint: fp('anticheat', 'review', review[0].at), severity: 'medium', area: 'anticheat', count: review.length, wallets: walletsOf(review), lastSeen: review[0].at,
        title: 'Accepted runs flagged for review', detail: `${review.length} this week: ${[...new Set(review.map((e) => e.message))].slice(0, 4).join(' · ')}. They are on the board; flags never refuse a run.`,
        action: 'Droidz Survival → Review — top & flagged runs: check pulses against the wave and the score the last pulse covers; Disqualify a forged one.',
        sample: review.slice(0, 5).map((e) => ({ at: e.at, wallet: e.wallet, message: e.message })),
    })

    // ── game: the spawner stall the reaper exists for ─────────────────────────
    const stalls = events.filter((e) => e.kind === 'spawn_ceiling_stall' && !!e.wallet)
    if (stalls.length) push({
        fingerprint: fp('game', 'spawn-stall', String(stalls.length)), severity: 'high', area: 'game', count: stalls.length, wallets: walletsOf(stalls), lastSeen: stalls[0].at,
        title: 'Runs got stuck at the enemy cap', detail: `${stalls.length} stalls this week — enemies unreachable, the wave cannot end.`,
        action: 'Look at data.wave / data.alive in the journal and the zones where it happens; widen GameScene.reapStrays or fix the spawn spot.',
    })

    // Acknowledged: hidden until it happens again after the mark; snoozed: hidden for a day.
    const ack = new Map(((acks.data as Array<{ fingerprint: string; acked_at: string; snooze_until: string | null }> | null) ?? []).map((a) => [a.fingerprint, a]))
    const shown = alerts.filter((a) => {
        const k = ack.get(a.fingerprint)
        if (!k) return true
        if (k.snooze_until && Date.parse(k.snooze_until) > now) return false
        if (k.snooze_until) return true
        return !!a.lastSeen && Date.parse(a.lastSeen) > Date.parse(k.acked_at)
    })
    const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2 }
    shown.sort((a, b) => order[a.severity] - order[b.severity] || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))
    return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), alerts: shown, hidden: alerts.length - shown.length }, { headers })
}

export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const body = await request.json().catch(() => ({})) as { fingerprint?: unknown; action?: unknown; note?: unknown }
    const f = typeof body.fingerprint === 'string' && /^[0-9a-f]{16}$/.test(body.fingerprint) ? body.fingerprint : ''
    if (!f || (body.action !== 'done' && body.action !== 'snooze')) return NextResponse.json({ error: 'Bad request' }, { status: 400, headers })
    const row = {
        fingerprint: f, acked_at: new Date().toISOString(),
        snooze_until: body.action === 'snooze' ? new Date(Date.now() + H24).toISOString() : null,
        note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
    }
    const { error } = await supabaseAdmin.from('survival_alert_acks').upsert(row, { onConflict: 'fingerprint' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
    return NextResponse.json({ ok: true }, { headers })
}
