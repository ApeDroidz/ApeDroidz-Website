import { NextRequest, NextResponse } from "next/server";
import { createThirdwebClient, getContract } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import { transferFrom } from "thirdweb/extensions/erc721";
import { sendTransactionWithRetry } from '@/lib/sendWithRetry';
import { eth_getTransactionReceipt, getRpcClient } from "thirdweb/rpc";
import { ownerOf } from "thirdweb/extensions/erc721";
import { supabaseAdmin } from "@/lib/supabase";
import { apeChainServer } from '@/lib/apechain'

const PRIZE_VAULT_PRIVATE_KEY = process.env.PRIZE_VAULT_PRIVATE_KEY!;
const SUPER_BATTERY_PRIZE_TYPE_ID = 'super_battery';
const BATTERY_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS!;
const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS!.toLowerCase();

const client = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
    secretKey: process.env.THIRDWEB_SECRET_KEY,
});
const apeChain = apeChainServer;

async function logBatteryMerge(
    userWallet: string,
    txHash: string,
    sentTokenIds: string[],
    rewardTokenId: string,
    status: "success" | "failed",
    errorMessage: string | null
) {
    try {
        await supabaseAdmin.from("merge_logs").insert({
            user_wallet: userWallet,
            tx_hash: txHash || "no_hash",
            sent_token_ids: sentTokenIds,
            upgraded_token_id: rewardTokenId,
            status,
            error_message: errorMessage,
        });
    } catch (e) {
        console.error("[battery-merge] log failed:", e);
    }
}

// POST /api/merge/verify
// New flow: user sends ALL 20 standard batteries to admin → server sends 1 super battery from vault to user
export async function POST(req: NextRequest) {
    let userWallet = "unknown";
    let txHash = "";
    let sentTokenIds: string[] = [];

    try {
        const body = await req.json();
        txHash = body.txHash;
        sentTokenIds = body.sentTokenIds; // ALL 20 token IDs
        userWallet = body.userWallet || "unknown";

        // === INPUT VALIDATION ===
        if (!txHash || !sentTokenIds || !userWallet || userWallet === "unknown") {
            await logBatteryMerge(userWallet, txHash, sentTokenIds, "unknown", "failed", "Missing required data");
            return NextResponse.json({ error: "Missing required data" }, { status: 400 });
        }

        if (!Array.isArray(sentTokenIds) || sentTokenIds.length !== 20) {
            await logBatteryMerge(userWallet, txHash, sentTokenIds, "unknown", "failed", "Must send exactly 20 tokens");
            return NextResponse.json({ error: "Must send exactly 20 standard batteries" }, { status: 400 });
        }

        // === 1. VERIFY TRANSACTION ON CHAIN ===
        console.log(`🔋 [Battery Merge] Verifying tx ${txHash.slice(0, 10)}... from ${userWallet.slice(0, 8)}...`);

        const rpc = getRpcClient({ client, chain: apeChain });
        const receipt = await eth_getTransactionReceipt(rpc, { hash: txHash as `0x${string}` });

        if (!receipt || receipt.status !== "success") {
            await logBatteryMerge(userWallet, txHash, sentTokenIds, "unknown", "failed", "Transaction failed on chain");
            return NextResponse.json({ error: "Transaction failed on chain" }, { status: 400 });
        }

        // === 2. VERIFY TRANSFERS: parse Transfer event logs from receipt ===
        // ERC721 Transfer event: Transfer(address from, address to, uint256 tokenId)
        // Topic0 = keccak256("Transfer(address,address,uint256)")
        const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
        const batteryContractLower = BATTERY_CONTRACT_ADDRESS.toLowerCase();
        const userWalletLower = userWallet.toLowerCase();

        // Parse all Transfer logs from the battery contract in this transaction
        const transferLogs = (receipt.logs || []).filter((log: any) => {
            return (
                log.address?.toLowerCase() === batteryContractLower &&
                log.topics?.[0] === TRANSFER_TOPIC &&
                log.topics?.length >= 4  // Transfer has 3 indexed params: from, to, tokenId
            );
        });

        // Extract verified transfers: from=user, to=admin
        const verifiedTokenIds = new Set<string>();
        for (const log of transferLogs) {
            // Topics: [0]=event sig, [1]=from (padded), [2]=to (padded), [3]=tokenId (padded)
            const fromAddr = "0x" + (log.topics[1] as string).slice(26).toLowerCase();
            const toAddr = "0x" + (log.topics[2] as string).slice(26).toLowerCase();
            const tokenIdHex = log.topics[3] as string;
            const tokenId = BigInt(tokenIdHex).toString();

            if (fromAddr === userWalletLower && toAddr === ADMIN_WALLET) {
                verifiedTokenIds.add(tokenId);
            }
        }

        console.log(`🔋 [Battery Merge] Found ${verifiedTokenIds.size} verified transfers from user in tx logs`);

        // Check that all 20 sent token IDs appear in the verified set
        const missingFromLogs = sentTokenIds.filter(id => !verifiedTokenIds.has(id));

        if (missingFromLogs.length > 0) {
            // Fallback: for any tokens not found in logs (edge case), verify current ownership
            console.warn(`⚠️ [Battery Merge] ${missingFromLogs.length} tokens not found in Transfer logs, checking ownerOf...`);

            const batteryContract = getContract({
                client,
                chain: apeChain,
                address: BATTERY_CONTRACT_ADDRESS,
            });

            const ownershipChecks = await Promise.all(
                missingFromLogs.map(async (tokenId: string) => {
                    try {
                        const owner = await ownerOf({
                            contract: batteryContract,
                            tokenId: BigInt(tokenId)
                        });
                        return { tokenId, valid: owner.toLowerCase() === ADMIN_WALLET };
                    } catch {
                        return { tokenId, valid: false };
                    }
                })
            );

            const failedChecks = ownershipChecks.filter(c => !c.valid);
            if (failedChecks.length > 0) {
                const errorMsg = `Transfer verification failed for tokens: ${failedChecks.map(c => c.tokenId).join(', ')}. User: ${userWallet}`;
                console.error("❌ " + errorMsg);
                await logBatteryMerge(userWallet, txHash, sentTokenIds, "unknown", "failed", errorMsg);
                return NextResponse.json({
                    error: "Not all 20 batteries were transferred from your wallet to admin. Merge rejected.",
                    failedTokens: failedChecks.map(c => c.tokenId)
                }, { status: 403 });
            }
        }

        console.log(`✅ [Battery Merge] All 20 batteries verified: transferred from ${userWallet.slice(0, 8)}... to admin`);


        // === 3. FIND AVAILABLE SUPER BATTERY IN NFT INVENTORY ===
        const { data: superBattery, error: sbErr } = await supabaseAdmin
            .from("nft_inventory")
            .select("id, token_id, contract_address, name, image_url")
            .eq("prize_type_id", SUPER_BATTERY_PRIZE_TYPE_ID)
            .eq("status", "available")
            .order("token_id", { ascending: true })
            .limit(1)
            .maybeSingle();

        if (sbErr) throw new Error(`DB error finding super battery: ${sbErr.message}`);

        if (!superBattery) {
            await logBatteryMerge(userWallet, txHash, sentTokenIds, "unknown", "failed", "No super batteries in stock");
            return NextResponse.json(
                { error: "No super batteries available at the moment. Please contact support." },
                { status: 503 }
            );
        }

        console.log(`🔋 [Battery Merge] Found Super Battery #${superBattery.token_id} (contract: ${superBattery.contract_address})`);

        // === 4. RESERVE THE SUPER BATTERY (prevent race conditions) ===
        const { data: reserved, error: reserveErr } = await supabaseAdmin
            .from("nft_inventory")
            .update({ status: "claimed", winner_wallet: userWallet })
            .eq("id", superBattery.id)
            .eq("status", "available") // Only update if still available (atomic check)
            .select()
            .single();

        if (reserveErr || !reserved) {
            // Race condition: someone else claimed it first, try again
            const { data: fallback, error: fallbackErr } = await supabaseAdmin
                .from("nft_inventory")
                .select("id, token_id, contract_address, name, image_url")
                .eq("prize_type_id", SUPER_BATTERY_PRIZE_TYPE_ID)
                .eq("status", "available")
                .order("token_id", { ascending: true })
                .limit(1)
                .maybeSingle();

            if (fallbackErr || !fallback) {
                await logBatteryMerge(userWallet, txHash, sentTokenIds, "unknown", "failed", "No super batteries available (race condition)");
                return NextResponse.json({ error: "No super batteries available. Please try again." }, { status: 503 });
            }

            // Claim the fallback
            await supabaseAdmin
                .from("nft_inventory")
                .update({ status: "claimed", winner_wallet: userWallet })
                .eq("id", fallback.id)
                .eq("status", "available");

            // Use fallback battery
            Object.assign(superBattery, fallback);
        }

        // === 5. TRANSFER SUPER BATTERY FROM VAULT TO USER ===
        const vaultAccount = privateKeyToAccount({ client, privateKey: PRIZE_VAULT_PRIVATE_KEY });
        const superBatteryContract = getContract({ client, chain: apeChain, address: superBattery.contract_address });

        console.log(`📤 [Battery Merge] Transferring Super Battery #${superBattery.token_id} to ${userWallet.slice(0, 8)}...`);

        const transferTx = transferFrom({
            contract: superBatteryContract,
            from: vaultAccount.address,
            to: userWallet,
            tokenId: BigInt(superBattery.token_id),
        });

        const transferReceipt = await sendTransactionWithRetry({ transaction: transferTx, account: vaultAccount, label: 'BatteryMerge' });

        console.log(`✅ [Battery Merge] Transfer complete! TX: ${transferReceipt.transactionHash}`);

        // === 6. INSERT BATTERY ROW (REQUIRED BY /api/upgrade) ===
        // Without this, the upgrade route can't determine the battery type and
        // the on-chain burn would still happen but the upgrade RPC would fail —
        // user loses battery. Upsert is idempotent on `token_id`.
        try {
            const { error: insertErr } = await supabaseAdmin
                .from('batteries')
                .upsert(
                    { token_id: parseInt(superBattery.token_id), type: 'Super', is_burned: false },
                    { onConflict: 'token_id' }
                );
            if (insertErr) {
                console.error('⚠️ [Battery Merge] batteries row upsert failed:', insertErr.message);
                // Non-fatal: user can still receive the NFT; /api/upgrade has fallback.
            } else {
                console.log(`📝 [Battery Merge] batteries row recorded: tokenId=${superBattery.token_id}, type=Super`);
            }
        } catch (e: any) {
            console.warn('⚠️ [Battery Merge] batteries row insert raised:', e?.message);
        }

        // === 7. LOG SUCCESS ===
        await logBatteryMerge(userWallet, txHash, sentTokenIds, superBattery.token_id, "success", null);

        console.log(`✅ [Battery Merge] Complete! ${userWallet.slice(0, 8)}... sent 20 std batteries → received Super Battery #${superBattery.token_id}`);

        return NextResponse.json({
            success: true,
            message: "Merge completed successfully!",
            superBattery: {
                tokenId: superBattery.token_id,
                name: superBattery.name,
                imageUrl: superBattery.image_url,
                txHash: transferReceipt.transactionHash,
            },
        });
    } catch (err: any) {
        console.error("🔥 [Battery Merge] Critical Error:", err.message);
        await logBatteryMerge(userWallet, txHash, sentTokenIds, "unknown", "failed", err.message);
        return NextResponse.json({ error: err.message || "Battery merge failed" }, { status: 500 });
    }
}