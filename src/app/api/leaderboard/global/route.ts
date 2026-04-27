import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leaderboard/global?limit=50&wallet=0x...
 *
 * Returns global leaderboard ranked by total XP = users.xp (NFT) + s1.season_xp + s2.season_xp
 * Also returns the requesting wallet's rank if provided.
 */
export async function GET(req: NextRequest) {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 100)
    const wallet = req.nextUrl.searchParams.get('wallet')

    try {
        // Fetch all three XP sources in parallel
        const [usersRes, s1Res, s2Res] = await Promise.all([
            supabaseAdmin.from('users').select('wallet_address, xp, username, droids_count'),
            supabaseAdmin.from('glitch_season_1').select('wallet_address, season_xp'),
            supabaseAdmin.from('glitch_season_2').select('wallet_address, season_xp'),
        ])

        if (usersRes.error) throw usersRes.error

        const s1Map = new Map((s1Res.data ?? []).map((r: any) => [r.wallet_address.toLowerCase(), r.season_xp ?? 0]))
        const s2Map = new Map((s2Res.data ?? []).map((r: any) => [r.wallet_address.toLowerCase(), r.season_xp ?? 0]))

        // Combine XP
        const combined = (usersRes.data ?? []).map((u: any) => {
            const w = u.wallet_address.toLowerCase()
            const nftXp = u.xp ?? 0
            const s1Xp = s1Map.get(w) ?? 0
            const s2Xp = s2Map.get(w) ?? 0
            return {
                wallet_address: u.wallet_address,
                username: u.username || null,
                droids_count: u.droids_count ?? 0,
                nft_xp: nftXp,
                s1_xp: s1Xp,
                s2_xp: s2Xp,
                total_xp: nftXp + s1Xp + s2Xp,
            }
        })

        combined.sort((a: any, b: any) => b.total_xp - a.total_xp)

        const leaderboard = combined.slice(0, limit).map((u: any, i: number) => ({ rank: i + 1, ...u }))

        // Player rank
        let playerRank: number | null = null
        let playerTotalXp: number | null = null
        if (wallet) {
            const w = wallet.toLowerCase()
            const idx = combined.findIndex((u: any) => u.wallet_address.toLowerCase() === w)
            if (idx !== -1) {
                playerRank = idx + 1
                playerTotalXp = combined[idx].total_xp
            }
        }

        return NextResponse.json({
            leaderboard,
            player: wallet ? { rank: playerRank, total_xp: playerTotalXp } : undefined,
        })

    } catch (err: any) {
        console.error('[GlobalLeaderboard] Error:', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
