import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getContract, prepareTransaction, toWei } from 'thirdweb';
import { apeChainServer, createServerThirdwebClient } from '@/lib/apechain';
import { detectTokenStandard } from '@/lib/tokenStandard';
import { privateKeyToAccount } from 'thirdweb/wallets';
import { transferFrom as erc721Transfer } from 'thirdweb/extensions/erc721';
import { safeTransferFrom as erc1155Transfer } from 'thirdweb/extensions/erc1155';
import { sendTransactionWithRetry } from '@/lib/sendWithRetry';
import { requireWalletAuth, isValidWallet } from '@/lib/walletAuth';

const PRIZE_VAULT_PRIVATE_KEY = process.env.PRIZE_VAULT_PRIVATE_KEY!;
const SHARD_CONTRACT_ADDRESS = process.env.SHARD_CONTRACT_ADDRESS!;
const apeChain = apeChainServer;
const thirdwebClient = createServerThirdwebClient();

const SHARD_AMOUNTS: Record<string, number> = {
    shard_x1: 1, shard_x3: 3, shard_x5: 5, shard_x10: 10, shard_x25: 25,
};

/**
 * Cryptographically secure roll in [0, max). Uses crypto.randomBytes — NOT
 * Math.random — because this directly determines NFT/APE prize selection.
 */
function secureRoll(max: number): number {
    if (!Number.isFinite(max) || max <= 0) return 0;
    // 32 bits of entropy is plenty for our weight scale (0…< ~few thousand).
    const u32 = randomBytes(4).readUInt32BE(0);
    return (u32 / 0x100000000) * max;
}

export async function POST(req: Request) {
    let body: any;
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    // Warmup ping does not need auth — it's cold-start mitigation only and
    // performs no DB writes.
    if (body?.action === 'warmup') {
        return NextResponse.json({ status: 'warmed_up' });
    }

    // ── Authentication: wallet comes from session cookie, NEVER from body ──
    const auth = requireWalletAuth(req);
    if (auth instanceof Response) return auth;
    const wallet = auth.wallet; // lowercase, validated

    // Defensive: optional body wallet must match session.
    if (typeof body?.wallet === 'string' && body.wallet.length > 0) {
        if (!isValidWallet(body.wallet) || body.wallet.toLowerCase() !== wallet) {
            return NextResponse.json({ error: 'Wallet mismatch — please re-authenticate' }, { status: 403 });
        }
    }

    async function writeErrorLog(errMsg: string) {
        try {
            await supabaseAdmin.from('game_logs').insert({
                wallet_address: wallet,
                prize_type_id: finalPrize?.id ?? 'unknown',
                prize_amount_or_id: prizeAmountOrId,
                tx_hash: txHash,
                status: 'error',
                error_message: errMsg.slice(0, 500),
                xp_awarded: xpGained ? String(xpGained) : null,
            });
        } catch (e: any) {
            console.error('❌ [Play] Error log write also failed:', e.message);
        }
    }

    let finalPrize: any = null;
    let nftTokenId: string | null = null;
    let txHash: string | null = null;
    let xpGained = 0;
    let shardsGained = 0;
    let logStatus = 'error';
    let prizeAmountOrId: string | null = null;
    let inventoryItem: any = null;

    try {
        // ── 1. DEDUCT BALANCE (atomic via SQL RPC) ──
        const { data: deductRes, error: deductErr } = await supabaseAdmin
            .rpc('deduct_glitch_game_balance', { p_wallet_address: wallet });

        if (deductErr || !deductRes?.success) {
            const errReason = deductErr?.message || deductRes?.error;
            await writeErrorLog(`Deduct failed: ${errReason}`);
            return NextResponse.json({ error: errReason }, { status: 400 });
        }
        const user = deductRes.data;

        // ── 2. RNG (cryptographic) ──
        const { data: prizeTypes, error: ptErr } = await supabaseAdmin
            .from('prize_types')
            .select('*')
            .eq('is_active', true)
            .order('drop_chance', { ascending: false });

        if (ptErr || !prizeTypes?.length) throw new Error('No prizes configured');

        const totalWeight = prizeTypes.reduce((s: number, p: any) => s + Number(p.drop_chance), 0);
        const roll = secureRoll(totalWeight);
        let cumulative = 0;
        let selectedPrize = prizeTypes[0];
        for (const pt of prizeTypes) {
            cumulative += Number(pt.drop_chance);
            if (roll < cumulative) { selectedPrize = pt; break; }
        }
        finalPrize = selectedPrize;

        // ── 3. INVENTORY CHECK (NFT ONLY) ──
        if (finalPrize.type === 'nft') {
            const { data: reserveRes, error: reserveErr } = await supabaseAdmin
                .rpc('reserve_inventory_item', {
                    p_prize_type_id: finalPrize.id,
                    p_wallet_address: wallet
                });

            if (reserveErr || !reserveRes?.success) {
                console.warn(`⚠️ [Play] DB Error or Stockout for ${finalPrize.id}. Reason:`, reserveErr?.message || reserveRes?.error);
                const fallback = prizeTypes.find((p: any) => p.id === 'shard_x5') || prizeTypes.find((p: any) => p.type === 'shard');
                if (fallback) finalPrize = fallback;
            } else {
                inventoryItem = reserveRes.data;
            }
        }

        // ── 4. XP & LEADERBOARD (atomic via RPCs — no read-then-write) ──
        xpGained = finalPrize.xp_reward || 0;
        if (xpGained > 0) {
            // Atomic global XP increment (creates row if missing).
            // NOTE: Supabase's PostgrestBuilder is THENABLE but does NOT
            // implement .catch() — using `.rpc(...).catch(...)` directly
            // throws "catch is not a function". Use `{ error } = await …`
            // pattern instead.
            try {
                const { error } = await supabaseAdmin.rpc('increment_user_xp', { p_wallet: wallet, p_xp: xpGained });
                if (error) console.warn('[Play] increment_user_xp failed:', error.message);
            } catch (e: any) {
                console.warn('[Play] increment_user_xp threw:', e?.message);
            }

            // Season 1: still uses upsert because increment_season1_xp may not exist.
            // We accept a small race here because S1 is legacy / read-only-ish.
            try {
                const { data: s1User } = await supabaseAdmin
                    .from('glitch_season_1')
                    .select('season_xp, games_played')
                    .ilike('wallet_address', wallet)
                    .maybeSingle();
                await supabaseAdmin.from('glitch_season_1').upsert({
                    wallet_address: wallet,
                    season_xp: (s1User?.season_xp || 0) + xpGained,
                    games_played: (s1User?.games_played || 0) + 1,
                }, { onConflict: 'wallet_address' });
            } catch (e: any) {
                console.warn('[Play] season_1 upsert failed:', e?.message);
            }

            // Season 2 — atomic increment of XP + games_played counter via
            // the play-aware RPC. The legacy increment_season2_xp does NOT
            // touch games_played/flights_played, which is how the leaderboard
            // counters drifted; increment_season2_play handles both.
            try {
                const { error } = await supabaseAdmin.rpc('increment_season2_play', {
                    p_wallet: wallet, p_xp: xpGained, p_game_type: 'cards',
                });
                if (error) console.warn('[Play] increment_season2_play failed:', error.message);
            } catch (e: any) {
                console.warn('[Play] increment_season2_play threw:', e?.message);
            }
        }

        // ── 5. THIRDWEB BLOCKCHAIN TRANSFER ──
        if (!PRIZE_VAULT_PRIVATE_KEY) throw new Error('Vault PK missing');
        const vaultAccount = privateKeyToAccount({ client: thirdwebClient, privateKey: PRIZE_VAULT_PRIVATE_KEY });
        let tx;

        try {
            if (finalPrize.type === 'shard') {
                shardsGained = finalPrize.amount ?? SHARD_AMOUNTS[finalPrize.id] ?? 1;
                const shardContract = getContract({ client: thirdwebClient, chain: apeChain, address: SHARD_CONTRACT_ADDRESS });
                tx = erc1155Transfer({ contract: shardContract, from: vaultAccount.address, to: wallet, tokenId: BigInt(0), value: BigInt(shardsGained), data: '0x' });
                prizeAmountOrId = String(shardsGained);
            }
            else if (finalPrize.type === 'token') {
                const apeAmount = finalPrize.amount || '1';
                tx = prepareTransaction({ chain: apeChain, client: thirdwebClient, to: wallet, value: toWei(String(apeAmount)) });
                prizeAmountOrId = String(apeAmount);
            }
            else if (inventoryItem) {
                const contract = getContract({ client: thirdwebClient, chain: apeChain, address: inventoryItem.contract_address });
                // Honorary на ApeChain — ERC1155, остальные призовые контракты ERC721.
                // Без этой ветки транзакция отлетала с UnsupportedFunctionSelector.
                const standard = await detectTokenStandard({
                    client: thirdwebClient, chain: apeChain, address: inventoryItem.contract_address,
                });
                tx = standard === 'erc1155'
                    ? erc1155Transfer({
                        contract, from: vaultAccount.address, to: wallet,
                        tokenId: BigInt(inventoryItem.token_id), value: BigInt(1), data: '0x',
                    })
                    : erc721Transfer({
                        contract, from: vaultAccount.address, to: wallet,
                        tokenId: BigInt(inventoryItem.token_id),
                    });
                nftTokenId = inventoryItem.token_id;
                prizeAmountOrId = nftTokenId;
            }
            else {
                throw new Error('NFT Prize selected but no inventory item available.');
            }

            const receipt = await sendTransactionWithRetry({ transaction: tx, account: vaultAccount, label: 'GlitchGame' });
            txHash = receipt.transactionHash;
            logStatus = 'success';

            if (inventoryItem) {
                await supabaseAdmin.from('nft_inventory').update({ status: 'claimed', tx_hash: txHash, won_at: new Date().toISOString() }).eq('id', inventoryItem.id);
            }
            if (finalPrize.type === 'shard') {
                // Баланс шардов живёт в glitch_users (в users такой колонки нет —
                // прежний апдейт по users молча не проходил, и зеркало в базе
                // расходилось с ончейном).
                const { error: shardErr } = await supabaseAdmin
                    .from('glitch_users')
                    .update({ shards_balance: (user.shards_balance || 0) + shardsGained })
                    .ilike('wallet_address', wallet);
                if (shardErr) console.warn('[Play] shards_balance update failed:', shardErr.message);
            }

        } catch (transferErr: any) {
            if (inventoryItem) {
                console.log(`⚠️ [Play] Transfer failed, rolling back NFT #${inventoryItem.token_id} to available`);
                await supabaseAdmin.from('nft_inventory').update({ status: 'available', winner_wallet: null }).eq('id', inventoryItem.id);
            }
            // Билет списывается ещё до розыгрыша, поэтому при провале трансфера
            // его нужно вернуть — иначе игрок платит за спин и не получает ничего.
            const { error: refundErr } = await supabaseAdmin
                .rpc('add_glitch_user_tickets', { p_wallet: wallet, p_amount: 1 });
            if (refundErr) {
                console.error('❌ [Play] Ticket refund failed:', refundErr.message, { wallet });
            } else {
                console.log(`↩️ [Play] Transfer failed — ticket refunded to ${wallet}`);
            }
            throw new Error(`Blockchain Transfer Failed: ${transferErr.message}`);
        }

        // ── 6. GAME LOGS ──
        await supabaseAdmin.from('game_logs').insert({
            wallet_address: wallet,
            prize_type_id: finalPrize.id,
            prize_amount_or_id: prizeAmountOrId,
            tx_hash: txHash,
            status: logStatus,
            xp_awarded: xpGained ? String(xpGained) : null,
        });

        // ── 7. QUEST PROGRESS (fire-and-forget, non-blocking) ──
        supabaseAdmin.rpc('update_quest_progress', {
            p_wallet: wallet,
            p_game_type: 'cards',
            p_multiplier: 0,
        }).then(({ error }: { error: any }) => {
            if (error) console.warn('[QuestProgress] Cards update failed:', error.message)
        });

        supabaseAdmin.rpc('update_referral_progress', {
            p_invitee_wallet: wallet,
            p_game_type: 'cards',
            p_is_holder: false,
        }).then(({ error }: { error: any }) => {
            if (error) console.warn('[ReferralProgress] Cards update failed:', error.message)
        });

        return NextResponse.json({
            success: true,
            prize: {
                id: finalPrize.id,
                name: inventoryItem ? inventoryItem.name : (finalPrize.name ?? 'Unknown Prize'),
                type: finalPrize.type,
                imageUrl: inventoryItem ? inventoryItem.image_url : (finalPrize.image_url ?? ''),
                nftTokenId,
            },
            xp_gained: xpGained,
            shards_gained: shardsGained,
            tx_hash: txHash,
            newBalance: user.games_balance,
        });

    } catch (err: any) {
        console.error('🔥 [Play] Crash:', err.message);
        await writeErrorLog(err.message);
        return NextResponse.json({ error: 'Internal Server Error', details: err.message }, { status: 500 });
    }
}
