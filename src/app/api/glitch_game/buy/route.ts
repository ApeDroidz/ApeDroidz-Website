import { NextResponse } from 'next/server';
import { createThirdwebClient, defineChain } from 'thirdweb';
import { eth_getTransactionReceipt, eth_getTransactionByHash, getRpcClient } from 'thirdweb/rpc';
import { supabaseAdmin } from '@/lib/supabase';

const TICKET_PRICE_APE = 2; // 2 APE per ticket
const RECIPIENT_WALLET = '0x1DcF1d22A1dbDd20AE875beDEEe3A259b1D608db'.toLowerCase();
const apeChain = defineChain(33139);

const thirdwebClient = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
    secretKey: process.env.THIRDWEB_SECRET_KEY,
});

/**
 * POST /api/games/buy
 * Verify an on-chain native APE transfer and credit game tickets.
 * 
 * Body: { wallet, txHash, packSize }
 */
export async function POST(req: Request) {
    try {
        const { wallet, txHash, packSize } = await req.json();

        // --- INPUT VALIDATION ---
        if (!wallet) return NextResponse.json({ error: 'Wallet required' }, { status: 400 });
        if (!txHash) return NextResponse.json({ error: 'Transaction hash required' }, { status: 400 });

        const validPacks = [1, 5, 10, 20, 50, 100];
        if (!validPacks.includes(packSize)) {
            return NextResponse.json({ error: 'Invalid pack size' }, { status: 400 });
        }

        const expectedApe = BigInt(packSize) * BigInt(TICKET_PRICE_APE) * BigInt(10) ** BigInt(18); // wei
        const userWallet = wallet.toLowerCase();

        console.log(`🎫 [Buy] Verifying: ${userWallet.slice(0, 8)}... | Pack: ${packSize} | TX: ${txHash}`);

        // --- DEDUP CHECK ---
        const { data: existingTx } = await supabaseAdmin
            .from('ticket_purchases')
            .select('id')
            .eq('tx_hash', txHash)
            .maybeSingle();

        if (existingTx) {
            return NextResponse.json({ error: 'Transaction already processed' }, { status: 400 });
        }

        // --- ON-CHAIN VERIFICATION ---
        const rpcRequest = getRpcClient({ client: thirdwebClient, chain: apeChain });

        // 1. Get transaction details
        const tx = await eth_getTransactionByHash(rpcRequest, {
            hash: txHash as `0x${string}`,
        });

        if (!tx) {
            return NextResponse.json({ error: 'Transaction not found on chain' }, { status: 400 });
        }

        // 2. Verify sender
        if (tx.from.toLowerCase() !== userWallet) {
            console.error(`❌ [Buy] Sender mismatch: expected ${userWallet}, got ${tx.from}`);
            return NextResponse.json({ error: 'Transaction sender does not match wallet' }, { status: 403 });
        }

        // 3. Verify recipient
        if (!tx.to || tx.to.toLowerCase() !== RECIPIENT_WALLET) {
            console.error(`❌ [Buy] Recipient mismatch: expected ${RECIPIENT_WALLET}, got ${tx.to}`);
            return NextResponse.json({ error: 'Transaction recipient is incorrect' }, { status: 403 });
        }

        // 4. Verify amount
        if (tx.value < expectedApe) {
            console.error(`❌ [Buy] Amount mismatch: expected ${expectedApe}, got ${tx.value}`);
            return NextResponse.json({ error: `Insufficient payment. Expected ${packSize * TICKET_PRICE_APE} APE` }, { status: 403 });
        }

        // 5. Verify transaction succeeded
        const receipt = await eth_getTransactionReceipt(rpcRequest, {
            hash: txHash as `0x${string}`,
        });

        if (!receipt || receipt.status !== 'success') {
            return NextResponse.json({ error: 'Transaction failed on chain' }, { status: 400 });
        }

        console.log(`✅ [Buy] On-chain verification passed for ${txHash}`);

        // --- RECORD PURCHASE ---
        const { error: insertError } = await supabaseAdmin
            .from('ticket_purchases')
            .insert({
                wallet_address: userWallet,
                tx_hash: txHash,
                ticket_count: packSize,
                ape_amount: packSize * TICKET_PRICE_APE,
                status: 'verified',
            });

        if (insertError) {
            console.error('❌ [Buy] Failed to log purchase:', insertError);
            // Don't block — still credit tickets even if logging fails
        }

        // --- CREDIT TICKETS ---
        const { data: existingUser } = await supabaseAdmin
            .from('glitch_users')
            .select('games_balance')
            .eq('wallet_address', userWallet)
            .maybeSingle();

        if (!existingUser) {
            await supabaseAdmin
                .from('glitch_users')
                .insert({ wallet_address: userWallet, games_balance: packSize });
        } else {
            await supabaseAdmin
                .from('glitch_users')
                .update({ games_balance: existingUser.games_balance + packSize })
                .eq('wallet_address', userWallet);
        }

        const newBalance = existingUser ? existingUser.games_balance + packSize : packSize;
        console.log(`🎉 [Buy] ${packSize} tickets credited. New balance: ${newBalance}`);

        return NextResponse.json({
            success: true,
            newBalance,
        });

    } catch (err: any) {
        console.error('🔥 [Buy] Critical:', err.message);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
