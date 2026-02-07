import { NextRequest, NextResponse } from "next/server";
import { createThirdwebClient, getContract } from "thirdweb";
import { apeChain } from "@/lib/thirdweb";
import { eth_getTransactionReceipt, getRpcClient } from "thirdweb/rpc";
import { ownerOf } from "thirdweb/extensions/erc721";
import { supabaseAdmin } from "@/lib/supabase";

const client = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
    secretKey: process.env.THIRDWEB_SECRET_KEY,
});

const BATTERY_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS!;
const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS!.toLowerCase();

export async function POST(req: NextRequest) {
    let userWallet = "unknown";
    let txHash = "";
    let sentTokenIds: string[] = [];
    let upgradeTokenId = "";

    try {
        const body = await req.json();
        txHash = body.txHash;
        sentTokenIds = body.sentTokenIds;
        upgradeTokenId = body.upgradeTokenId;
        userWallet = body.userWallet || "unknown";

        // === INPUT VALIDATION ===
        if (!txHash || !sentTokenIds || !upgradeTokenId) {
            await logMergeAttempt(userWallet, txHash, sentTokenIds, upgradeTokenId, 'failed', 'Missing required data');
            return NextResponse.json({ error: "Missing required data" }, { status: 400 });
        }

        if (!Array.isArray(sentTokenIds) || sentTokenIds.length !== 19) {
            await logMergeAttempt(userWallet, txHash, sentTokenIds, upgradeTokenId, 'failed', 'Must send exactly 19 tokens');
            return NextResponse.json({ error: "Must send exactly 19 tokens" }, { status: 400 });
        }

        // Verify upgradeTokenId is NOT in sentTokenIds (prevent exploit)
        if (sentTokenIds.includes(upgradeTokenId)) {
            await logMergeAttempt(userWallet, txHash, sentTokenIds, upgradeTokenId, 'failed', 'Upgrade token in sent list - exploit attempt');
            return NextResponse.json({ error: "Upgrade token cannot be in sent list" }, { status: 400 });
        }

        // === VERIFY TRANSACTION ON CHAIN ===
        const rpcRequest = getRpcClient({ client, chain: apeChain });
        const receipt = await eth_getTransactionReceipt(rpcRequest, {
            hash: txHash as `0x${string}`,
        });

        if (!receipt || receipt.status !== "success") {
            await logMergeAttempt(userWallet, txHash, sentTokenIds, upgradeTokenId, 'failed', 'Transaction failed on chain');
            return NextResponse.json({ error: "Transaction failed on chain" }, { status: 400 });
        }

        // === VERIFY ALL 19 TOKENS ARE NOW OWNED BY ADMIN ===
        const contract = getContract({
            client,
            chain: apeChain,
            address: BATTERY_CONTRACT_ADDRESS,
        });

        // Check ownership of all sent tokens in parallel
        const ownershipChecks = await Promise.all(
            sentTokenIds.map(async (tokenId: string) => {
                try {
                    const owner = await ownerOf({
                        contract,
                        tokenId: BigInt(tokenId)
                    });
                    return { tokenId, owner: owner.toLowerCase(), valid: owner.toLowerCase() === ADMIN_WALLET };
                } catch (error) {
                    console.error(`Failed to check owner of token ${tokenId}:`, error);
                    return { tokenId, owner: null, valid: false };
                }
            })
        );

        // Check if all tokens are now with admin
        const failedChecks = ownershipChecks.filter(check => !check.valid);
        if (failedChecks.length > 0) {
            const errorMsg = `Ownership failed for tokens: ${failedChecks.map(c => c.tokenId).join(', ')}`;
            console.error("Ownership verification failed for tokens:", failedChecks);
            await logMergeAttempt(userWallet, txHash, sentTokenIds, upgradeTokenId, 'failed', errorMsg);
            return NextResponse.json({
                error: "Fraud attempt: Admin did not receive all tokens",
                failedTokens: failedChecks.map(c => c.tokenId)
            }, { status: 403 });
        }

        // === ALL CHECKS PASSED - UPDATE DATABASE ===
        // Use upsert in case battery doesn't exist in DB yet
        const { error: dbError } = await supabaseAdmin
            .from('batteries')
            .upsert({
                token_id: parseInt(upgradeTokenId),
                type: 'Super'
            }, { onConflict: 'token_id' });

        if (dbError) {
            console.error("Database update error:", dbError);
            await logMergeAttempt(userWallet, txHash, sentTokenIds, upgradeTokenId, 'failed', `DB update failed: ${dbError.message}`);
            return NextResponse.json({ error: "Database update failed" }, { status: 500 });
        }

        // Log successful merge
        await logMergeAttempt(userWallet, txHash, sentTokenIds, upgradeTokenId, 'success', null);

        console.log(`Merge verified: Token ${upgradeTokenId} upgraded to Super. 19 tokens transferred to admin.`);
        return NextResponse.json({ success: true, message: "Merge completed successfully!" });

    } catch (error: any) {
        console.error("Merge verification error:", error);
        await logMergeAttempt(userWallet, txHash, sentTokenIds, upgradeTokenId, 'failed', error.message || 'Unknown error');
        return NextResponse.json({ error: error.message || "Verification failed" }, { status: 500 });
    }
}

// Helper function to log merge attempts
async function logMergeAttempt(
    userWallet: string,
    txHash: string,
    sentTokenIds: string[],
    upgradedTokenId: string,
    status: 'success' | 'failed' | 'pending',
    errorMessage: string | null
) {
    try {
        await supabaseAdmin.from('merge_logs').insert({
            user_wallet: userWallet,
            tx_hash: txHash || 'no_hash',
            sent_token_ids: sentTokenIds || [],
            upgraded_token_id: upgradedTokenId || 'unknown',
            status,
            error_message: errorMessage
        });
    } catch (logError) {
        console.error("Failed to log merge attempt:", logError);
    }
}