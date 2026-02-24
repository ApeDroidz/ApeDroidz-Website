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

export async function POST(req: Request) {
    const body = await req.json();
    const wallet: string = body.wallet;

    if (body.action === 'warmup') {
        return NextResponse.json({ status: 'warmed_up' });
    }

    if (!wallet) {
        return NextResponse.json({ error: 'Wallet required' }, { status: 400 });
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
    let logNote = '';
    let prizeAmountOrId: string | null = null;
    let inventoryItem: any = null;

    try {
        // ── 1. DEDUCT BALANCE ──
        const { data: deductRes, error: deductErr } = await supabaseAdmin
            .rpc('deduct_glitch_game_balance', { p_wallet_address: wallet });

        if (deductErr || !deductRes?.success) {
            const errReason = deductErr?.message || deductRes?.error;
            await writeErrorLog(`Deduct failed: ${errReason}`);
            return NextResponse.json({ error: errReason }, { status: 400 });
        }
        const user = deductRes.data;

        // ── 2. RNG ──
        const { data: prizeTypes, error: ptErr } = await supabaseAdmin
            .from('prize_types')
            .select('*')
            .eq('is_active', true)
            .order('drop_chance', { ascending: false });

        if (ptErr || !prizeTypes?.length) throw new Error('No prizes configured');

        const totalWeight = prizeTypes.reduce((s: number, p: any) => s + Number(p.drop_chance), 0);
        const roll = Math.random() * totalWeight;
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
                // Теперь мы четко увидим в консоли, если база упадет с SQL-ошибкой
                console.warn(`⚠️ [Play] DB Error or Stockout for ${finalPrize.id}. Reason:`, reserveErr?.message || reserveRes?.error);

                // Fallback logic
                const fallback = prizeTypes.find((p: any) => p.id === 'shard_x5') || prizeTypes.find((p: any) => p.type === 'shard');
                if (fallback) finalPrize = fallback;
            } else {
                inventoryItem = reserveRes.data;
            }
        }

        // ── 4. XP & LEADERBOARD ──
        xpGained = finalPrize.xp_reward || 0;
        if (xpGained > 0) {
            await supabaseAdmin.from('users').update({ xp: (user.xp || 0) + xpGained }).ilike('wallet_address', wallet);

            const { data: s1User } = await supabaseAdmin.from('glitch_season_1').select('season_xp, games_played').eq('wallet_address', wallet).maybeSingle();
            await supabaseAdmin.from('glitch_season_1').upsert({
                wallet_address: wallet,
                season_xp: (s1User?.season_xp || 0) + xpGained,
                games_played: (s1User?.games_played || 0) + 1
            }, { onConflict: 'wallet_address' });
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
                tx = erc721Transfer({ contract, from: vaultAccount.address, to: wallet, tokenId: BigInt(inventoryItem.token_id) });
                nftTokenId = inventoryItem.token_id;
                prizeAmountOrId = nftTokenId;
            }
            else {
                throw new Error('NFT Prize selected but no inventory item available.');
            }

            // Отправка транзакции
            const receipt = await sendTransaction({ transaction: tx, account: vaultAccount });
            txHash = receipt.transactionHash;
            logStatus = 'success';

            // Подтверждение в базе
            if (inventoryItem) {
                await supabaseAdmin.from('nft_inventory').update({ status: 'claimed', tx_hash: txHash, won_at: new Date().toISOString() }).eq('id', inventoryItem.id);
            }
            if (finalPrize.type === 'shard') {
                await supabaseAdmin.from('users').update({ shards_balance: (user.shards_balance || 0) + shardsGained }).ilike('wallet_address', wallet);
            }

        } catch (transferErr: any) {
            // Спасительный откат! Возвращаем предмет на склад, если блокчейн упал
            if (inventoryItem) {
                console.log(`⚠️ [Play] Transfer failed, rolling back NFT #${inventoryItem.token_id} to available`);
                await supabaseAdmin.from('nft_inventory').update({ status: 'available', winner_wallet: null }).eq('id', inventoryItem.id);
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

        // ── 7. FRONTEND RESPONSE ──
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