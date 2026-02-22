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

    try {
        const body = await req.json();
        txHash = body.txHash;
        userWallet = body.userWallet || "unknown";

        if (!txHash || !userWallet || userWallet === "unknown") {
            return NextResponse.json({ error: "txHash and userWallet required" }, { status: 400 });
        }


        const rpc = getRpcClient({ client, chain: apeChain });
        const receipt = await eth_getTransactionReceipt(rpc, { hash: txHash as `0x${string}` });

        if (!receipt || receipt.status !== "success") {
            await logShardMerge(userWallet, txHash, "unknown", "failed", "Shard transaction failed on chain");
            return NextResponse.json({ error: "Transaction failed on chain" }, { status: 400 });
        }

        // 2. Find one available standard battery in nft_inventory
        const { data: batteryItem, error: batteryErr } = await supabaseAdmin
            .from("nft_inventory")
            .select("id, token_id, contract_address, name, image_url")
            .eq("prize_type_id", STANDARD_BATTERY_PRIZE_TYPE_ID)
            .eq("status", "available")
            .limit(1)
            .maybeSingle();

        if (batteryErr) throw new Error(`DB error finding battery: ${batteryErr.message}`);

        if (!batteryItem) {
            await logShardMerge(userWallet, txHash, "unknown", "failed", "No standard batteries in stock");
            return NextResponse.json(
                { error: "No standard batteries available at the moment. Contact support." },
                { status: 503 }
            );
        }

        // 3. Transfer the battery from vault to user
        const vaultAccount = privateKeyToAccount({ client, privateKey: PRIZE_VAULT_PRIVATE_KEY });
        const batteryContract = getContract({ client, chain: apeChain, address: batteryItem.contract_address });

        const transferTx = transferFrom({
            contract: batteryContract,
            from: vaultAccount.address,
            to: userWallet,
            tokenId: BigInt(batteryItem.token_id),
        });

        const transferReceipt = await sendTransaction({ transaction: transferTx, account: vaultAccount });

        // 4. Mark battery as claimed in inventory
        await supabaseAdmin
            .from("nft_inventory")
            .update({ status: "claimed", winner_wallet: userWallet })
            .eq("id", batteryItem.id);

        // 5. Log success
        await logShardMerge(userWallet, txHash, batteryItem.token_id, "success", null);

        console.log(`✅ [Shard Merge] ${userWallet.slice(0, 8)}... → Battery #${batteryItem.token_id} (tx: ${transferReceipt.transactionHash})`);

        return NextResponse.json({
            success: true,
            battery: {
                tokenId: batteryItem.token_id,
                name: batteryItem.name,
                imageUrl: batteryItem.image_url,
                txHash: transferReceipt.transactionHash,
            },
        });
    } catch (err: any) {
        console.error("🔥 [Shard Merge]:", err.message);
        await logShardMerge(userWallet, txHash, "unknown", "failed", err.message);
        return NextResponse.json({ error: err.message || "Shard merge failed" }, { status: 500 });
    }
}
