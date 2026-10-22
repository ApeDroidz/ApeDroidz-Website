import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/survival/pool — the live season's prize pools, for the game's main menu and Season
 * screen. Public and read-only: the numbers the pool panel advertises, nothing behind them.
 *
 *   { seasonId, seasonName, endsAt, paysOut, poolApe, soloApe, coopApe, players, games, soloGames, coopGames,
 *     prizes: [{ place, unlockLevel, name, imageUrl, awarded }] — the NFTs on top of the APE,
 *     live: { url, channel, event } — where the new totals are pushed the moment they are booked }
 *
 * Every figure is summed from the append-only ledger and the runs table at read time — the pool is
 * never a stored number anyone can edit. Each mode has its own pool (owner, 24.09.2026: «чтобы для
 * каждого режима формировался свой пул»): the cashier pays half of every purchase into that mode's
 * vault and the ledger books it as solo_pool / coop_pool. The pre-split bucket (season_pool) counts
 * as solo. `games` = runs played to the end this season; `players` = wallets that played one.
 *
 * `reserveApe` is frozen for the next season; `payoutApe` is what this one pays (lib/survivalForecast.ts).
 *
 * 204 when no season is live — the game then shows no number rather than an invented one.
 */
export const dynamic = 'force-dynamic'

const round = (n: number) => Math.round(n * 1e6) / 1e6

/** The body as this instance last built it: `?anything` misses the edge cache, not this. */
let memo: { until: number; body: Promise<Record<string, unknown> | null> } | null = null
const MEMO_MS = 5_000
// Short on purpose (15.10.2026): an open screen gets each new booking pushed live (see `live`), and a
// screen opened right after one must not be handed the old sum for a minute.
const HEADERS = { 'cache-control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=10' }

/**
 * Where an open screen listens for new bookings: the public Realtime channel `survival-pool` the ledger
 * broadcasts the fresh totals on (migration 20261015d). The anon key is the public one the site's own
 * pages already ship; the channel carries only these same totals.
 */
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const LIVE = SUPA_URL.startsWith('https://') && SUPA_ANON
    ? { url: `${SUPA_URL.replace(/^https:/, 'wss:')}/realtime/v1/websocket?apikey=${encodeURIComponent(SUPA_ANON)}&vsn=1.0.0`, channel: 'survival-pool', event: 'pool' }
    : null

export async function GET(req: Request) {
    if (!supabaseAdmin) return new NextResponse(null, { status: 204 })
    // `?fresh=1`: right after a payment the game asks past both caches (15.10.2026: a 1 APE ticket
    // from the cabinet showed in the pool only a minute later). One rpc, so it is cheap; the answer
    // is not stored at the edge, and it refreshes this instance's memo for everyone else.
    if (new URL(req.url).searchParams.get('fresh') === '1') {
        const body = await build().catch(() => null)
        if (!body) return new NextResponse(null, { status: 204 })
        memo = { until: Date.now() + MEMO_MS, body: Promise.resolve(body) }
        return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
    }
    const now = Date.now()
    if (!memo || memo.until < now) memo = { until: now + MEMO_MS, body: build().catch(() => null) }
    const body = await memo.body
    if (!body) { memo = null; return new NextResponse(null, { status: 204 }) }
    // Shared cache: every menu asks, nobody needs it to the second. At the edge for 30 s, so
    // however many players sit on the menu, the function runs about twice a minute.
    return NextResponse.json(body, { headers: HEADERS })
}

async function build(): Promise<Record<string, unknown> | null> {
    const { data: season, error } = await supabaseAdmin.from('survival_seasons')
        .select('id, name, ends_at, pays_out, payout_pct').eq('status', 'live').limit(1).maybeSingle()
    if (error || !season) return null

    // Counted in the database (survival_pool_stats): one row out, however long the season.
    const { data: st, error: sErr } = await supabaseAdmin.rpc('survival_pool_stats', { p_season: season.id })
    if (sErr) { console.warn('[survival/pool]', sErr.message); return null }
    const r = ((st as Array<Record<string, number | string>> | null) ?? [])[0] ?? {}
    // The NFT prizes on top of the APE (admin: spltpnl → survival_pool_prizes): which place takes
    // each, and the pool level that opens it (null = open from the start).
    const { data: nfts } = await supabaseAdmin.from('survival_pool_prizes')
        .select('place, unlock_level, name, image_url, status').eq('season_id', season.id).neq('status', 'removed')
        .order('place').order('id')
    const solo = Number(r.solo_ape ?? 0), coop = Number(r.coop_ape ?? 0)
    const players = Number(r.players ?? 0), games = Number(r.games ?? 0)
    return {
        seasonId: season.id,
        seasonName: season.name,
        endsAt: season.ends_at ? new Date(season.ends_at).getTime() : null,
        paysOut: season.pays_out === true,
        poolApe: round(solo + coop), soloApe: round(solo), coopApe: round(coop),
        players, games, soloGames: Number(r.solo_games ?? 0), coopGames: Number(r.coop_games ?? 0),
        // legacy fields the Season screen reads
        totalRuns: games, totalPlayers: players,
        // Frozen for the next season's start (owner, 25.09.2026: «сразу замораживать 10–15% пула на
        // старт следующего сезона и тоже это показывать»); the rest is what the season pays out.
        reservePct: Math.round((1 - Number(season.payout_pct ?? 0.9)) * 100),
        reserveApe: round((solo + coop) * (1 - Number(season.payout_pct ?? 0.9))),
        payoutApe: round((solo + coop) * Number(season.payout_pct ?? 0.9)),
        live: LIVE,
        prizes: ((nfts as Array<{ place: number; unlock_level: number | null; name: string | null; image_url: string | null; status: string }> | null) ?? [])
            .map((p) => ({ place: p.place, unlockLevel: p.unlock_level, name: p.name, imageUrl: prizeThumb(p.image_url), awarded: p.status !== 'listed' })),
    }
}

/**
 * A prize's picture as the game and the landing draw it — small (owner, 22.10.2026: «у приза очень
 * долго картинка грузится»). The panel stores the full 3D bust (3D-media/3D-PFP/<kind>/<id>.jpg,
 * 2048 px, ~1.7 MB, not cached at the edge: ~2.4 s every time) and it is shown at ~200 px; the same
 * bust's 512 px WebP preview sits beside it on R2 (3D-media/3D-PFP-512/<kind>/<id>.webp, ~15 KB).
 * Any other picture goes as it is.
 */
function prizeThumb(url: string | null): string | null {
    if (!url) return url
    const m = /^(https:\/\/assets\.apedroidz\.com\/apedroidz\/3D-media)\/3D-PFP\/([\w-]+)\/(\d+)\.(?:jpe?g|png)(?:\?.*)?$/i.exec(url)
    return m ? `${m[1]}/3D-PFP-512/${m[2]}/${m[3]}.webp` : url
}
