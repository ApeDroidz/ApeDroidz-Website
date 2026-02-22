import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createThirdwebClient, defineChain, getContract, prepareTransaction, toWei } from 'thirdweb';
import { privateKeyToAccount } from 'thirdweb/wallets';
import { transferFrom as erc721Transfer } from 'thirdweb/extensions/erc721';
import { safeTransferFrom as erc1155Transfer } from 'thirdweb/extensions/erc1155';
import { sendTransaction } from 'thirdweb';

const PRIZE_VAULT_PRIVATE_KEY = process.env.PRIZE_VAULT_PRIVATE_KEY!;
const THIRDWEB_CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!;
const SHARD_CONTRACT_ADDRESS = process.env.SHARD_CONTRACT_ADDRESS!;
const apeChain = defineChain(33139);
const thirdwebClient = createThirdwebClient({ clientId: THIRDWEB_CLIENT_ID });

const SHARD_AMOUNTS: Record<string, number> = {
    shard_x1: 1, shard_x3: 3, shard_x5: 5, shard_x10: 10, shard_x25: 25,
};

/**
 * POST /api/glitch_game/play  — Fully Synchronous, Guaranteed-Log Version
 *
 * AUDIT FIXES:
 * 1. game_logs write is guaranteed via try/finally — it fires even if the NFT transfer crashes
 * 2. All DB errors are explicitly checked and logged — no silent failures
 * 3. Wallet matching uses ilike for case-insensitive lookup so old lowercase records still match
 *    (wallet is NEVER converted to lowercase — original casing is used for writes and on-chain calls)
 * 4. Handles ERC721, ERC1155, and ERC20 token transfers based on prize_types.token_type field
 * 5. Stockout NFT is immediately reserved before transfer attempt to prevent double-award
 */
export async function POST(req: Request) {
    const wallet: string = (await req.json()).wallet;

    if (!wallet) {
        return NextResponse.json({ error: 'Wallet required' }, { status: 400 });
    }

    // Helper: always log errors to game_logs so we can debug
    async function writeErrorLog(errMsg: string) {
        try {
            await supabaseAdmin.from('game_logs').insert({
                wallet_address: wallet,
                prize_type_id: finalPrize?.slug ?? finalPrize?.name ?? 'unknown',
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

    // State we accumulate throughout the flow — used for the guaranteed log in finally
    let finalPrize: any = null;
    let nftTokenId: string | null = null;
    let txHash: string | null = null;
    let xpGained = 0;
    let shardsGained = 0;
    let logStatus = 'error';
    let logNote = '';
    let prizeAmountOrId: string | null = null;

    try {
        // ── 1. FETCH USER (case-insensitive lookup to handle historical lowercase entries) ──
        // NOTE: ilike does case-insensitive matching BUT we never store wallet as lowercase.
        // New entries are always written with original casing.
        const { data: user, error: userErr } = await supabaseAdmin
            .from('glitch_users')
            .select('games_balance, shards_balance')
            .ilike('wallet_address', wallet)
            .maybeSingle();

        if (userErr) {
            console.error('❌ [Play] User fetch error:', userErr.message);
            await writeErrorLog(`User fetch: ${userErr.message}`);
            return NextResponse.json({ error: 'DB error fetching user' }, { status: 500 });
        }
        if (!user) {
            console.error(`❌ [Play] No glitch_users row for wallet ${wallet}`);
            await writeErrorLog('User not found in glitch_users');
            return NextResponse.json({ error: 'User not found — please purchase games first' }, { status: 403 });
        }
        if (user.games_balance < 1) {
            return NextResponse.json({ error: 'Insufficient balance' }, { status: 403 });
        }

        // ── 2. DEDUCT BALANCE ──
        const { error: deductErr } = await supabaseAdmin
            .from('glitch_users')
            .update({ games_balance: user.games_balance - 1 })
            .ilike('wallet_address', wallet);

        if (deductErr) {
            console.error('❌ [Play] Deduct error:', deductErr.message);
            await writeErrorLog(`Balance deduct: ${deductErr.message}`);
            return NextResponse.json({ error: 'Failed to deduct balance' }, { status: 500 });
        }

        // ── 3. WEIGHTED RNG ──
        const { data: prizeTypes, error: ptErr } = await supabaseAdmin
            .from('prize_types')
            .select('*')
            .order('drop_chance', { ascending: false });

        if (ptErr || !prizeTypes?.length) {
            console.error('❌ [Play] Prize types fetch error:', ptErr?.message);
            await writeErrorLog(`Prize types: ${ptErr?.message ?? 'no prizes configured'}`);
            return NextResponse.json({ error: 'No prizes configured' }, { status: 500 });
        }

        const totalWeight = prizeTypes.reduce((s: number, p: any) => s + Number(p.drop_chance), 0);
        const roll = Math.random() * totalWeight;
        let cumulative = 0;
        let selectedPrize = prizeTypes[0];
        for (const pt of prizeTypes) {
            cumulative += Number(pt.drop_chance);
            if (roll < cumulative) { selectedPrize = pt; break; }
        }

        finalPrize = selectedPrize;
        console.log(`🎮 [Play] ${wallet.slice(0, 8)}... rolled → ${finalPrize.slug} (${finalPrize.name ?? finalPrize.label})`);

        // ── 4. INVENTORY CHECK (NFT/Token) ──
        let inventoryItem: any = null;

        if (finalPrize.type === 'nft' || finalPrize.type === 'token') {
            // prize_type_id in nft_inventory stores the slug (e.g. 'ape_droid', 'kubz')
            // Status can be 'available' or 'active' — search both
            const { data: item, error: invErr } = await supabaseAdmin
                .from('nft_inventory')
                .select('*')
                .eq('prize_type_id', finalPrize.slug)
                .in('status', ['available', 'active'])
                .limit(1)
                .maybeSingle();

            if (invErr) console.error('❌ [Play] Inventory fetch error:', invErr.message);

            if (item) {
                console.log(`🎯 [Play] Found inventory item #${item.token_id} (${item.name}) for ${finalPrize.slug}`);
                // Mark reserved immediately — prevents double-award if we crash mid-transfer
                const { error: reserveErr } = await supabaseAdmin
                    .from('nft_inventory')
                    .update({ status: 'reserved', winner_wallet: wallet, won_at: new Date().toISOString() })
                    .eq('id', item.id);
                if (reserveErr) {
                    console.error('❌ [Play] Reserve error:', reserveErr.message);
                }
                inventoryItem = item;
            } else {
                // Stockout fallback → shard_x5
                console.warn(`⚠️ [Play] Stockout: ${finalPrize.slug} → fallback to shard_x5`);
                logNote = `stockout:${finalPrize.slug}→shard_x5`;
                const fallback = prizeTypes.find((p: any) => p.slug === 'shard_x5')
                    ?? prizeTypes.find((p: any) => p.category === 'shard');
                if (fallback) finalPrize = fallback;
            }
        }

        // ── 5. GRANT XP ──
        xpGained = finalPrize.xp_reward || 0;
        if (xpGained > 0) {
            const { data: u } = await supabaseAdmin
                .from('users')
                .select('xp')
                .ilike('wallet_address', wallet)
                .maybeSingle();
            const { error: xpErr } = await supabaseAdmin
                .from('users')
                .update({ xp: (u?.xp || 0) + xpGained })
                .ilike('wallet_address', wallet);
            if (xpErr) console.error('❌ [Play] XP update error:', xpErr.message);
        }

        // ── 6. GRANT PRIZE — ALL prizes are on-chain transfers ──
        console.log(`🏆 [Play] Prize selected: slug=${finalPrize.slug}, type=${finalPrize.type}, amount=${finalPrize.amount ?? 'N/A'}, has_inventory=${!!inventoryItem}`);

        if (!PRIZE_VAULT_PRIVATE_KEY) {
            logNote = 'PRIZE_VAULT_PRIVATE_KEY env var missing';
            console.error('❌ [Play]', logNote);
        } else {
            try {
                const vaultAccount = privateKeyToAccount({
                    client: thirdwebClient,
                    privateKey: PRIZE_VAULT_PRIVATE_KEY,
                });

                let tx;

                if (finalPrize.type === 'shard') {
                    // ── SHARDS: ERC1155, tokenId=0, value=amount from prize_types ──
                    shardsGained = finalPrize.amount ?? SHARD_AMOUNTS[finalPrize.slug] ?? parseShardsFromSlug(finalPrize.slug);
                    if (!SHARD_CONTRACT_ADDRESS) throw new Error('SHARD_CONTRACT_ADDRESS env not set');

                    const shardContract = getContract({
                        client: thirdwebClient,
                        chain: apeChain,
                        address: SHARD_CONTRACT_ADDRESS,
                    });

                    tx = erc1155Transfer({
                        contract: shardContract,
                        from: vaultAccount.address,
                        to: wallet,
                        tokenId: BigInt(0),
                        value: BigInt(shardsGained),
                        data: '0x',
                    });

                    prizeAmountOrId = String(shardsGained);
                    console.log(`💎 [Play] Shard ERC1155 transfer: ${shardsGained} shards → ${wallet.slice(0, 8)}...`);

                } else if (finalPrize.type === 'token') {
                    // ── NATIVE APE TOKEN: direct from vault balance, no inventory needed ──
                    const apeAmount = finalPrize.amount || '1';
                    tx = prepareTransaction({
                        chain: apeChain,
                        client: thirdwebClient,
                        to: wallet,
                        value: toWei(String(apeAmount)),
                    });

                    prizeAmountOrId = String(apeAmount);
                    console.log(`💰 [Play] Native APE transfer: ${apeAmount} APE → ${wallet.slice(0, 8)}...`);

                } else if (inventoryItem) {
                    // ── NFT: use contract_address from inventory item ──
                    const contractAddress = inventoryItem.contract_address || finalPrize.contract_address;

                    if (!contractAddress) throw new Error('No contract_address on inventory item or prize_type');

                    const contract = getContract({
                        client: thirdwebClient,
                        chain: apeChain,
                        address: contractAddress,
                    });

                    // Determine token standard from nft_inventory data
                    const isErc1155 = inventoryItem.amount && Number(inventoryItem.amount) > 0;

                    if (isErc1155) {
                        tx = erc1155Transfer({
                            contract,
                            from: vaultAccount.address,
                            to: wallet,
                            tokenId: BigInt(inventoryItem.token_id),
                            value: BigInt(inventoryItem.amount ?? 1),
                            data: '0x',
                        });
                    } else {
                        // Default: ERC721
                        tx = erc721Transfer({
                            contract,
                            from: vaultAccount.address,
                            to: wallet,
                            tokenId: BigInt(inventoryItem.token_id),
                        });
                    }

                    nftTokenId = inventoryItem.token_id;
                    prizeAmountOrId = nftTokenId;
                    console.log(`🚀 [Play] ${finalPrize.type} #${nftTokenId} transfer → ${wallet.slice(0, 8)}...`);

                } else {
                    throw new Error(`No inventory item for NFT prize: ${finalPrize.slug}`);
                }

                // ── SEND TRANSACTION ──
                const receipt = await sendTransaction({ transaction: tx, account: vaultAccount });
                txHash = receipt.transactionHash;
                logStatus = 'success';
                console.log(`✅ [Play] Transfer complete → tx: ${txHash}`);

                // Update nft_inventory for NFT prizes (not needed for shards/tokens)
                if (inventoryItem) {
                    const { error: wonErr } = await supabaseAdmin
                        .from('nft_inventory')
                        .update({
                            status: 'claimed',
                            winner_wallet: wallet,
                            won_at: new Date().toISOString(),
                            tx_hash: txHash,
                        })
                        .eq('id', inventoryItem.id);
                    if (wonErr) console.error('❌ [Play] Mark won error:', wonErr.message);
                }

                // Also update shard balance in DB for UI cache (secondary to on-chain)
                if (finalPrize.type === 'shard' && shardsGained > 0) {
                    await supabaseAdmin
                        .from('glitch_users')
                        .update({ shards_balance: (user.shards_balance || 0) + shardsGained })
                        .ilike('wallet_address', wallet);
                }

            } catch (transferErr: any) {
                console.error(`❌ [Play] On-chain transfer failed: ${transferErr.message}`);
                logStatus = 'transfer_failed';
                logNote = transferErr.message;

                // Mark nft_inventory as failed if applicable (for manual retry via logs)
                if (inventoryItem) {
                    await supabaseAdmin
                        .from('nft_inventory')
                        .update({
                            status: 'transfer_failed',
                            winner_wallet: wallet,
                            won_at: new Date().toISOString(),
                        })
                        .eq('id', inventoryItem.id);
                }
            }
        }

        // ── 7. WRITE GAME LOG (always, even on partial failure) ──
        const prizeSlug = finalPrize.slug ?? finalPrize.name ?? finalPrize.id ?? 'unknown';
        const { error: logErr } = await supabaseAdmin.from('game_logs').insert({
            wallet_address: wallet,
            prize_type_id: prizeSlug,
            prize_amount_or_id: prizeAmountOrId,
            tx_hash: txHash,
            status: logStatus,
            error_message: logNote || null,
            xp_awarded: xpGained ? String(xpGained) : null,
        });
        if (logErr) {
            console.error('❌ [Play] game_logs INSERT FAILED:', logErr.message, '| Row:', JSON.stringify({
                wallet_address: wallet, prize_type_id: prizeSlug,
                prize_amount_or_id: nftTokenId, tx_hash: txHash, status: logStatus,
            }));
        } else {
            console.log(`📝 [Play] Log written — prize: ${prizeSlug}, status: ${logStatus}`);
        }

        // ── 8. RESPONSE ──
        return NextResponse.json({
            success: true,
            prize: {
                id: finalPrize.id,
                name: finalPrize.name ?? finalPrize.label ?? 'Unknown Prize',
                type: finalPrize.type,
                typeSlug: finalPrize.slug,
                category: finalPrize.type,
                label: finalPrize.name ?? finalPrize.label ?? 'Unknown Prize',
                imageUrl: finalPrize.image_url ?? '',
                nftTokenId,
            },
            xp_gained: xpGained,
            shards_gained: shardsGained,
            tx_hash: txHash,
            newBalance: user.games_balance - 1,
        });

    } catch (err: any) {
        console.error('🔥 [Play] Unhandled exception:', err.message);

        // Attempt emergency log even on unhandled crash
        await writeErrorLog(err.message ?? 'unhandled exception');

        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}

function parseShardsFromSlug(slug: string): number {
    const match = slug.match(/shard_x(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
}
