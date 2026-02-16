import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createThirdwebClient, defineChain, getContract } from 'thirdweb';
import { balanceOf } from 'thirdweb/extensions/erc721';

const THIRDWEB_CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!;
const DROID_CONTRACT = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || '';
const apeChain = defineChain(33139);
const thirdwebClient = createThirdwebClient({ clientId: THIRDWEB_CLIENT_ID });

const TWEET_URL_REGEX = /^https?:\/\/(x\.com|twitter\.com)\/\w+\/status\/\d+/i;

/**
 * POST /api/games/daily
 * Holder-gated daily claim: verify hold, check cooldown, save x_handle, validate proof, grant +1 game.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const wallet = body.wallet?.toLowerCase();
        const { xHandle, proofLink } = body;

        if (!wallet) return NextResponse.json({ error: 'Wallet required' }, { status: 400 });

        // 1. Holder gate — on-chain balance check
        try {
            const droidContract = getContract({ client: thirdwebClient, chain: apeChain, address: DROID_CONTRACT });
            const balance = await balanceOf({ contract: droidContract, owner: wallet });
            if (balance <= BigInt(0)) {
                return NextResponse.json({ error: 'Holders only — you need at least 1 Droid' }, { status: 403 });
            }
        } catch (err) {
            console.error('❌ [Daily] On-chain check failed:', err);
            return NextResponse.json({ error: 'Failed to verify holdings' }, { status: 500 });
        }

        // 2. Get active task config
        const now = new Date().toISOString();
        const { data: taskConfig } = await supabaseAdmin
            .from('daily_task_config')
            .select('*')
            .lte('active_from', now)
            .gte('active_to', now)
            .order('active_from', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!taskConfig) {
            return NextResponse.json({ error: 'No active daily task' }, { status: 404 });
        }

        // 3. Check if already claimed THIS specific task
        const { data: existingClaim } = await supabaseAdmin
            .from('daily_claims_log')
            .select('id')
            .eq('wallet_address', wallet)
            .eq('task_config_id', taskConfig.id)
            .maybeSingle();

        if (existingClaim) {
            return NextResponse.json({ error: 'Already claimed this task' }, { status: 429 });
        }

        // 4. Validate inputs
        if (!proofLink || !TWEET_URL_REGEX.test(proofLink.trim())) {
            return NextResponse.json({ error: 'Valid tweet/post URL required' }, { status: 400 });
        }

        // 5. Upsert glitch_users + save x_handle if provided
        // 5. Log claim FIRST (prevent double-claim exploit)
        const { error: logErr } = await supabaseAdmin
            .from('daily_claims_log')
            .insert({
                wallet_address: wallet,
                task_config_id: taskConfig.id,
                proof_link: proofLink.trim(),
                x_handle: xHandle?.trim() || null,
            });

        if (logErr) {
            console.error('❌ [Daily] Claim log error (likely duplicate or missing column):', logErr.message);
            // If column missing (proof_link), sending 500 is correct but helpful to know why.
            // If duplicate claim (race condition), sending 400 or 429 is better.
            if (logErr.message.includes('duplicate')) {
                return NextResponse.json({ error: 'Already claimed' }, { status: 429 });
            }
            return NextResponse.json({ error: 'Failed to log claim (Database Error)' }, { status: 500 });
        }

        // 6. Upsert glitch_users to grant reward
        const { data: existingUser } = await supabaseAdmin
            .from('glitch_users')
            .select('*')
            .eq('wallet_address', wallet)
            .maybeSingle();

        if (!existingUser) {
            const { error: insertErr } = await supabaseAdmin
                .from('glitch_users')
                .insert({
                    wallet_address: wallet,
                    games_balance: 1,
                    x_handle: xHandle?.trim() || null,
                });
            if (insertErr) {
                console.error('❌ [Daily] User insert:', insertErr.message);
                // Rollback claim? Ideally yes, but Supabase HTTP client has no transaction rollback.
                // It's better to have a log without reward (user complains -> we fix) 
                // than reward without log (infinite exploit).
                return NextResponse.json({ error: 'Claim logged but failed to grant game. Contact support.' }, { status: 500 });
            }
        } else {
            const updates: any = { games_balance: existingUser.games_balance + 1 };
            if (xHandle?.trim() && !existingUser.x_handle) {
                updates.x_handle = xHandle.trim();
            }
            const { error: updateErr } = await supabaseAdmin
                .from('glitch_users')
                .update(updates)
                .eq('wallet_address', wallet);
            if (updateErr) {
                console.error('❌ [Daily] User update:', updateErr.message);
                return NextResponse.json({ error: 'Failed to update balance' }, { status: 500 });
            }
        }



        const newBalance = existingUser ? existingUser.games_balance + 1 : 1;
        console.log(`✅ [Daily] ${wallet.slice(0, 8)}... claimed +1 game (balance: ${newBalance})`);

        return NextResponse.json({
            success: true,
            message: '+1 Game Access granted!',
            newBalance,
        });
    } catch (err: any) {
        console.error('🔥 [Daily] Critical:', err.message);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
