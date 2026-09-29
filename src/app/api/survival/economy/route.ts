import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { act, type Action } from '@/lib/survivalEconomy'
import { withEcon } from '@/lib/survivalEconomyStore'
import { logEvent } from '@/lib/survivalLog'

/**
 * POST /api/survival/economy  { action: { type, …what it names } }
 *   → { ok: true, result, state, season, daily }   the whole economy after it, for the game to show
 *   → { ok: false, error }                          refused: not_enough_coins, already_owned, …
 *
 * Every spend and every claim in Droidz Survival goes through here (owner, 26.09.2026: «с фронта
 * убрать экономику — чтобы игра была защищённая и честная»): unlocking a hero or a weapon, a
 * weapon's upgrade, a tree level, crafting (the rarity is rolled HERE), dismantling, merging, the
 * daily claim (the server's day), a quest, a season tier, a continue for Ape Mini. The client names
 * what it wants; the price and the check are lib/survivalEconomy.ts, the numbers the game's own.
 */
export const dynamic = 'force-dynamic'

const TYPES = new Set(['unlock_hero', 'unlock_weapon', 'upgrade_weapon', 'tree_level', 'craft', 'dismantle', 'merge',
    'claim_daily', 'claim_quest', 'claim_tier', 'claim_pass_tier', 'continue_mini'])

/** Only the fields an action names, as the types they must be — nothing else reaches the rules. */
function parseAction(raw: unknown): Action | null {
    if (!raw || typeof raw !== 'object') return null
    const a = raw as Record<string, unknown>
    const s = (k: string) => (typeof a[k] === 'string' && (a[k] as string).length <= 64 ? (a[k] as string) : null)
    const type = typeof a.type === 'string' && TYPES.has(a.type) ? a.type : null
    switch (type) {
        case 'unlock_hero': return s('hero') ? { type, hero: s('hero')! } : null
        case 'unlock_weapon': return s('weapon') ? { type, weapon: s('weapon')! } : null
        case 'upgrade_weapon': return s('weapon') ? { type, weapon: s('weapon')! } : null
        case 'tree_level': return s('hero') && s('node') ? { type, hero: s('hero')!, node: s('node')! } : null
        case 'craft': return s('kind') ? { type, kind: s('kind')!, core: a.core === true } : null
        case 'dismantle': case 'merge': return s('uid') ? { type, uid: s('uid')! } : null
        case 'claim_quest': return s('id') ? { type, id: s('id')! } : null
        case 'claim_tier': case 'claim_pass_tier': return Number.isInteger(a.tier) ? { type, tier: a.tier as number } : null
        case 'claim_daily': case 'continue_mini': return { type }
        default: return null
    }
}

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    const action = parseAction((body as { action?: unknown }).action)
    if (!action) return NextResponse.json({ ok: false, error: 'bad_action' }, { status: 400 })

    let result: Record<string, unknown> = {}
    const r = await withEcon(caller.wallet, undefined, (loaded) => {
        const res = act(loaded.econ, action, { now: Date.now() })
        if (!res.ok) return { fail: res.error }
        result = res.result
        return { next: res.econ, out: res.result }
    })
    const headers = { 'cache-control': 'no-store' }
    if (!r.ok) {
        if (r.error === 'no_server' || r.error === 'busy') return NextResponse.json({ ok: false, error: r.error }, { status: 503, headers })
        return NextResponse.json({ ok: false, error: r.error }, { headers })
    }
    // Money-like moves are journaled: what was bought or claimed, and what it cost or paid.
    logEvent({ level: 'info', kind: `economy.${action.type}`, wallet: caller.wallet, message: JSON.stringify(action).slice(0, 200), data: { result } })
    const { state, season, daily } = r.econ
    return NextResponse.json({ ok: true, result, state, season, daily }, { headers })
}
