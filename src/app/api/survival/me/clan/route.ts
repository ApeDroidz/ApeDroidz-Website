import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { ensurePlayer, NO_STORE } from '@/lib/survivalMe'

/**
 * POST /api/survival/me/clan { clan } — pick the clan from the profile, without starting a run.
 * Until now the clan was written only by run/start (its `clan` field); this is the same rule: the
 * NAME of an active clan from GET /api/survival/clans (survival_clans.name, exact), or null / '' to
 * fly with none. An unknown name is refused here (run/start silently stores none instead).
 *
 *   → { ok: true, clan: string|null } · 400 { error: 'unknown_clan' } · 503 { ok:false, state:'no_server' }
 *
 * Note: run/start still writes the clan it is sent, so the game must send the clan it shows (the
 * profile's) with every start, or a start without one clears it — as today.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    const asked = typeof body.clan === 'string' && body.clan.trim() ? body.clan.trim().slice(0, 40) : null
    let clan: string | null = null
    if (asked) {
        const { data, error } = await supabaseAdmin.from('survival_clans').select('name').eq('active', true).eq('name', asked).maybeSingle()
        if (error) return noServer('me.clan', error.message)
        if (!data) return NextResponse.json({ error: 'unknown_clan' }, { status: 400, headers: NO_STORE })
        clan = (data as { name: string }).name
    }
    if (!(await ensurePlayer(caller.wallet))) return noServer('me.clan', 'player row')
    const { error } = await supabaseAdmin.from('survival_players').update({ clan }).eq('wallet', caller.wallet)
    if (error) return noServer('me.clan', error.message)
    return NextResponse.json({ ok: true, clan }, { headers: NO_STORE })
}
