import { NextRequest, NextResponse } from "next/server";
import { createThirdwebClient, getContract, defineChain } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import { transferFrom } from "thirdweb/extensions/erc721";
import { sendTransaction } from "thirdweb";
import { eth_getTransactionReceipt, getRpcClient } from "thirdweb/rpc";
import { supabaseAdmin } from "@/lib/supabase";

const PRIZE_VAULT_PRIVATE_KEY = process.env.PRIZE_VAULT_PRIVATE_KEY!;
const STANDARD_BATTERY_PRIZE_TYPE_ID = 'std_battery';

const client = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
    secretKey: process.env.THIRDWEB_SECRET_KEY,
});
const apeChain = defineChain(33139);

async function logShardMerge(
    userWallet: string,
    txHash: string,
    upgradedTokenId: string,
    status: "success" | "failed",
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

        // 3. Check battery availability BEFORE transferring
        const { data: availableBatteries, error: batteryErr } = await supabaseAdmin
            .from("nft_inventory")
            .select("id, token_id, contract_address, name, image_url")
            .eq("prize_type_id", STANDARD_BATTERY_PRIZE_TYPE_ID)
            .eq("status", "available")
            .order("token_id", { ascending: true })
            .limit(batteriesNeeded);

        if (batteryErr) throw new Error(`DB error finding batteries: ${batteryErr.message}`);

        if (!availableBatteries || availableBatteries.length < batteriesNeeded) {
            const errorMsg = `Not enough batteries in vault. Need ${batteriesNeeded}, available: ${availableBatteries?.length || 0}. Please contact the team.`;
            await logShardMerge(userWallet, txHash, "unknown", "failed", errorMsg);
            return NextResponse.json({ error: errorMsg }, { status: 503 });
        }

        // 4. Transfer all batteries from vault to user
        const vaultAccount = privateKeyToAccount({ client, privateKey: PRIZE_VAULT_PRIVATE_KEY });
        const sentBatteries: Array<{ tokenId: string; name: string; imageUrl: string; txHash: string }> = [];

        for (const batteryItem of availableBatteries) {
            const batteryContract = getContract({ client, chain: apeChain, address: batteryItem.contract_address });

            const transferTx = transferFrom({
                contract: batteryContract,
                from: vaultAccount.address,
                to: userWallet,
                tokenId: BigInt(batteryItem.token_id),
            });

            const transferReceipt = await sendTransaction({ transaction: transferTx, account: vaultAccount });

            // Mark battery as claimed
            await supabaseAdmin
                .from("nft_inventory")
                .update({ status: "claimed", winner_wallet: userWallet })
                .eq("id", batteryItem.id);

            sentBatteries.push({
                tokenId: batteryItem.token_id,
                name: batteryItem.name,
                imageUrl: batteryItem.image_url,
                txHash: transferReceipt.transactionHash,
            });

            console.log(`✅ [Shard Merge] Sent Battery #${batteryItem.token_id} to ${userWallet.slice(0, 8)}...`);
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
