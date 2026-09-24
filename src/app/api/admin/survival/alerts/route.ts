import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { eth_getBalance } from 'thirdweb/rpc'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { CASHIER, weiToApe } from '@/lib/survivalShop'
import { rpc } from '@/lib/survivalSettle'

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

type Ev = { at: string; wallet: string | null; kind: string; level: string; message: string; data: Record<string, unknown> | null; client_version: string | null }

export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const db = supabaseAdmin
    const now = Date.now()
    const dayAgo = new Date(now - H24).toISOString()
    const weekAgo = new Date(now - 7 * H24).toISOString()
    const [ev, runs, orders, ledger, acks, live] = await Promise.all([
        db.from('survival_events').select('at, wallet, kind, level, message, data, client_version').gte('at', weekAgo).in('level', ['warn', 'error']).order('at', { ascending: false }).limit(20_000),
        db.from('survival_runs').select('status, reject_reason, wallet').gte('started_at', dayAgo).limit(20_000),
        db.from('survival_orders').select('id, wallet, sku, created_at').eq('status', 'pending').gte('created_at', weekAgo).limit(5_000),
        db.from('survival_pool_ledger').select('bucket, amount_ape').limit(100_000),
        db.from('survival_alert_acks').select('fingerprint, acked_at, snooze_until'),
        db.from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle(),
    ])
    const events = (ev.data as Ev[] | null) ?? []
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
        if (e.kind !== 'client.error' && e.kind !== 'client.rejection') continue
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
    const serverErrors = events.filter((e) => e.level === 'error' && (e.kind === 'profile.save_failed' || e.kind.startsWith('server.')))
    if (serverErrors.length) push({
        fingerprint: fp('server', 'save_failed'), severity: 'critical', area: 'server', count: serverErrors.length, wallets: walletsOf(serverErrors), lastSeen: serverErrors[0].at,
        title: 'Saves are failing on the server', detail: `${serverErrors.length} failed profile writes this week. Last: ${serverErrors[0].message.slice(0, 120)}`,
        action: 'Check Supabase status and the Vercel logs for /api/survival/profile; players keep progress locally and retry, but not forever.',
    })
    const stale = events.filter((e) => e.kind === 'profile.stale' && e.at >= dayAgo)
    if (stale.length >= 20) push({
        fingerprint: fp('server', 'stale-saves'), severity: 'medium', area: 'server', count: stale.length, wallets: walletsOf(stale), lastSeen: stale[0].at,
        title: 'Many out-of-date saves refused', detail: `${stale.length} saves in 24h were older than the server's copy (second tab / device). The guard worked — but this many means something keeps an old save alive.`,
        action: 'Look at which wallets and builds (data.clientVersion) — an old cached build is the usual cause.',
    })

    // ── payments: money that did not become runs ─────────────────────────────
    const refused = events.filter((e) => ['pay.underpaid', 'pay.wrong_mode', 'pay.mismatch', 'pay.used', 'pay.no_order'].includes(e.kind))
    if (refused.length) push({
        fingerprint: fp('pay', 'refused', refused[0].at.slice(0, 10)), severity: 'high', area: 'payments', count: refused.length, wallets: walletsOf(refused), lastSeen: refused[0].at,
        title: 'Payments refused by the server', detail: `${refused.length} this week: ${[...new Set(refused.map((r) => r.kind.replace('pay.', '')))].join(', ')}. Some may be real money that was not credited.`,
        action: 'Open Payments → Refused. For each: check the tx on apescan; if it paid the cashier for the right player, use «Recheck tx».', sample: refused.slice(0, 5),
    })
    const stuck = ((orders.data as Array<{ id: string; wallet: string; created_at: string }> | null) ?? []).filter((o) => now - Date.parse(o.created_at) > 30 * 60_000)
    if (stuck.length) push({
        fingerprint: fp('pay', 'stuck', String(stuck.length)), severity: stuck.length >= 5 ? 'high' : 'medium', area: 'payments', count: stuck.length, wallets: new Set(stuck.map((o) => o.wallet)).size, lastSeen: stuck[0].created_at,
        title: 'Orders pending for over 30 minutes', detail: 'Usually a player who opened the wallet dialog and walked away (harmless). If one of them did pay, the next credits check books it — unless its client never comes back.',
        action: 'If a player says they paid, open Payments → Stuck orders and «Recheck tx» with their hash.',
    })

    // ── payments: the books against the chain ────────────────────────────────
    if (CASHIER) {
        const sums: Record<string, number> = {}
        for (const l of (ledger.data as Array<{ bucket: string; amount_ape: number }> | null) ?? []) sums[l.bucket] = (sums[l.bucket] ?? 0) + Number(l.amount_ape)
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

    // ── anti-cheat: rejections worth a look ──────────────────────────────────
    const R = (runs.data as Array<{ status: string; reject_reason: string | null; wallet: string }> | null) ?? []
    const rejected = R.filter((r) => r.status === 'rejected')
    const finished = R.filter((r) => r.status === 'finished').length
    if (rejected.length >= 3 && rejected.length / Math.max(1, rejected.length + finished) >= 0.15) push({
        fingerprint: fp('anticheat', new Date().toISOString().slice(0, 10)), severity: 'high', area: 'anticheat', count: rejected.length, wallets: new Set(rejected.map((r) => r.wallet)).size, lastSeen: new Date().toISOString(),
        title: 'Many runs rejected in the last 24h', detail: `${rejected.length} rejected vs ${finished} accepted. Reasons: ${[...new Set(rejected.map((r) => r.reject_reason))].join(', ')}.`,
        action: 'One wallet → Players → ban if it is cheating. Many wallets with the same reason → the envelope is out of date for the current build; check it before players are wrongly refused.',
    })

    // ── game: the spawner stall the reaper exists for ─────────────────────────
    const stalls = events.filter((e) => e.kind === 'spawn_ceiling_stall')
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
