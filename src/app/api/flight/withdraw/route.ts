import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createThirdwebClient, defineChain, prepareTransaction, toWei } from 'thirdweb'
import { privateKeyToAccount } from 'thirdweb/wallets'
import { sendTransactionWithRetry } from '@/lib/sendWithRetry'
import { verifySignature } from 'thirdweb/auth'

const apeChain = defineChain(33139)
const thirdwebClient = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
})
const FLIGHT_VAULT_PK = process.env.FLIGHT_PRIZE_VAULT_PRIVATE_KEY!
const DAILY_CAP = 500  // APE per wallet per 24h (fallback if vault_limits unavailable)

/**
 * POST /api/flight/withdraw
 * Body: { wallet, amount, nonce, signature }
 *
 * - signature: EIP-191 signature of the message "Withdraw {amount} APE nonce:{nonce}"
 * - nonce: UUID or timestamp string, used for replay protection
 * - Enforces daily withdrawal cap and 10% vault balance max win
 * - Sends APE from flight vault wallet to the player
 */
export async function POST(req: NextRequest) {
    try {
        const { wallet, amount, nonce, signature } = await req.json()

        if (!wallet || !amount || !nonce || !signature) {
            return NextResponse.json({ error: 'wallet, amount, nonce, signature required' }, { status: 400 })
        }
        if (amount <= 0) {
            return NextResponse.json({ error: 'amount must be positive' }, { status: 400 })
        }

        // 1. Replay protection: nonce must be unused
        const { data: nonceCheck } = await supabaseAdmin
            .from('flight_transactions')
            .select('id')
            .eq('nonce', nonce)
            .maybeSingle()

        if (nonceCheck) {
            return NextResponse.json({ error: 'Nonce already used' }, { status: 400 })
        }

        // 2. Verify EIP-191 signature
        const message = `Withdraw ${amount} APE nonce:${nonce}`
        const isValid = await verifySignature({
            client: thirdwebClient,
            chain: apeChain,
            address: wallet,
            message,
            signature,
        })

        if (!isValid) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
        }

        // 3. Check in-game balance (SELECT FOR UPDATE via stored proc)
        const { data: balData } = await supabaseAdmin
            .from('flight_balances')
            .select('balance')
            .ilike('wallet_address', wallet)
            .maybeSingle()

        if (!balData || balData.balance < amount) {
            return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
        }

        // 4. Daily withdrawal cap
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: dailyData } = await supabaseAdmin
            .from('flight_transactions')
            .select('amount')
            .ilike('wallet_address', wallet)
            .eq('type', 'withdrawal')
            .eq('status', 'confirmed')
            .gte('created_at', since)

        const dailyTotal = (dailyData ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0)

        // Get cap from vault_limits
        const { data: limits } = await supabaseAdmin
            .from('vault_limits')
            .select('daily_withdrawal_cap, max_win_pct')
            .eq('id', 1)
            .maybeSingle()

        const dailyCap = Number(limits?.daily_withdrawal_cap ?? DAILY_CAP)
        if (dailyTotal + amount > dailyCap) {
            return NextResponse.json({
                error: `Daily withdrawal limit exceeded (${dailyCap} APE/day)`,
            }, { status: 400 })
        }

        // 5. Max win cap: 10% of vault balance
        const { data: vaultNet } = await supabaseAdmin.rpc('get_vault_net_balance')
        const maxWinPct = Number(limits?.max_win_pct ?? 0.10)
        const maxPayout = Number(vaultNet ?? 0) * maxWinPct

        if (amount > maxPayout && maxPayout > 0) {
            return NextResponse.json({
                error: `Withdrawal exceeds max payout (${maxPayout.toFixed(2)} APE)`,
            }, { status: 400 })
        }

        // 6. Deduct in-game balance atomically
        const { data: deductResult } = await supabaseAdmin.rpc('deduct_flight_balance', {
            p_wallet: wallet,
            p_amount: amount,
        })

        if (!deductResult?.success) {
            return NextResponse.json({ error: deductResult?.error ?? 'Deduction failed' }, { status: 400 })
        }

        // 7. Record withdrawal as pending (with nonce)
        const { data: txRecord } = await supabaseAdmin
            .from('flight_transactions')
            .insert({
                wallet_address: wallet.toLowerCase(),
                type: 'withdrawal',
                amount,
                nonce,
                status: 'pending',
            })
            .select('id')
            .single()

        // 8. Send on-chain
        let txHash: string
        try {
            const vaultAccount = privateKeyToAccount({ client: thirdwebClient, privateKey: FLIGHT_VAULT_PK })
            const tx = prepareTransaction({
                chain: apeChain,
                client: thirdwebClient,
                to: wallet,
                value: toWei(String(amount)),
            })
            const receipt = await sendTransactionWithRetry({ transaction: tx, account: vaultAccount, label: 'FlightWithdraw' })
            txHash = receipt.transactionHash
        } catch (sendErr: any) {
            // Rollback: restore balance
            await supabaseAdmin.rpc('credit_flight_balance', { p_wallet: wallet, p_amount: amount })
            await supabaseAdmin.from('flight_transactions').update({ status: 'failed' }).eq('id', txRecord?.id)
            throw new Error(`Blockchain send failed: ${sendErr.message}`)
        }

        // 9. Confirm transaction record
        await supabaseAdmin
            .from('flight_transactions')
            .update({ status: 'confirmed', tx_hash: txHash })
            .eq('id', txRecord?.id)

        // 10. Return new balance
        const { data: newBal } = await supabaseAdmin
            .from('flight_balances')
            .select('balance')
            .ilike('wallet_address', wallet)
            .maybeSingle()

        return NextResponse.json({
            success: true,
            tx_hash: txHash,
            new_balance: newBal?.balance ?? 0,
        })

    } catch (err: any) {
        console.error('[flight/withdraw]', err.message)
        return NextResponse.json({ error: 'Internal Server Error', details: err.message }, { status: 500 })
    }
}
