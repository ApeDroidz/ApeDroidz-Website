import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createThirdwebClient, defineChain, getContract } from 'thirdweb';
import { privateKeyToAccount } from 'thirdweb/wallets';
import { transferFrom } from 'thirdweb/extensions/erc721';
import { sendTransaction } from 'thirdweb';

const PRIZE_VAULT_PRIVATE_KEY = process.env.PRIZE_VAULT_PRIVATE_KEY!;
const THIRDWEB_CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!;
const apeChain = defineChain(33139);
const thirdwebClient = createThirdwebClient({ clientId: THIRDWEB_CLIENT_ID });

// Shard quantities by slug
const SHARD_AMOUNTS: Record<string, number> = {
    shard_x1: 1,
    shard_x3: 3,
    shard_x5: 5,
    shard_x10: 10,
    shard_x25: 25,
};

/**
 * POST /api/games/play
 *
 * "Double Reward" system:
 * - Every prize grants BOTH the item AND bonus XP (prize_types.xp_reward).
 * - Categories: 'nft' (on-chain transfer), 'shard' (shards_balance), 'token' (on-chain transfer).
 * - Stockout fallback: if selected NFT has no inventory → auto-switch to shard_x5.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const wallet = body.wallet?.toLowerCase();
        if (!wallet) return NextResponse.json({ error: 'Wallet required' }, { status: 400 });

        // ── 1. CHECK & DEDUCT BALANCE ──
        const { data: user, error: userErr } = await supabaseAdmin
            .from('glitch_users')
            .select('games_balance, shards_balance')
            .eq('wallet_address', wallet)
            .maybeSingle();

        if (userErr) {
            console.error('❌ [Play] User fetch:', userErr.message);
            return NextResponse.json({ error: 'DB error' }, { status: 500 });
        }
        if (!user || user.games_balance < 1) {
            return NextResponse.json({ error: 'Insufficient balance' }, { status: 403 });
        }

        const { error: deductErr } = await supabaseAdmin
            .from('glitch_users')
            .update({ games_balance: user.games_balance - 1 })
            .eq('wallet_address', wallet);

        if (deductErr) {
            console.error('❌ [Play] Deduct:', deductErr.message);
            return NextResponse.json({ error: 'Failed to deduct balance' }, { status: 500 });
        }

        // ── 2. WEIGHTED RNG ──
        const { data: prizeTypes, error: ptErr } = await supabaseAdmin
            .from('prize_types')
            .select('*')
            .order('drop_chance', { ascending: false });

        if (ptErr || !prizeTypes?.length) {
            console.error('❌ [Play] Prize types:', ptErr?.message);
            return NextResponse.json({ error: 'No prizes configured' }, { status: 500 });
        }

        const totalWeight = prizeTypes.reduce((sum: number, p: any) => sum + Number(p.drop_chance), 0);
        const roll = Math.random() * totalWeight;
        let cumulative = 0;
        let selectedPrize = prizeTypes[0];
        for (const pt of prizeTypes) {
            cumulative += Number(pt.drop_chance);
            if (roll < cumulative) {
                selectedPrize = pt;
                break;
            }
        }

        console.log(`🎮 [Play] ${wallet.slice(0, 8)}... rolled → ${selectedPrize.slug} (${selectedPrize.name})`);

        // ── 3. INVENTORY / STOCKOUT CHECK (NFT/Token) ──
        let finalPrize = selectedPrize;
        let inventoryItem: any = null;

        if (finalPrize.category === 'nft' || finalPrize.category === 'token') {
            const { data: item } = await supabaseAdmin
                .from('nft_inventory')
                .select('*')
                .eq('prize_type_id', finalPrize.id)
                .eq('status', 'available')
                .limit(1)
                .maybeSingle();

            if (item) {
                inventoryItem = item;
            } else {
                // ── STOCKOUT FALLBACK → shard_x5 ──
                console.warn(`⚠️ [Play] Stockout on ${finalPrize.slug} → fallback to shard_x5`);
                const fallback = prizeTypes.find((p: any) => p.slug === 'shard_x5');
                if (fallback) {
                    finalPrize = fallback;
                } else {
                    // Ultimate fallback: first shard prize found
                    const anyShard = prizeTypes.find((p: any) => p.category === 'shard');
                    if (anyShard) finalPrize = anyShard;
                }
            }
        }

        // ── 4. EXECUTE REWARDS ("Double Win") ──
        const xpGained = finalPrize.xp_reward || 0;
        let shardsGained = 0;
        let nftTokenId: string | null = null;
        let txHash: string | null = null;

        // a) ALWAYS grant XP
        if (xpGained > 0) {
            const currentXp = await getUserXP(wallet);
            await supabaseAdmin
                .from('users')
                .update({ xp: currentXp + xpGained })
                .eq('wallet_address', wallet);
        }

        // b) Category-specific reward
        if (finalPrize.category === 'shard') {
            shardsGained = SHARD_AMOUNTS[finalPrize.slug] || parseShardsFromSlug(finalPrize.slug);
            if (shardsGained > 0) {
                await supabaseAdmin
                    .from('glitch_users')
                    .update({ shards_balance: (user.shards_balance || 0) + shardsGained })
                    .eq('wallet_address', wallet);
            }
        } else if ((finalPrize.category === 'nft' || finalPrize.category === 'token') && inventoryItem) {
            // On-chain NFT/Token transfer
            try {
                const contractAddress = finalPrize.contract_address;
                if (!contractAddress || !PRIZE_VAULT_PRIVATE_KEY) {
                    throw new Error('Missing vault config');
                }

                const vaultAccount = privateKeyToAccount({
                    client: thirdwebClient,
                    privateKey: PRIZE_VAULT_PRIVATE_KEY,
                });

                const nftContract = getContract({
                    client: thirdwebClient,
                    chain: apeChain,
                    address: contractAddress,
                });

                const tx = transferFrom({
                    contract: nftContract,
                    from: vaultAccount.address,
                    to: wallet,
                    tokenId: BigInt(inventoryItem.token_id),
                });

                const receipt = await sendTransaction({ transaction: tx, account: vaultAccount });
                txHash = receipt.transactionHash;

                // Mark inventory as won
                await supabaseAdmin
                    .from('nft_inventory')
                    .update({ status: 'won', won_by: wallet, won_at: new Date().toISOString() })
                    .eq('id', inventoryItem.id);

                nftTokenId = inventoryItem.token_id;
                console.log(`✅ [Play] NFT #${nftTokenId} transferred (tx: ${txHash})`);
            } catch (nftErr: any) {
                // Transfer failed → award shard fallback
                console.error(`❌ [Play] NFT transfer failed: ${nftErr.message}. Fallback to shards.`);
                shardsGained = 5;
                await supabaseAdmin
                    .from('glitch_users')
                    .update({ shards_balance: (user.shards_balance || 0) + shardsGained })
                    .eq('wallet_address', wallet);
            }
        }

        // ── 5. LOG ──
        await supabaseAdmin.from('game_logs').insert({
            wallet_address: wallet,
            prize_type_id: finalPrize.id,
            prize_label: finalPrize.name || finalPrize.label || 'Unknown',
            nft_token_id: nftTokenId,
            xp_awarded: xpGained,
        });

        // ── 6. RESPONSE ──
        return NextResponse.json({
            success: true,
            prize: {
                typeSlug: finalPrize.slug,
                category: finalPrize.category,
                label: finalPrize.name || finalPrize.label || 'Unknown Prize',
                imageUrl: finalPrize.image_url || '',
                nftTokenId,
            },
            xp_gained: xpGained,
            shards_gained: shardsGained,
            tx_hash: txHash,
            newBalance: user.games_balance - 1,
        });
    } catch (err: any) {
        console.error('🔥 [Play] Critical:', err.message);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}

// ── HELPERS ──

async function getUserXP(wallet: string): Promise<number> {
    const { data } = await supabaseAdmin
        .from('users')
        .select('xp')
        .eq('wallet_address', wallet)
        .maybeSingle();
    return data?.xp || 0;
}

function parseShardsFromSlug(slug: string): number {
    // Parse "shard_x5" → 5, "shard_x10" → 10, etc.
    const match = slug.match(/shard_x(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
}
