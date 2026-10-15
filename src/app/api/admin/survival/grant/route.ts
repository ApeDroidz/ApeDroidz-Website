import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { supabaseAdmin } from '@/lib/supabase'
import { withEcon } from '@/lib/survivalEconomyStore'
import { tierForSxp, type Econ } from '@/lib/survivalEconomy'
import { logEvent } from '@/lib/survivalLog'
import ECON from '@/lib/survivalEconomy.json'

/**
 * POST /api/admin/survival/grant — the owner gives a player anything from the panel (owner,
 * 15.10.2026: «когда открываю юзера, дать возможность начислить ему что угодно — эйпы, ресурсы
 * и т. д.»). Runs in hand stay on api/admin/survival/credits.
 *
 *   { wallet, coins?: ±n, resources?: { scrap?: ±n, circuit?, cell?, core? }, sxp?: ±n,
 *     heroes?: string[], weapons?: string[], tiers?: { <weapon>: 1..4 },
 *     items?: [{ kind, rarity }], note? }
 *
 * One write through the server economy (withEcon: compare-and-set against the game's own saves),
 * so a grant never races a run's pay. Numbers never go below zero. The game sees it at its next
 * profile read (a reload, the menu after a run). Every grant is a line in the journal
 * (survival_events kind `admin.grant`) with what was given and the note.
 */
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }

const RES = ['scrap', 'circuit', 'cell', 'core'] as const
const HEROES = Object.keys((ECON as { heroes: Record<string, unknown> }).heroes)
const WEAPONS = Object.keys((ECON as { weapons: Record<string, unknown> }).weapons)
const KINDS = Object.keys((ECON as { items: { kinds: Record<string, unknown> } }).items.kinds)
const RARITIES = (ECON as { items: { rarities: string[] } }).items.rarities
const BAG = (ECON as { items: { bagSize: number } }).items.bagSize
const LIMIT = 10_000_000

const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-LIMIT, Math.min(LIMIT, Math.trunc(v))) : 0)
const strs = (v: unknown, known: string[]): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && known.includes(s)) : [])

export async function POST(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const wallet = typeof body.wallet === 'string' ? body.wallet.trim().toLowerCase() : ''
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ error: 'Not a wallet address' }, { status: 400, headers })

    const coins = int(body.coins)
    const sxp = int(body.sxp)
    const res: Partial<Record<(typeof RES)[number], number>> = {}
    const rIn = (body.resources ?? {}) as Record<string, unknown>
    for (const r of RES) { const n = int(rIn[r]); if (n) res[r] = n }
    const heroes = strs(body.heroes, HEROES)
    const weapons = strs(body.weapons, WEAPONS)
    const tiers: Record<string, number> = {}
    for (const [w, t] of Object.entries((body.tiers ?? {}) as Record<string, unknown>)) {
        if (WEAPONS.includes(w) && typeof t === 'number') tiers[w] = Math.max(1, Math.min(4, Math.trunc(t)))
    }
    const items = (Array.isArray(body.items) ? body.items : [])
        .map((i) => i as { kind?: unknown; rarity?: unknown })
        .filter((i) => typeof i.kind === 'string' && KINDS.includes(i.kind) && typeof i.rarity === 'string' && RARITIES.includes(i.rarity))
        .slice(0, 20) as { kind: string; rarity: string }[]
    const note = typeof body.note === 'string' ? body.note.slice(0, 200) : ''
    const asked = { coins, sxp, resources: res, heroes, weapons, tiers, items }
    if (!coins && !sxp && !Object.keys(res).length && !heroes.length && !weapons.length && !Object.keys(tiers).length && !items.length) {
        return NextResponse.json({ error: 'Nothing to give' }, { status: 400, headers })
    }

    // The player row must exist (the economy rows reference it).
    await supabaseAdmin.from('survival_players').upsert({ wallet }, { onConflict: 'wallet', ignoreDuplicates: true })

    const done = await withEcon(wallet, undefined, (loaded) => {
        const x = JSON.parse(JSON.stringify(loaded.econ)) as Econ
        const s = x.state as Record<string, unknown>
        if (sxp && !loaded.seasonId) return { fail: 'no_live_season' }
        if (coins) s.coins = Math.max(0, int(s.coins) + coins)
        const r = { ...((s.resources ?? {}) as Record<string, number>) }
        for (const [k, n] of Object.entries(res)) r[k] = Math.max(0, int(r[k]) + (n ?? 0))
        s.resources = r
        const owned = new Set<string>(Array.isArray(s.unlockedHeroes) ? (s.unlockedHeroes as string[]) : [])
        for (const h of heroes) owned.add(h)
        s.unlockedHeroes = [...owned]
        const ws = new Set<string>(Array.isArray(s.unlockedWeapons) ? (s.unlockedWeapons as string[]) : [])
        for (const w of [...weapons, ...Object.keys(tiers)]) ws.add(w)
        s.unlockedWeapons = [...ws]
        s.weaponTiers = { ...((s.weaponTiers ?? {}) as Record<string, number>), ...tiers }
        const bag = Array.isArray(s.items) ? [...(s.items as Array<Record<string, unknown>>)] : []
        if (bag.length + items.length > BAG) return { fail: `bag_full (${bag.length}/${BAG})` }
        items.forEach((it, i) => bag.push({ uid: `a${Date.now().toString(36)}${i}${Math.floor(Math.random() * 36 ** 4).toString(36)}`, kind: it.kind, rarity: it.rarity }))
        s.items = bag
        if (sxp) { x.season.sxp = Math.max(0, x.season.sxp + sxp); x.season.tier = tierForSxp(x.season.sxp) }
        return { next: x, out: { coins: s.coins, resources: s.resources, sxp: x.season.sxp, tier: x.season.tier, heroes: s.unlockedHeroes, weapons: s.unlockedWeapons, items: bag.length } }
    })
    if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.error === 'no_server' ? 500 : 409, headers })
    logEvent({ level: 'info', kind: 'admin.grant', wallet, message: note || 'granted from the panel', data: { asked, now: done.out } })
    return NextResponse.json({ ok: true, wallet, now: done.out }, { headers })
}
