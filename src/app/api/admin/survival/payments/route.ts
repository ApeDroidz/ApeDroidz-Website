import { NextRequest, NextResponse } from 'next/server'
import { eth_getBalance } from 'thirdweb/rpc'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { CASHIER, SKUS, weiToApe } from '@/lib/survivalShop'
import { rpc, settleAnyInTx } from '@/lib/survivalSettle'
import { isPublic } from '@/lib/survivalAllow'
import { logEvent } from '@/lib/survivalLog'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * GET  /api/admin/survival/payments — the money in Droidz Survival, for the Payments view:
 *        totals (all / 24h / 7d) by mode, platform and item; APE per day for 30 days; each pool as
 *        the ledger has it AND as the vault wallet holds it on chain; every payment; orders stuck
 *        in pending; refused payment attempts; credits issued / spent / outstanding; the config.
 * POST /api/admin/survival/payments { txHash } — support: book the orders a transaction paid,
 *        by the cashier's own Paid events (lib/survivalSettle.ts settleAnyInTx). The event
 *        decides — an operator cannot credit anything the chain does not show.
 *
 * Owner, 24.09.2026: «отдельная страничка в spltpnl по оплате с информацией по всем переводам
 * и аналитикой».
 */
const VAULTS = {
    solo: '0x84B732Da60a0955e890c58C344a8E9ED4C2aB8f2',
    coop: '0xA7E56FC068dfc0Dd1F2799d8c3826Cd27631203c',
    team: '0xE7946895522ed49D8DB161E126622De6e07C8Faa',
} as const
const HUB = '0x8e756ca736da338d78c436c47a41ac18ce72cf63'

type Pay = { tx_hash: string; wallet: string; amount_ape: number; to_pool_ape: number | null; mode: string | null; platform: string | null; payer: string | null; credits_granted: number; created_at: string; order_id: string | null; block_number: number | null }

export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const db = supabaseAdmin
    const problems: string[] = []
    const note = (l: string) => (r: { error: { message: string } | null }) => { if (r.error) problems.push(`${l}: ${r.error.message}`) }

    const live = await db.from('survival_seasons').select('id, name').eq('status', 'live').limit(1).maybeSingle()
    const seasonId = (live.data as { id: string } | null)?.id ?? null
    const [pays, orders, ledger, credits, events, allow] = await Promise.all([
        db.from('survival_payments').select('tx_hash, wallet, amount_ape, to_pool_ape, mode, platform, payer, credits_granted, created_at, order_id, block_number').order('created_at', { ascending: false }).limit(10_000),
        db.from('survival_orders').select('id, wallet, sku, mode, platform, price_ape, status, created_at').order('created_at', { ascending: false }).limit(5_000),
        seasonId ? db.from('survival_pool_ledger').select('bucket, source, amount_ape').eq('season_id', seasonId).limit(50_000) : Promise.resolve({ data: [], error: null }),
        db.from('survival_credits').select('mode, source, consumed_by_run').limit(100_000),
        db.from('survival_events').select('at, wallet, kind, message, data').like('kind', 'pay.%').neq('kind', 'pay.paid').order('at', { ascending: false }).limit(200),
        db.from('survival_allowlist').select('wallet, note').limit(5_000),
    ])
    ;[['payments', pays], ['orders', orders], ['ledger', ledger], ['credits', credits], ['events', events], ['allowlist', allow]].forEach(([l, r]) => note(l as string)(r as never))

    const P = (pays.data as Pay[] | null) ?? []
    const now = Date.now()
    const within = (iso: string, ms: number) => now - Date.parse(iso) <= ms
    const sum = (rows: Pay[]) => ({ count: rows.length, ape: round(rows.reduce((n, r) => n + Number(r.amount_ape), 0)), pool: round(rows.reduce((n, r) => n + Number(r.to_pool_ape ?? 0), 0)) })
    const by = (key: 'mode' | 'platform') => Object.fromEntries(['solo', 'coop', 'site', 'otherside'].filter((k) => key === 'mode' ? k === 'solo' || k === 'coop' : k === 'site' || k === 'otherside')
        .map((k) => [k, sum(P.filter((r) => (r[key] ?? (key === 'mode' ? 'solo' : 'site')) === k))]))
    const orderSku = new Map(((orders.data as Array<{ id: string; sku: string }> | null) ?? []).map((o) => [o.id, o.sku]))
    const bySku = Object.fromEntries(Object.keys(SKUS).map((s) => [s, sum(P.filter((r) => r.order_id && orderSku.get(r.order_id) === s))]))

    // APE per day, 30 days, split by mode (the chart).
    const days: Array<{ day: string; solo: number; coop: number; count: number }> = []
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * 86_400_000).toISOString().slice(0, 10)
        const rows = P.filter((r) => r.created_at.slice(0, 10) === d)
        days.push({ day: d, solo: round(rows.filter((r) => (r.mode ?? 'solo') === 'solo').reduce((n, r) => n + Number(r.amount_ape), 0)), coop: round(rows.filter((r) => r.mode === 'coop').reduce((n, r) => n + Number(r.amount_ape), 0)), count: rows.length })
    }

    const pools: Record<string, number> = {}
    for (const l of (ledger.data as Array<{ bucket: string; amount_ape: number }> | null) ?? []) pools[l.bucket] = round((pools[l.bucket] ?? 0) + Number(l.amount_ape))

    // What the vault wallets actually hold on chain — the ledger must never claim more than this.
    const balances: Record<string, number | null> = {}
    await Promise.all(Object.entries(VAULTS).map(async ([k, a]) => {
        balances[k] = await eth_getBalance(rpc(), { address: a }).then((b) => weiToApe(b)).catch(() => null)
    }))

    const O = (orders.data as Array<{ id: string; wallet: string; sku: string; mode: string; platform: string; price_ape: number; status: string; created_at: string }> | null) ?? []
    const stuck = O.filter((o) => o.status === 'pending' && now - Date.parse(o.created_at) > 30 * 60_000 && within(o.created_at, 7 * 86_400_000)).slice(0, 100)
    const C = (credits.data as Array<{ mode: string; source: string; consumed_by_run: string | null }> | null) ?? []
    const names = Object.fromEntries(((allow.data as Array<{ wallet: string; note: string | null }> | null) ?? []).filter((a) => a.note).map((a) => [a.wallet.toLowerCase(), a.note]))

    return NextResponse.json({
        ok: true, generatedAt: new Date().toISOString(), season: live.data ?? null,
        config: {
            cashier: CASHIER || null, paidRuns: process.env.SURVIVAL_PAID_RUNS === '1', payForReal: process.env.NEXT_PUBLIC_SURVIVAL_PAY_FOR_REAL === '1',
            public: isPublic(), coopOpen: process.env.SURVIVAL_COOP_OPEN === '1', skus: SKUS, vaults: VAULTS,
        },
        totals: { all: sum(P), day: sum(P.filter((r) => within(r.created_at, 86_400_000))), week: sum(P.filter((r) => within(r.created_at, 7 * 86_400_000))), byMode: by('mode'), byPlatform: by('platform'), bySku, viaHub: sum(P.filter((r) => r.payer === HUB)) },
        days, pools, balances,
        credits: {
            issued: { solo: C.filter((c) => c.mode === 'solo').length, coop: C.filter((c) => c.mode === 'coop').length },
            spent: { solo: C.filter((c) => c.mode === 'solo' && c.consumed_by_run).length, coop: C.filter((c) => c.mode === 'coop' && c.consumed_by_run).length },
        },
        orders: { total: O.length, pending: O.filter((o) => o.status === 'pending').length, paid: O.filter((o) => o.status === 'paid').length, stuck },
        payments: P.slice(0, 1000).map((p) => ({ ...p, name: names[p.wallet] ?? null, viaHub: p.payer === HUB })),
        refused: events.data ?? [],
        problems,
    }, { headers })
}

export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const body = await request.json().catch(() => ({})) as { txHash?: unknown }
    const tx = typeof body.txHash === 'string' ? body.txHash.trim().toLowerCase() : ''
    if (!/^0x[0-9a-f]{64}$/.test(tx)) return NextResponse.json({ error: 'Bad tx hash' }, { status: 400, headers })
    if (!CASHIER) return NextResponse.json({ error: 'Cashier not configured' }, { status: 400, headers })
    const results = await settleAnyInTx(tx)
    logEvent({ level: 'info', source: 'server', kind: 'pay.admin_recheck', wallet: null, message: tx, data: { results } })
    return NextResponse.json({ ok: true, results }, { headers })
}

const round = (n: number) => Math.round(n * 1e6) / 1e6
