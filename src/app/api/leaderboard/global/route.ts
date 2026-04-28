import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leaderboard/global?limit=50&wallet=0x...
 *
 * Returns global leaderboard ranked by total XP = users.xp (NFT) + s1.season_xp + s2.season_xp.
 * Each entry includes a derived level + rank_title computed from total_xp using the
 * same milestones as user-progress-provider, plus x_handle from glitch_users.
 */

// Mirrors LEVEL_MILESTONES + rank-title ladder in user-progress-provider.tsx
const LEVEL_MILESTONES = [0, 1000, 3000, 5000, 10000, 30000, 50000, 100000, 200000, 300000]

function deriveLevelRank(xp: number): { level: number; rank_title: string } {
    let level = 1
    for (let i = 0; i < LEVEL_MILESTONES.length; i++) {
        if (xp >= LEVEL_MILESTONES[i]) level = i + 1
        else break
    }
    let rank = 'Baby Droid'
    if (xp >= 300000) rank = 'IRON GOD'
    else if (xp >= 200000) rank = 'Droidzilla'
    else if (xp >= 100000) rank = 'BlackHole'
    else if (xp >= 50000) rank = 'Droidz Glitch'
    else if (xp >= 30000) rank = 'Droidz King'
    else if (xp >= 10000) rank = 'Droidz Whale'
    else if (xp >= 5000) rank = 'Droidz Legend'
    else if (xp >= 3000) rank = 'Droidz Collector'
    else if (xp >= 1000) rank = 'Droidz Holder'
    return { level, rank_title: rank }
}

export async function GET(req: NextRequest) {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 100)
    const wallet = req.nextUrl.searchParams.get('wallet')

    try {
        // Fetch all four sources in parallel.
        const [usersRes, s1Res, s2Res, glitchRes] = await Promise.all([
            supabaseAdmin.from('users').select('wallet_address, xp, username, droids_count'),
            supabaseAdmin.from('glitch_season_1').select('wallet_address, season_xp'),
            supabaseAdmin.from('glitch_season_2').select('wallet_address, season_xp'),
            supabaseAdmin.from('glitch_users').select('wallet_address, x_handle'),
        ])

        if (usersRes.error) throw usersRes.error

        const s1Map = new Map((s1Res.data ?? []).map((r: any) => [String(r.wallet_address).toLowerCase(), r.season_xp ?? 0]))
        const s2Map = new Map((s2Res.data ?? []).map((r: any) => [String(r.wallet_address).toLowerCase(), r.season_xp ?? 0]))
        const xMap  = new Map((glitchRes.data ?? []).map((r: any) => [String(r.wallet_address).toLowerCase(), r.x_handle ?? null]))

        // Combine + derive level/rank.
        const combined = (usersRes.data ?? []).map((u: any) => {
            const w = String(u.wallet_address).toLowerCase()
            const nftXp = Number(u.xp ?? 0)
            const s1Xp = Number(s1Map.get(w) ?? 0)
            const s2Xp = Number(s2Map.get(w) ?? 0)
            const total_xp = nftXp + s1Xp + s2Xp
            const { level, rank_title } = deriveLevelRank(total_xp)
            return {
                wallet_address: u.wallet_address,
                username: u.username || null,
                x_handle: xMap.get(w) ?? null,
                droids_count: u.droids_count ?? 0,
                nft_xp: nftXp,
                s1_xp: s1Xp,
                s2_xp: s2Xp,
                xp: total_xp,        // alias kept for backward compat with old UIs
                total_xp,
                level,
                rank_title,
            }
        })

        combined.sort((a: any, b: any) => b.total_xp - a.total_xp)

        const leaderboard = combined.slice(0, limit).map((u: any, i: number) => ({ rank: i + 1, ...u }))

        // Player rank
        let playerRank: number | null = null
        let playerTotalXp: number | null = null
        if (wallet) {
            const w = wallet.toLowerCase()
            const idx = combined.findIndex((u: any) => String(u.wallet_address).toLowerCase() === w)
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
