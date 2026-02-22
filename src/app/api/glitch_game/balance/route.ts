import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/glitch_game/balance?wallet=0x...
 *
 * Returns the user's games_balance and x_handle from glitch_users.
 * Uses supabaseAdmin to bypass RLS so the frontend can always read its own balance.
 */
export async function GET(req: NextRequest) {
    const wallet = req.nextUrl.searchParams.get('wallet');

    if (!wallet) {
        return NextResponse.json({ games_balance: 0, x_handle: null });
    }

    if (!supabaseAdmin) {
        console.error('❌ [Balance] supabaseAdmin not available');
        return NextResponse.json({ games_balance: 0, x_handle: null });
    }

    const { data, error } = await supabaseAdmin
        .from('glitch_users')
        .select('games_balance, x_handle')
        .eq('wallet_address', wallet)
        .maybeSingle();

    if (error) {
        console.error('❌ [Balance] DB error:', error.message);
        return NextResponse.json({ games_balance: 0, x_handle: null });
    }

    return NextResponse.json({
        games_balance: data?.games_balance ?? 0,
        x_handle: data?.x_handle ?? null,
    });
}
