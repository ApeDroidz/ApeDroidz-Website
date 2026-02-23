import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 60; // Cache for 60 seconds

export async function GET() {
    try {
        // 1. Fetch top players from season 1
        const { data: seasonData, error: seasonErr } = await supabaseAdmin
            .from('glitch_season_1')
            .select('*')
            .order('season_xp', { ascending: false })
            .limit(100);

        if (seasonErr) {
            console.error('❌ [Season 1 Leaderboard] Error fetching top players:', seasonErr.message);
            return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
        }

        if (!seasonData || seasonData.length === 0) {
            return NextResponse.json({ leaderboard: [] });
        }

        const wallets = seasonData.map((row: any) => row.wallet_address);

        // Create an OR filter for case-insensitive matching of all wallets
        const orFilter = wallets.map((w: string) => `wallet_address.ilike.${w}`).join(',');

        // 2. Fetch user details (username) from 'users' table
        const { data: usersData, error: usersErr } = await supabaseAdmin
            .from('users')
            .select('wallet_address, username, PFP, level, rank_title')
            .or(orFilter);

        // 3. Fetch x_handle from 'glitch_users' table
        const { data: glitchUsersData, error: glitchUsersErr } = await supabaseAdmin
            .from('glitch_users')
            .select('wallet_address, x_handle')
            .or(orFilter);

        if (usersErr || glitchUsersErr) {
            console.error('❌ [Season 1 Leaderboard] Error fetching user details:', usersErr?.message || glitchUsersErr?.message);
        }

        // 4. Map the data together
        const leaderboard = seasonData.map((player: any) => {
            const playerWalletLower = player.wallet_address.toLowerCase();
            const userMatch = usersData?.find((u: any) => u.wallet_address.toLowerCase() === playerWalletLower);
            const glitchMatch = glitchUsersData?.find((gu: any) => gu.wallet_address.toLowerCase() === playerWalletLower);

            return {
                wallet_address: player.wallet_address,
                season_xp: player.season_xp || 0,
                games_played: player.games_played || 0,
                quests_finished: player.quests_finished || 0,
                username: userMatch?.username || null,
                PFP: userMatch?.PFP || null,
                level: userMatch?.level || 1,
                rank_title: userMatch?.rank_title || "Baby Droid",
                x_handle: glitchMatch?.x_handle || null
            };
        });

        // Ensure array is strictly sorted by XP descending
        leaderboard.sort((a: any, b: any) => b.season_xp - a.season_xp);

        return NextResponse.json({ leaderboard });

    } catch (e: any) {
        console.error('🔥 [Season 1 Leaderboard] Catch Error:', e.message);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
