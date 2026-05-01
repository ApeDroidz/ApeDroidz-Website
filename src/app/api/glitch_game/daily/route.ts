import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createThirdwebClient, defineChain, getContract } from 'thirdweb';
import { balanceOf } from 'thirdweb/extensions/erc721';
import { requireWalletAuth } from '@/lib/walletAuth';

const THIRDWEB_CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!;
const DROID_CONTRACT = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || '';
const apeChain = defineChain(33139);
const thirdwebClient = createThirdwebClient({ clientId: THIRDWEB_CLIENT_ID });

const TWEET_URL_REGEX = /^https?:\/\/(x\.com|twitter\.com)\/\w+\/status\/\d+/i;
const X_HANDLE_REGEX = /^@?[A-Za-z0-9_]{1,15}$/;

/**
 * POST /api/games/daily
 * Holder-gated daily claim: verify hold, check cooldown, save x_handle, validate proof, grant +1 game.
 *
 * Auth: requires wallet session cookie. Wallet is taken from the cookie —
 *       NOT from the body — so an attacker cannot griefingly claim on behalf
 *       of another user.
 */
export async function POST(req: Request) {
    try {
        // ── Authentication ──────────────────────────────────────────────────
        const auth = requireWalletAuth(req);
        if (auth instanceof Response) return auth;
        const wallet = auth.wallet; // lowercase, validated

        const body = await req.json().catch(() => ({}));
        const { xHandle, proofLink } = body ?? {};

        // ── Validate inputs ─────────────────────────────────────────────────
        if (typeof proofLink !== 'string' || !TWEET_URL_REGEX.test(proofLink.trim())) {
            return NextResponse.json({ error: 'Valid tweet/post URL required' }, { status: 400 });
        }
        let cleanedXHandle: string | null = null;
        if (typeof xHandle === 'string' && xHandle.trim().length > 0) {
            const stripped = xHandle.trim().replace(/^@/, '');
            if (!X_HANDLE_REGEX.test(stripped)) {
                return NextResponse.json({ error: 'Invalid X handle' }, { status: 400 });
            }
            cleanedXHandle = '@' + stripped;
        }

        // ── 1. Holder gate — on-chain balance check ─────────────────────────
        let droidCount = 0;
        try {
            const droidContract = getContract({ client: thirdwebClient, chain: apeChain, address: DROID_CONTRACT });
            const balance = await balanceOf({ contract: droidContract, owner: wallet });
            droidCount = Number(balance);
            if (droidCount <= 0) {
                return NextResponse.json({ error: 'Holders only — you need at least 1 Droid' }, { status: 403 });
            }
        } catch (err) {
            console.error('❌ [Daily] On-chain check failed:', err);
            return NextResponse.json({ error: 'Failed to verify holdings' }, { status: 500 });
        }
        // 1 base ticket + 1 extra per full 30 droids above the first
        const ticketsToGrant = 1 + Math.floor((droidCount - 1) / 30);

        // ── 2. Active task config ──────────────────────────────────────────
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

        // ── 3. Pre-check (this wallet) — duplicate against UNIQUE constraint
        //      below would also catch it, but a friendly response is nicer.
        //      Reads/writes target the S2-only table; pre-S2 X-task history
        //      lives in `daily_claims_log` and is intentionally invisible
        //      here so a returning S1 player can claim S2 tasks fresh.
        const { data: existingClaim } = await supabaseAdmin
            .from('daily_claims_log_s2')
            .select('id')
            .ilike('wallet_address', wallet)
            .eq('task_config_id', taskConfig.id)
            .maybeSingle();
        if (existingClaim) {
            return NextResponse.json({ error: 'Already claimed this task' }, { status: 429 });
        }

        // ── 3b. Anti-multi-wallet abuse via X handle ────────────────────────
        if (cleanedXHandle) {
            const { data: xClaim } = await supabaseAdmin
                .from('daily_claims_log_s2')
                .select('id')
                .ilike('x_handle', cleanedXHandle)
                .eq('task_config_id', taskConfig.id)
                .maybeSingle();
            if (xClaim) {
                return NextResponse.json({
                    error: `Daily quest already claimed on account ${cleanedXHandle}. Each X account can only claim once per quest.`,
                }, { status: 429 });
            }
        }

        // ── 4. Insert claim row FIRST (UNIQUE constraint serialises concurrent reqs).
        const { error: logErr } = await supabaseAdmin
            .from('daily_claims_log_s2')
            .insert({
                wallet_address: wallet,
                task_config_id: taskConfig.id,
                proof_link: proofLink.trim(),
                x_handle: cleanedXHandle,
            });

        if (logErr) {
            const code = (logErr as any).code;
            if (code === '23505') {
                return NextResponse.json({ error: 'Already claimed' }, { status: 429 });
            }
            console.error('❌ [Daily] Claim log error:', logErr.message);
            return NextResponse.json({ error: 'Failed to log claim' }, { status: 500 });
        }

        // ── 5. Atomic ticket credit via RPC ────────────────────────────────
        const { data: newBalanceData, error: creditErr } = await supabaseAdmin
            .rpc('add_glitch_user_tickets', { p_wallet: wallet, p_amount: ticketsToGrant });

        if (creditErr) {
            console.error('❌ [Daily] add_glitch_user_tickets failed:', creditErr.message);
            return NextResponse.json({ error: 'Claim logged but ticket credit failed. Contact support.' }, { status: 500 });
        }
        const newBalance = Number(newBalanceData ?? 0);

        // ── 6. Save x_handle if missing (only fills if currently null) ─────
        if (cleanedXHandle) {
            await supabaseAdmin
                .rpc('set_glitch_user_x_handle', { p_wallet: wallet, p_handle: cleanedXHandle })
                .then(({ error }: { error: any }) => {
                    if (error) console.warn('[Daily] set_glitch_user_x_handle:', error.message);
                });
        }

        // ── 7. XP — atomic, no read-then-write ─────────────────────────────
        // XP scales with the number of tickets the holder is entitled to:
        // 1 ticket ⇒ 100 XP, 2 tickets ⇒ 200 XP, … (matches `ticketsToGrant`
        // computed from the on-chain droid count above).
        const xpGained = 100 * ticketsToGrant;
        try {
            await supabaseAdmin.rpc('increment_user_xp', { p_wallet: wallet, p_xp: xpGained });

            // Season 1 — keep existing best-effort upsert.
            const { data: s1User } = await supabaseAdmin
                .from('glitch_season_1')
                .select('season_xp, quests_finished')
                .ilike('wallet_address', wallet)
                .maybeSingle();
            await supabaseAdmin
                .from('glitch_season_1')
                .upsert({
                    wallet_address: wallet,
                    season_xp: (s1User?.season_xp || 0) + xpGained,
                    quests_finished: (s1User?.quests_finished || 0) + 1,
                }, { onConflict: 'wallet_address' });

            // Season 2 — atomic.
            await supabaseAdmin.rpc('increment_season2_xp', { p_wallet: wallet, p_xp: xpGained });
        } catch (e: any) {
            console.error('❌ [Daily] XP grant error:', e.message);
        }

        console.log(`✅ [Daily] ${wallet.slice(0, 8)}... claimed +${ticketsToGrant} tickets (${droidCount} droids, balance: ${newBalance})`);

        return NextResponse.json({
            success: true,
            message: `+${ticketsToGrant} Ticket${ticketsToGrant !== 1 ? 's' : ''} granted!`,
            newBalance,
            ticketsGranted: ticketsToGrant,
        });
    } catch (err: any) {
        console.error('🔥 [Daily] Critical:', err.message);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
