import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createThirdwebClient, defineChain, getContract } from 'thirdweb'
import { eth_getTransactionByHash } from 'thirdweb/rpc'

const apeChain = defineChain(33139)
const VAULT_WALLET = process.env.NEXT_PUBLIC_FLIGHT_VAULT_WALLET_ADDRESS!
const thirdwebClient = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
})

/**
 * POST /api/flight/deposit
 * Body: { wallet: string, tx_hash: string, amount: number }
 *
 * Verifies the on-chain deposit transaction and credits the in-game balance.
 * Idempotent — same tx_hash can only be credited once.
 */
export async function POST(req: NextRequest) {
    try {
        const { wallet, tx_hash, amount } = await req.json()

        if (!wallet || !tx_hash || !amount) {
            return NextResponse.json({ error: 'wallet, tx_hash, amount required' }, { status: 400 })
        }
        if (amount <= 0) {
            return NextResponse.json({ error: 'amount must be positive' }, { status: 400 })
        }

        // Idempotency: check if this tx_hash was already processed
        const { data: existing } = await supabaseAdmin
            .from('flight_transactions')
            .select('id, status')
            .eq('tx_hash', tx_hash)
            .maybeSingle()

        if (existing?.status === 'confirmed') {
            return NextResponse.json({ error: 'Transaction already credited' }, { status: 409 })
        }

        // Verify on-chain: tx must be to the vault wallet
        try {
            const rpcRequest = eth_getTransactionByHash
            const rpc = await import('thirdweb/rpc')
            const tx = await rpc.getRpcClient({ client: thirdwebClient, chain: apeChain })({
                method: 'eth_getTransactionByHash',
                params: [tx_hash],
            })

            const toAddress: string = (tx as any)?.to ?? ''
            if (toAddress.toLowerCase() !== VAULT_WALLET.toLowerCase()) {
                return NextResponse.json({ error: 'Transaction recipient does not match vault wallet' }, { status: 400 })
            }
        } catch (verifyErr: any) {
            console.warn('[deposit] Could not verify tx on-chain:', verifyErr.message)
            // In development/test, allow unverified deposits. In production, remove this bypass.
            if (process.env.NODE_ENV === 'production') {
                return NextResponse.json({ error: 'Could not verify transaction' }, { status: 400 })
            }
        }

        // Record pending transaction
        await supabaseAdmin.from('flight_transactions').upsert({
            wallet_address: wallet.toLowerCase(),
            type: 'deposit',
            amount,
            tx_hash,
            status: 'confirmed',
        }, { onConflict: 'tx_hash' })

        // Credit balance atomically
        await supabaseAdmin.rpc('credit_flight_balance', {
            p_wallet: wallet,
            p_amount: amount,
        })

        // Return new balance
        const { data: balData } = await supabaseAdmin
            .from('flight_balances')
            .select('balance')
            .ilike('wallet_address', wallet)
            .maybeSingle()

        return NextResponse.json({ success: true, new_balance: balData?.balance ?? amount })

    } catch (err: any) {
        console.error('[flight/deposit]', err.message)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
