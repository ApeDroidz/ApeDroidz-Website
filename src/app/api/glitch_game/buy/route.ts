import { NextResponse } from 'next/server';
import { createThirdwebClient, defineChain } from 'thirdweb';
import { eth_getTransactionReceipt, eth_getTransactionByHash, getRpcClient } from 'thirdweb/rpc';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidWallet } from '@/lib/walletAuth';

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
 *
 * Auth: this endpoint does NOT require a session cookie because the on-chain
 *       transaction's `from` field already proves ownership of the wallet.
 *       We only credit tickets to whoever sent the APE.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null);
        if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
        const { wallet, txHash, packSize } = body;

        // ── INPUT VALIDATION ────────────────────────────────────────────────
        if (!isValidWallet(wallet)) {
            return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 });
        }
        if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
            return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
        }
        const validPacks = [1, 5, 10, 20, 50, 100];
        if (typeof packSize !== 'number' || !validPacks.includes(packSize)) {
            return NextResponse.json({ error: 'Invalid pack size' }, { status: 400 });
        }

        const userWallet = wallet.toLowerCase();
        // wei expected for the requested pack
        const expectedApe = BigInt(packSize) * BigInt(TICKET_PRICE_APE) * BigInt(10) ** BigInt(18);

        console.log(`🎫 [Buy] Verifying: ${userWallet.slice(0, 8)}... | Pack: ${packSize} | TX: ${txHash}`);

        // ── DEDUP CHECK ─────────────────────────────────────────────────────
        // Tx-hash is unique on the table (see migration), but we still do a
        // pre-check to fast-path repeated requests with a clean response.
        const { data: existingTx } = await supabaseAdmin
            .from('ticket_purchases')
            .select('id')
            .eq('tx_hash', txHash)
            .maybeSingle();
        if (existingTx) {
            return NextResponse.json({ error: 'Transaction already processed' }, { status: 400 });
        }

        // ── ON-CHAIN VERIFICATION ───────────────────────────────────────────
        const rpcRequest = getRpcClient({ client: thirdwebClient, chain: apeChain });

        const tx = await eth_getTransactionByHash(rpcRequest, { hash: txHash as `0x${string}` });
        if (!tx) return NextResponse.json({ error: 'Transaction not found on chain' }, { status: 400 });

        if (tx.from.toLowerCase() !== userWallet) {
            console.error(`❌ [Buy] Sender mismatch: expected ${userWallet}, got ${tx.from}`);
            return NextResponse.json({ error: 'Transaction sender does not match wallet' }, { status: 403 });
        }

        if (!tx.to || tx.to.toLowerCase() !== RECIPIENT_WALLET) {
            console.error(`❌ [Buy] Recipient mismatch: expected ${RECIPIENT_WALLET}, got ${tx.to}`);
            return NextResponse.json({ error: 'Transaction recipient is incorrect' }, { status: 403 });
        }

        // STRICT amount check — reject both under- and over-payment so users
        // can't get away with paying for pack=1 when they expected pack=50,
        // and so we don't silently keep extra APE.
        const txValue = BigInt(tx.value);
        if (txValue !== expectedApe) {
            console.error(`❌ [Buy] Amount mismatch: expected ${expectedApe}, got ${txValue}`);
            return NextResponse.json({
                error: `Payment mismatch — expected exactly ${packSize * TICKET_PRICE_APE} APE`,
            }, { status: 403 });
        }

        const receipt = await eth_getTransactionReceipt(rpcRequest, { hash: txHash as `0x${string}` });
        if (!receipt || receipt.status !== 'success') {
            return NextResponse.json({ error: 'Transaction failed on chain' }, { status: 400 });
        }

        console.log(`✅ [Buy] On-chain verification passed for ${txHash}`);

        // ── ATOMIC LOCK + CREDIT ────────────────────────────────────────────
        // Insert into ticket_purchases first. UNIQUE(tx_hash) constraint
        // serialises concurrent requests with the same tx_hash — only one
        // wins, the other gets a duplicate-key error which we map to a
        // friendly 'already processed' response.
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
            // Concurrent duplicate or unique-violation — the other request will credit.
            const code = (insertError as any).code;
            if (code === '23505') {
                return NextResponse.json({ error: 'Transaction already processed' }, { status: 400 });
            }
            // Unknown DB error — fail closed. Don't credit blindly.
            console.error('❌ [Buy] ticket_purchases insert error:', insertError.message);
            return NextResponse.json({ error: 'Database error — please retry' }, { status: 500 });
        }

        // Atomic ticket credit via RPC. Replaces the previous read-then-write
        // sequence which lost increments under concurrent buys.
        const { data: newBalanceData, error: creditErr } = await supabaseAdmin
            .rpc('add_glitch_user_tickets', { p_wallet: userWallet, p_amount: packSize });

        if (creditErr) {
            // The purchase IS recorded but credit failed — flag for support.
            console.error('❌ [Buy] add_glitch_user_tickets failed:', creditErr.message, { txHash });
            await supabaseAdmin
                .from('ticket_purchases')
                .update({ status: 'pending_investigation' })
                .eq('tx_hash', txHash);
            return NextResponse.json({
                error: 'Purchase recorded but ticket credit failed — please contact support with your tx hash',
            }, { status: 500 });
        }

        const newBalance = Number(newBalanceData ?? 0);
        console.log(`🎉 [Buy] ${packSize} tickets credited. New balance: ${newBalance}`);

        return NextResponse.json({ success: true, newBalance });

    } catch (err: any) {
        console.error('🔥 [Buy] Critical:', err.message);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
