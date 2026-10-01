import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/survivalFetchAll'

/**
 * GET /api/survival/board
 *
 * The live season's board for the game's Leaderboard screen: rank, the player's wallet
 * (shortened), their X handle if the site knows one (glitch_users.x_handle), their clan,
 * and the run that put them there. Public and read-only, like the pool endpoint; cached at
 * the edge for a few seconds because every player on the menu asks for it.
 *
 * Rows come from survival_season_best (one per wallet, the trigger keeps it), never from
 * the runs table — so a rejected or void run cannot appear here by construction.
 */
export const dynamic = 'force-dynamic'

const LIMIT = 50

interface BestRow { wallet: string; score: number; wave: number; kills: number; runs_count: number; achieved_at: string; run_id: string | null }
interface PlayerRow { wallet: string; clan: string | null; banned: boolean }
interface XRow { wallet_address: string; x_handle: string | null }

const HEADERS = { 'cache-control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=60' }
/** Wallets per `.in()` — each is ~45 characters of URL; a few hundred in one request break it. */
const IN_CHUNK = 200
/** The board as this instance last built it, per filter: the edge cache is keyed by the full URL,
 *  so `?r=<anything>` went past it to the database; this does not. */
const memo = new Map<string, { until: number; body: Promise<Record<string, unknown> | null> }>()
const MEMO_MS = 10_000

export async function GET(req: Request) {
    if (!supabaseAdmin) return new NextResponse(null, { status: 204 })
    // ?only=pass — the season's own board: pass holders only, ranked among themselves (owner,
    // 26.09.2026: «в сезоне первым выводится сезонный рейтинг тех, кто с пассом, но можно
    // посмотреть общий»). Filtering the top 50 of everyone instead would drop a holder ranked 51st.
    const only = new URL(req.url).searchParams.get('only') === 'pass' ? 'pass' : 'all'
    const now = Date.now()
    let hit = memo.get(only)
    if (!hit || hit.until < now) {
        hit = { until: now + MEMO_MS, body: build(only).catch(() => null) }
        memo.set(only, hit)
    }
    const body = await hit.body
    if (!body) { memo.delete(only); return new NextResponse(null, { status: 204 }) }
    return NextResponse.json(body, { headers: HEADERS })
}

async function build(only: 'pass' | 'all'): Promise<Record<string, unknown> | null> {

    const { data: season } = await supabaseAdmin
        .from('survival_seasons').select('id, name').eq('status', 'live').limit(1).maybeSingle()
    if (!season) return null

    // Every pass holder of the season (a pass bought before seasons were stamped has no season_id;
    // a test pass — test_* sku, SURVIVAL_TEST_WALLETS — is not one: it shares no pool),
    // page by page — a read stops at 1000 rows.
    const { rows: passRows } = await fetchAll<{ wallet: string }>(() => supabaseAdmin.from('survival_entitlements').select('wallet')
        .eq('kind', 'season_pass').not('sku', 'like', 'test_%').or(`season_id.eq.${season.id},season_id.is.null`).order('id'), { cap: 20_000 })
    const passHolders = new Set(passRows.map((p) => p.wallet))
    if (only === 'pass' && passHolders.size === 0) {
        return { seasonId: season.id, seasonName: season.name, only, passCount: 0, rows: [] }
    }

    const top = (wallets?: string[]) => {
        let q = supabaseAdmin.from('survival_season_best')
            .select('wallet, score, wave, kills, runs_count, achieved_at, run_id')
            .eq('season_id', season.id)
        if (wallets) q = q.in('wallet', wallets)
        return q.order('score', { ascending: false }).order('achieved_at', { ascending: true }).limit(LIMIT)
    }
    let rowsBest: BestRow[]
    if (only === 'pass') {
        // The holders in chunks, each chunk's top 50, merged: the same 50 one query would give.
        const list = [...passHolders]
        const parts = await Promise.all(Array.from({ length: Math.ceil(list.length / IN_CHUNK) }, (_, i) => top(list.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK))))
        const bad = parts.find((p) => p.error)
        if (bad) { console.warn('[survival/board]', bad.error?.message); return null }
        rowsBest = parts.flatMap((p) => (p.data as BestRow[] | null) ?? [])
            .sort((a, b) => Number(b.score) - Number(a.score) || a.achieved_at.localeCompare(b.achieved_at)).slice(0, LIMIT)
    } else {
        const { data: best, error } = await top()
        if (error || !best) { console.warn('[survival/board]', error?.message); return null }
        rowsBest = best as BestRow[]
    }

    const wallets = rowsBest.map((b) => b.wallet)
    const players: PlayerRow[] = wallets.length
        ? ((await supabaseAdmin.from('survival_players').select('wallet, clan, banned').in('wallet', wallets)).data ?? [])
        : []
    // glitch_users stores wallets in their checksummed spelling; match case-insensitively.
    const xs: XRow[] = wallets.length
        ? ((await supabaseAdmin.from('glitch_users').select('wallet_address, x_handle')
            .or(wallets.map((w: string) => `wallet_address.ilike.${w}`).join(','))).data ?? [])
        : []

    // Каким героем поставлен рекорд — из того самого забега, что его поставил
    // (survival_season_best.run_id). Владелец, 20.09: колонка HERO в таблице.
    const runIds = rowsBest.map((b) => b.run_id).filter((id): id is string => !!id)
    const heroOf = new Map<string, string>()
    // How long the best run lasted (the server's own clock), for the TIME column.
    const msOf = new Map<string, number>()
    if (runIds.length) {
        const { data: runs } = await supabaseAdmin.from('survival_runs').select('id, hero, server_duration_ms').in('id', runIds)
        for (const r of (runs ?? []) as Array<{ id: string; hero: string | null; server_duration_ms: number | null }>) {
            if (r.hero) heroOf.set(r.id, r.hero)
            if (r.server_duration_ms) msOf.set(r.id, Number(r.server_duration_ms))
        }
    }

    // Season-pass holders are marked on the board (owner, 25.09.2026: «в лидерборде помечать
    // жёлтой надписью PASS, у кого есть пропуск») — only they share the pool.
    const clanOf = new Map(players.map((p) => [p.wallet, p]))
    const xOf = new Map<string, string>()
    for (const row of xs) {
        if (row.x_handle) xOf.set(row.wallet_address.toLowerCase(), row.x_handle)
    }

    let rank = 0
    const rows = rowsBest
        .filter((b) => !clanOf.get(b.wallet)?.banned)
        .map((b) => {
            rank += 1
            return {
                rank,
                wallet: `${b.wallet.slice(0, 6)}…${b.wallet.slice(-4)}`,
                x: xOf.get(b.wallet) ?? null,
                clan: clanOf.get(b.wallet)?.clan ?? null,
                hero: b.run_id ? heroOf.get(b.run_id) ?? null : null,
                timeMs: b.run_id ? msOf.get(b.run_id) ?? null : null,
                score: Number(b.score), wave: Number(b.wave), kills: Number(b.kills),
                runs: Number(b.runs_count),
                pass: passHolders.has(b.wallet),
            }
        })

    return { seasonId: season.id, seasonName: season.name, only, passCount: passHolders.size, rows }
}
