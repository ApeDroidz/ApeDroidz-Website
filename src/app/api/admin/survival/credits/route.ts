import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { logEvent } from '@/lib/survivalLog'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }

/**
 * Runs a player has in hand (unspent survival_credits of the live season), set by hand from the
 * panel (owner, 25.09.2026: «начислять кому-то игры или редактировать число»).
 *
 * GET  /api/admin/survival/credits?wallet=0x…            → { solo, coop }
 * POST /api/admin/survival/credits { wallet, mode, count } → sets that mode's unspent runs to `count`
 *
 * Up: the missing runs are inserted as source 'grant'. Down: unspent runs are deleted, grants
 * first, newest first — a purchased run keeps its payment row in survival_payments either way.
 * Spent runs are never touched (runs point at them). Every change goes to the journal.
 */
const MAX = 1000
type Mode = 'solo' | 'coop'

async function liveSeason(): Promise<string | null> {
    const { data } = await supabaseAdmin.from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle()
    return (data as { id: string } | null)?.id ?? null
}

async function unspent(wallet: string, season: string) {
    const { data, error } = await supabaseAdmin.from('survival_credits').select('id, mode, source, created_at')
        .eq('wallet', wallet).eq('season_id', season).is('consumed_by_run', null)
    if (error) throw new Error(error.message)
    return (data ?? []) as Array<{ id: string; mode: Mode; source: string; created_at: string }>
}

const count = (rows: Array<{ mode: Mode }>) => ({ solo: rows.filter((r) => r.mode === 'solo').length, coop: rows.filter((r) => r.mode === 'coop').length })
const walletOf = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')

export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const wallet = walletOf(request.nextUrl.searchParams.get('wallet'))
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ error: 'Not a wallet address' }, { status: 400, headers })
    const season = await liveSeason()
    if (!season) return NextResponse.json({ error: 'No live season' }, { status: 409, headers })
    try { return NextResponse.json({ ok: true, wallet, season, ...count(await unspent(wallet, season)) }, { headers }) }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500, headers }) }
}

export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const wallet = walletOf(body.wallet)
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ error: 'Not a wallet address' }, { status: 400, headers })
    const mode: Mode = body.mode === 'coop' ? 'coop' : 'solo'
    const want = Number(body.count)
    if (!Number.isInteger(want) || want < 0 || want > MAX) return NextResponse.json({ error: `Count must be a whole number from 0 to ${MAX}` }, { status: 400, headers })
    const season = await liveSeason()
    if (!season) return NextResponse.json({ error: 'No live season' }, { status: 409, headers })

    try {
        // A wallet that never opened the game still gets its runs: the credits hang off the player row.
        const up = await supabaseAdmin.from('survival_players').upsert({ wallet }, { onConflict: 'wallet', ignoreDuplicates: true })
        if (up.error) throw new Error(up.error.message)
        const rows = (await unspent(wallet, season)).filter((r) => r.mode === mode)
        const had = rows.length
        if (want > had) {
            const add = Array.from({ length: want - had }, () => ({ wallet, season_id: season, source: 'grant', mode }))
            const { error } = await supabaseAdmin.from('survival_credits').insert(add)
            if (error) throw new Error(error.message)
        } else if (want < had) {
            const drop = rows
                .sort((a, b) => (a.source === 'grant' ? 0 : 1) - (b.source === 'grant' ? 0 : 1) || b.created_at.localeCompare(a.created_at))
                .slice(0, had - want).map((r) => r.id)
            // Only still-unspent rows: a run that started a moment ago keeps its credit.
            const { error } = await supabaseAdmin.from('survival_credits').delete().in('id', drop).is('consumed_by_run', null)
            if (error) throw new Error(error.message)
        }
        const now = count(await unspent(wallet, season))
        logEvent({ level: 'warn', kind: 'credits.set', wallet, message: `${mode} ${had} → ${now[mode]}`, data: { by: 'spltpnl', mode, from: had, to: now[mode], season } })
        return NextResponse.json({ ok: true, wallet, season, ...now }, { headers })
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500, headers })
    }
}
