import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

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

interface BestRow { wallet: string; score: number; wave: number; kills: number; runs_count: number; achieved_at: string }
interface PlayerRow { wallet: string; clan: string | null; banned: boolean }
interface XRow { wallet_address: string; x_handle: string | null }

export async function GET() {
    if (!supabaseAdmin) return new NextResponse(null, { status: 204 })

    const { data: season } = await supabaseAdmin
        .from('survival_seasons').select('id, name').eq('status', 'live').limit(1).maybeSingle()
    if (!season) return new NextResponse(null, { status: 204 })

    const { data: best, error } = await supabaseAdmin
        .from('survival_season_best')
        .select('wallet, score, wave, kills, runs_count, achieved_at')
        .eq('season_id', season.id)
        .order('score', { ascending: false }).order('achieved_at', { ascending: true })
        .limit(LIMIT)
    if (error || !best) { console.warn('[survival/board]', error?.message); return new NextResponse(null, { status: 204 }) }
    const rowsBest = best as BestRow[]

    const wallets = rowsBest.map((b) => b.wallet)
    const players: PlayerRow[] = wallets.length
        ? ((await supabaseAdmin.from('survival_players').select('wallet, clan, banned').in('wallet', wallets)).data ?? [])
        : []
    // glitch_users stores wallets in their checksummed spelling; match case-insensitively.
    const xs: XRow[] = wallets.length
        ? ((await supabaseAdmin.from('glitch_users').select('wallet_address, x_handle')
            .or(wallets.map((w: string) => `wallet_address.ilike.${w}`).join(','))).data ?? [])
        : []

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
                score: Number(b.score), wave: Number(b.wave), kills: Number(b.kills),
                runs: Number(b.runs_count),
            }
        })

    return NextResponse.json(
        { seasonId: season.id, seasonName: season.name, rows },
        { headers: { 'cache-control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=60' } },
    )
}
