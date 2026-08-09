import { NextRequest, NextResponse } from "next/server";
import { createThirdwebClient, getContract } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import { transferFrom } from "thirdweb/extensions/erc721";
import { safeTransferFrom as erc1155SafeTransfer } from "thirdweb/extensions/erc1155";
import { sendTransactionWithRetry } from '@/lib/sendWithRetry';
import { eth_getTransactionReceipt, getRpcClient } from "thirdweb/rpc";
import { supabaseAdmin } from "@/lib/supabase";
import { apeChainServer } from '@/lib/apechain'

const PRIZE_VAULT_PRIVATE_KEY = process.env.PRIZE_VAULT_PRIVATE_KEY!;
const STANDARD_BATTERY_PRIZE_TYPE_ID = 'std_battery';
// ERC1155 single-token contract — shards are id 0. Using BigInt() form
// because tsconfig targets ES2018, where the `0n` literal isn't legal.
const SHARD_TOKEN_ID = BigInt(0);

const client = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
    secretKey: process.env.THIRDWEB_SECRET_KEY,
});
const apeChain = apeChainServer;

async function logShardMerge(
    userWallet: string,
    txHash: string,
    upgradedTokenId: string,
    status: "success" | "failed" | "partial_refunded" | "refund_pending",
    errorMessage: string | null
) {
    try {
        await supabaseAdmin.from("merge_logs").insert({
            user_wallet: userWallet,
            tx_hash: txHash || "no_hash",
            sent_token_ids: [], // ERC1155 — no individual token IDs
            upgraded_token_id: upgradedTokenId || "unknown",
            status,
            error_message: errorMessage,
        });
    } catch (e) {
        console.error("[shard-merge] log failed:", e);
    }
}

/**
 * Send `count` shards back to `userWallet` from the admin/vault wallet.
 * Returns the refund tx hash on success, or a reason if it could not be
 * delivered automatically (in which case the caller MUST log
 * `refund_pending` so an operator can manually settle).
 *
 * Pre-condition: PRIZE_VAULT_PRIVATE_KEY must derive to the same wallet
 * the shards were originally sent to (ADMIN_WALLET_ADDRESS). Otherwise
 * we can't sign on its behalf and refund is impossible from this code.
 */
async function refundShardsOnChain(
    userWallet: string,
    refundCount: number,
): Promise<{ ok: true; refundTxHash: string } | { ok: false; reason: string }> {
    if (refundCount <= 0) return { ok: true, refundTxHash: '' };

    const SHARD_CONTRACT =
        process.env.SHARD_CONTRACT_ADDRESS ||
        process.env.NEXT_PUBLIC_SHARD_CONTRACT_ADDRESS;
    const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS;
    if (!SHARD_CONTRACT || !ADMIN_WALLET) {
        return { ok: false, reason: 'SHARD_CONTRACT_ADDRESS or ADMIN_WALLET_ADDRESS not configured' };
    }

    let adminAccount;
    try {
        adminAccount = privateKeyToAccount({ client, privateKey: PRIZE_VAULT_PRIVATE_KEY });
    } catch (e: any) {
        return { ok: false, reason: `bad PRIZE_VAULT_PRIVATE_KEY: ${e?.message ?? e}` };
    }
    if (adminAccount.address.toLowerCase() !== ADMIN_WALLET.toLowerCase()) {
        // Shards live on the admin wallet — if our signing key is a different
        // wallet (e.g. the prize vault), we cannot transfer them. Operator
        // must hand-refund using the admin key.
        return {
            ok: false,
            reason: `signing key derives to ${adminAccount.address}, but shards live on admin ${ADMIN_WALLET}. Operator refund required.`,
        };
    }

    try {
        const shardContract = getContract({ client, chain: apeChain, address: SHARD_CONTRACT });
        const tx = erc1155SafeTransfer({
            contract: shardContract,
            from: adminAccount.address,
            to: userWallet,
            tokenId: SHARD_TOKEN_ID,
            value: BigInt(refundCount),
            data: '0x',
        });
        const receipt = await sendTransactionWithRetry({ transaction: tx, account: adminAccount, label: 'ShardRefund' });
        return { ok: true, refundTxHash: receipt.transactionHash };
    } catch (e: any) {
        return { ok: false, reason: e?.message ?? 'refund tx failed' };
    }
}

export async function POST(req: NextRequest) {
    let userWallet = "unknown";
    let txHash = "";
    const SHARDS_PER_BATTERY = 30;

    try {
        const body = await req.json();
        txHash = body.txHash;
        userWallet = body.userWallet || "unknown";
        const shardCount: number = body.shardCount || SHARDS_PER_BATTERY;

        if (!txHash || !userWallet || userWallet === "unknown") {
            return NextResponse.json({ error: "txHash and userWallet required" }, { status: 400 });
        }

        // Validate shard count
        if (shardCount < SHARDS_PER_BATTERY || shardCount % SHARDS_PER_BATTERY !== 0) {
            return NextResponse.json({ error: `shardCount must be a multiple of ${SHARDS_PER_BATTERY}` }, { status: 400 });
        }

        const batteriesNeeded = shardCount / SHARDS_PER_BATTERY;
        console.log(`🔷 [Shard Merge] ${userWallet.slice(0, 8)}... sending ${shardCount} shards → ${batteriesNeeded} batteries`);

        // 1. Verify transaction on chain
        const rpc = getRpcClient({ client, chain: apeChain });
        const receipt = await eth_getTransactionReceipt(rpc, { hash: txHash as `0x${string}` });

        if (!receipt || receipt.status !== "success") {
            await logShardMerge(userWallet, txHash, "unknown", "failed", "Shard transaction failed on chain");
            return NextResponse.json({ error: "Transaction failed on chain" }, { status: 400 });
        }

        // 2. Verify the ERC1155 TransferSingle event to confirm exact shard amount
        // TransferSingle(address operator, address from, address to, uint256 id, uint256 value)
        const TRANSFER_SINGLE_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
        const ADMIN_WALLET_LOWER = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS!.toLowerCase();
        const SHARD_CONTRACT = process.env.SHARD_CONTRACT_ADDRESS?.toLowerCase() || process.env.NEXT_PUBLIC_SHARD_CONTRACT_ADDRESS?.toLowerCase();

        let verifiedShardAmount = 0;
        for (const log of (receipt.logs || [])) {
            if (
                log.address?.toLowerCase() === SHARD_CONTRACT &&
                log.topics?.[0] === TRANSFER_SINGLE_TOPIC
            ) {
                // Topics: [0]=event sig, [1]=operator, [2]=from, [3]=to
                // Data: id (uint256) + value (uint256)
                const toAddr = "0x" + (log.topics[3] as string).slice(26).toLowerCase();
                if (toAddr === ADMIN_WALLET_LOWER && log.data) {
                    // data = abi.encode(uint256 id, uint256 value)
                    const dataHex = log.data.startsWith("0x") ? log.data.slice(2) : log.data;
                    // value is the second 32 bytes
                    const valueHex = dataHex.slice(64, 128);
                    verifiedShardAmount += Number(BigInt("0x" + valueHex));
                }
            }
        }

        if (verifiedShardAmount < shardCount) {
            const errorMsg = `Expected ${shardCount} shards but only verified ${verifiedShardAmount} in tx logs`;
            console.error(`❌ [Shard Merge] ${errorMsg}`);
            await logShardMerge(userWallet, txHash, "unknown", "failed", errorMsg);
            return NextResponse.json({ error: errorMsg }, { status: 403 });
        }

        console.log(`✅ [Shard Merge] Verified ${verifiedShardAmount} shards transferred on-chain`);

        // 3. Fetch a generous pool of candidate batteries (more than needed, to handle stale entries)
        const fetchLimit = batteriesNeeded * 3 + 10; // fetch extra in case some are stale
        const { data: candidateBatteries, error: batteryErr } = await supabaseAdmin
            .from("nft_inventory")
            .select("id, token_id, contract_address, name, image_url")
            .eq("prize_type_id", STANDARD_BATTERY_PRIZE_TYPE_ID)
            .eq("status", "available")
            .order("token_id", { ascending: true })
            .limit(fetchLimit);

        if (batteryErr) throw new Error(`DB error finding batteries: ${batteryErr.message}`);

        if (!candidateBatteries || candidateBatteries.length < batteriesNeeded) {
            // Auto-refund all of the shards on-chain — the user already
            // transferred them but we have nothing to give back.
            const refund = await refundShardsOnChain(userWallet, shardCount);
            if (refund.ok) {
                const msg = `Not enough batteries in vault. Need ${batteriesNeeded}, available: ${candidateBatteries?.length || 0}. ${shardCount} shards refunded automatically (${refund.refundTxHash.slice(0, 12)}…).`;
                await logShardMerge(userWallet, txHash, "unknown", "partial_refunded", msg);
                return NextResponse.json({
                    error: 'Not enough batteries — your shards have been refunded.',
                    refunded: shardCount,
                    refundTxHash: refund.refundTxHash,
                }, { status: 200 });
            }
            const msg = `Not enough batteries in vault. Need ${batteriesNeeded}, available: ${candidateBatteries?.length || 0}. Auto-refund failed: ${refund.reason}. Operator must refund ${shardCount} shards manually.`;
            await logShardMerge(userWallet, txHash, "unknown", "refund_pending", msg);
            return NextResponse.json({
                error: 'Not enough batteries in vault. Your shards are held — please contact support, you will be refunded.',
                shardsHeld: shardCount,
                support_required: true,
            }, { status: 503 });
        }

        // 4. Transfer batteries from vault to user (skip any that fail due to stale ownership)
        const vaultAccount = privateKeyToAccount({ client, privateKey: PRIZE_VAULT_PRIVATE_KEY });
        const sentBatteries: Array<{ tokenId: string; name: string; imageUrl: string; txHash: string }> = [];

        for (const batteryItem of candidateBatteries) {
            if (sentBatteries.length >= batteriesNeeded) break;

            try {
                const batteryContract = getContract({ client, chain: apeChain, address: batteryItem.contract_address });

                const transferTx = transferFrom({
                    contract: batteryContract,
                    from: vaultAccount.address,
                    to: userWallet,
                    tokenId: BigInt(batteryItem.token_id),
                });

                const transferReceipt = await sendTransactionWithRetry({ transaction: transferTx, account: vaultAccount, label: 'ShardMerge' });

                // Mark battery as claimed
                await supabaseAdmin
                    .from("nft_inventory")
                    .update({ status: "claimed", winner_wallet: userWallet })
                    .eq("id", batteryItem.id);

                // Insert into `batteries` so /api/upgrade can resolve the type later.
                // Without this row, a future upgrade with this battery would burn
                // the NFT on-chain and then fail server-side — losing the battery.
                try {
                    await supabaseAdmin
                        .from('batteries')
                        .upsert(
                            { token_id: parseInt(batteryItem.token_id), type: 'Standard', is_burned: false },
                            { onConflict: 'token_id' }
                        );
                } catch (e: any) {
                    console.warn(`⚠️ [Shard Merge] batteries upsert for #${batteryItem.token_id} failed:`, e?.message);
                }

                sentBatteries.push({
                    tokenId: batteryItem.token_id,
                    name: batteryItem.name,
                    imageUrl: batteryItem.image_url,
                    txHash: transferReceipt.transactionHash,
                });

                console.log(`✅ [Shard Merge] Sent Battery #${batteryItem.token_id} to ${userWallet.slice(0, 8)}...`);
            } catch (transferErr: any) {
                // Battery likely not owned by vault anymore — mark as error and skip
                console.warn(`⚠️ [Shard Merge] Failed to transfer Battery #${batteryItem.token_id}: ${transferErr.message}. Skipping...`);
                await supabaseAdmin
                    .from("nft_inventory")
                    .update({ status: "error" })
                    .eq("id", batteryItem.id);
            }
        }

        // Partial fulfilment — auto-refund the shards we couldn't redeem.
        // Each missing battery == SHARDS_PER_BATTERY shards back to user.
        if (sentBatteries.length < batteriesNeeded) {
            const shortfall = batteriesNeeded - sentBatteries.length;
            const refundCount = shortfall * SHARDS_PER_BATTERY;
            const refund = await refundShardsOnChain(userWallet, refundCount);

            const sentTokenIds = sentBatteries.map(b => b.tokenId).join(", ");
            if (refund.ok) {
                const msg = `Sent ${sentBatteries.length}/${batteriesNeeded} batteries (${sentTokenIds}). Refunded ${refundCount} shards (${refund.refundTxHash.slice(0, 12)}…).`;
                await logShardMerge(userWallet, txHash, sentTokenIds, "partial_refunded", msg);
                // Deduct only the shards we actually consumed.
                const consumedShards = sentBatteries.length * SHARDS_PER_BATTERY;
                const { data: userRow } = await supabaseAdmin
                    .from("glitch_users").select("shards_balance")
                    .ilike("wallet_address", userWallet).single();
                if (userRow) {
                    await supabaseAdmin.from("glitch_users")
                        .update({ shards_balance: Math.max(0, (userRow.shards_balance || 0) - consumedShards) })
                        .ilike("wallet_address", userWallet);
                }
                return NextResponse.json({
                    success: true,
                    partial: true,
                    batteriesReceived: sentBatteries.length,
                    needed: batteriesNeeded,
                    shardsRefunded: refundCount,
                    refundTxHash: refund.refundTxHash,
                    batteries: sentBatteries,
                });
            }

            // Refund failed — leave the shards held and ask for support escalation.
            const msg = `Sent ${sentBatteries.length}/${batteriesNeeded} batteries (${sentTokenIds}). Auto-refund of ${refundCount} shards failed: ${refund.reason}. Operator must refund manually.`;
            await logShardMerge(userWallet, txHash, sentTokenIds, "refund_pending", msg);
            return NextResponse.json({
                error: `Sent only ${sentBatteries.length}/${batteriesNeeded} batteries — ${refundCount} shards held for manual refund. Contact support.`,
                partial: true,
                batteries: sentBatteries,
                sent: sentBatteries.length,
                needed: batteriesNeeded,
                shardsHeld: refundCount,
                support_required: true,
            }, { status: 503 });
        }

        // 5. Deduct shards from internal DB ledger
        const { data: userRow } = await supabaseAdmin
            .from("glitch_users")
            .select("shards_balance")
            .ilike("wallet_address", userWallet)
            .single();

        if (userRow) {
            await supabaseAdmin
                .from("glitch_users")
                .update({ shards_balance: Math.max(0, (userRow.shards_balance || 0) - shardCount) })
                .ilike("wallet_address", userWallet);
        }

        // 6. Log success
        const allTokenIds = sentBatteries.map(b => b.tokenId).join(", ");
        await logShardMerge(userWallet, txHash, allTokenIds, "success", null);

        console.log(`✅ [Shard Merge] Complete! ${userWallet.slice(0, 8)}... sent ${shardCount} shards → ${sentBatteries.length} batteries (${allTokenIds})`);

        return NextResponse.json({
            success: true,
            batteriesReceived: sentBatteries.length,
            shardsUsed: shardCount,
            batteries: sentBatteries,
            // Keep backward compatibility: also return single battery for non-bulk merges
            battery: sentBatteries[0],
        });
    } catch (err: any) {
        console.error("🔥 [Shard Merge]:", err.message);
        await logShardMerge(userWallet, txHash, "unknown", "failed", err.message);
        return NextResponse.json({ error: err.message || "Shard merge failed" }, { status: 500 });
    }
}
