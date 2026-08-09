import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { apeChainServer, createServerThirdwebClient } from '@/lib/apechain'

const apeChain = apeChainServer
const VAULT_WALLET = process.env.NEXT_PUBLIC_FLIGHT_VAULT_WALLET_ADDRESS!
const MIN_DEPOSIT = 10     // APE
const MIN_CONFIRMATIONS = 1 // ApeChain has fast finality — 1 conf is sufficient

const thirdwebClient = createServerThirdwebClient()

/**
 * POST /api/flight/deposit
 * Body: { wallet: string, tx_hash: string }
 *
 * Verifies the on-chain deposit transaction and credits the in-game balance.
 * Amount is read from the blockchain — NOT from the request body.
 *
 * Idempotency is enforced via INSERT into flight_transactions with a unique
 * constraint on tx_hash — concurrent duplicate calls hit the constraint and
 * return the already-processed balance without double-crediting.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const { wallet, tx_hash } = body

        if (!wallet || !tx_hash) {
            return NextResponse.json({ error: 'wallet and tx_hash required' }, { status: 400 })
        }

        if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
            return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
        }

        if (!/^0x[0-9a-fA-F]{64}$/.test(tx_hash)) {
            return NextResponse.json({ error: 'Invalid transaction hash format' }, { status: 400 })
        }

        // ── Idempotency: if this tx was already processed, return current balance ──
        const { data: existingTx } = await supabaseAdmin
            .from('flight_transactions')
            .select('id, status')
            .eq('tx_hash', tx_hash)
            .maybeSingle()

        if (existingTx) {
            const { data: balData } = await supabaseAdmin
                .from('flight_balances')
                .select('balance')
                .ilike('wallet_address', wallet)
                .maybeSingle()
            return NextResponse.json({
                success:     true,
                deposited:   0,
                new_balance: balData?.balance ?? 0,
                info:        'Transaction already processed',
            })
        }

        // ── Read and verify transaction from blockchain ─────────────────────────
        let actualAmount: number
        let fromAddress: string

        try {
            const rpc = await import('thirdweb/rpc')
            const rpcClient = rpc.getRpcClient({ client: thirdwebClient, chain: apeChain })

            const [tx, currentBlockHex] = await Promise.all([
                rpcClient({ method: 'eth_getTransactionByHash', params: [tx_hash] }) as Promise<any>,
                rpcClient({ method: 'eth_blockNumber', params: undefined as any }) as Promise<string>,
            ])

            if (!tx) {
                return NextResponse.json({ error: 'Transaction not found on chain' }, { status: 404 })
            }

            if (!tx.blockNumber) {
                return NextResponse.json({ error: 'Transaction not confirmed yet — please wait' }, { status: 400 })
            }

            const txBlock      = parseInt(tx.blockNumber as string, 16)
            const currentBlock = parseInt(currentBlockHex, 16)
            const confirmations = currentBlock - txBlock

            if (confirmations < MIN_CONFIRMATIONS) {
                return NextResponse.json({
                    error: `Transaction needs ${MIN_CONFIRMATIONS - confirmations} more confirmation(s) — please wait`,
                }, { status: 400 })
            }

            const toAddress: string = tx.to ?? ''
            if (toAddress.toLowerCase() !== VAULT_WALLET.toLowerCase()) {
                return NextResponse.json({ error: 'Transaction was not sent to the vault' }, { status: 400 })
            }

            // Amount is chain-authoritative
            const valueWei   = BigInt(tx.value ?? '0x0')
            const DECIMALS   = BigInt('1000000000000000000')
            const whole      = valueWei / DECIMALS
            const fractional = valueWei % DECIMALS
            actualAmount     = Number(whole) + Number(fractional) / 1e18

            fromAddress = (tx.from ?? '').toLowerCase()
        } catch (verifyErr: any) {
            console.error('[deposit] Chain verification failed:', verifyErr.message)
            return NextResponse.json({ error: 'Could not verify transaction on-chain — please retry' }, { status: 400 })
        }

        if (fromAddress !== wallet.toLowerCase()) {
            return NextResponse.json({ error: 'Transaction sender does not match your wallet' }, { status: 400 })
        }

        if (actualAmount < MIN_DEPOSIT) {
            return NextResponse.json({
                error: `Minimum deposit is ${MIN_DEPOSIT} APE (received: ${actualAmount.toFixed(4)} APE)`,
            }, { status: 400 })
        }

        // ── Lock this tx atomically (unique constraint on tx_hash) ──────────────
        const { data: txRecord, error: insertErr } = await supabaseAdmin
            .from('flight_transactions')
            .insert({
                wallet_address: wallet.toLowerCase(),
                type:           'deposit',
                amount:         actualAmount,
                tx_hash,
                status:         'pending',
            })
            .select('id')
            .single()

        if (insertErr) {
            // Concurrent duplicate — already being processed
            const { data: balData } = await supabaseAdmin
                .from('flight_balances')
                .select('balance')
                .ilike('wallet_address', wallet)
                .maybeSingle()
            return NextResponse.json({
                success:     true,
                deposited:   0,
                new_balance: balData?.balance ?? 0,
                info:        'Transaction already processed',
            })
        }

        // ── Credit in-game balance ──────────────────────────────────────────────
        const { error: creditErr } = await supabaseAdmin.rpc('credit_flight_balance', {
            p_wallet: wallet,
            p_amount: actualAmount,
        })

        if (creditErr) {
            // Mark for manual review — do NOT return success, funds are in vault
            await supabaseAdmin
                .from('flight_transactions')
                .update({ status: 'pending_investigation' })
                .eq('id', txRecord.id)
            console.error('[deposit] credit_flight_balance failed:', creditErr.message, { wallet, tx_hash, actualAmount })
            return NextResponse.json({
                error:      'Balance credit failed — please contact support with your tx hash',
                request_id: txRecord.id,
            }, { status: 500 })
        }

        // ── Confirm record and return new balance ───────────────────────────────
        await supabaseAdmin
            .from('flight_transactions')
            .update({ status: 'confirmed' })
            .eq('id', txRecord.id)

        const { data: newBal } = await supabaseAdmin
            .from('flight_balances')
            .select('balance')
            .ilike('wallet_address', wallet)
            .maybeSingle()

        return NextResponse.json({
            success:     true,
            deposited:   actualAmount,
            new_balance: newBal?.balance ?? 0,
        })

    } catch (err: any) {
        console.error('[flight/deposit]', err.message)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
