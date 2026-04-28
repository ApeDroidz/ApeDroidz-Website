import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidWallet } from '@/lib/walletAuth';

/**
 * GET /api/glitch_game/balance?wallet=0x...
 *
 * Returns the user's games_balance and x_handle from glitch_users.
 * Wallet address is regex-validated to prevent `ilike` wildcard abuse
 * (e.g. `?wallet=%` would otherwise leak another user's balance).
 */
export async function GET(req: NextRequest) {
    const wallet = req.nextUrl.searchParams.get('wallet');

    if (!wallet || !isValidWallet(wallet)) {
        return NextResponse.json({ games_balance: 0, x_handle: null });
    }

    if (!supabaseAdmin) {
        console.error('❌ [Balance] supabaseAdmin not available');
        return NextResponse.json({ games_balance: 0, x_handle: null });
    }

    // ilike (after regex validation above): wallet is guaranteed to be hex-only,
    // so ilike behaves like a case-insensitive eq. This handles legacy rows
    // stored with mixed case (e.g. checksummed `0xAbC…`).
    const { data, error } = await supabaseAdmin
        .from('glitch_users')
        .select('games_balance, x_handle')
        .ilike('wallet_address', wallet)
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
