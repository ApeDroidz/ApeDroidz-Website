import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer } from '@/lib/survivalRuns'
import { coopConfigured, coopFor, coopRelay, signCoopToken } from '@/lib/survivalCoop'

/**
 * POST /api/survival/coop/token → { ok: true, token, relay, expiresAt } | { ok: false, state }
 *
 * The room token for the co-op relay (workers/coop-relay): who this player is — the wallet the
 * session proves and the name the room shows (the profile's nickname, else the X handle, else the
 * short wallet) — signed with SURVIVAL_COOP_SECRET. The relay checks the signature and nothing else.
 * Only for a wallet co-op is open to (lib/survivalCoop.ts coopFor — the beta testers first).
 */
export const dynamic = 'force-dynamic'
const noStore = { 'cache-control': 'no-store' }

export async function POST(req: NextRequest) {
    const caller = await authCaller(req, { recheck: true })
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    if (!coopConfigured()) return NextResponse.json({ ok: false, state: 'off' }, { headers: noStore })
    if (!(await coopFor(caller.wallet))) return NextResponse.json({ ok: false, state: 'no_coop' }, { headers: noStore })
    const [{ data: player }, { data: xRow }] = await Promise.all([
        supabaseAdmin.from('survival_players').select('nickname, banned').eq('wallet', caller.wallet).maybeSingle(),
        supabaseAdmin.from('glitch_users').select('x_handle').ilike('wallet_address', caller.wallet).maybeSingle(),
    ])
    const p = player as { nickname?: string | null; banned?: boolean } | null
    if (p?.banned) return NextResponse.json({ ok: false, state: 'banned' }, { headers: noStore })
    const x = (xRow as { x_handle: string | null } | null)?.x_handle ?? null
    const name = p?.nickname || (x ? `@${x}` : `${caller.wallet.slice(0, 6)}…${caller.wallet.slice(-4)}`)
    const { token, expiresAt } = signCoopToken(caller.wallet, name)
    return NextResponse.json({ ok: true, token, relay: coopRelay(), expiresAt }, { headers: noStore })
}
