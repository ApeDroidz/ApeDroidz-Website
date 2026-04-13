import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createThirdwebClient, defineChain } from 'thirdweb'

const apeChain = defineChain(33139)
const VAULT_WALLET = process.env.NEXT_PUBLIC_FLIGHT_VAULT_WALLET_ADDRESS!
const MIN_DEPOSIT = 10   // APE
const MIN_CONFIRMATIONS = 3

const thirdwebClient = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
})

/**
 * POST /api/flight/deposit
 * Body: { wallet: string, tx_hash: string }
 *
 * Verifies the on-chain deposit transaction and credits the in-game balance.
 * Amount is read from the blockchain — NOT from the request body.
 *
 * Idempotency is enforced atomically via process_flight_deposit() stored proc
 * which uses pg_advisory_xact_lock to prevent double-credit race conditions.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const { wallet, tx_hash } = body

        if (!wallet || !tx_hash) {
            return NextResponse.json({ error: 'wallet and tx_hash required' }, { status: 400 })
        }

        // Validate wallet format
        if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
            return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
        }

        // Validate tx_hash format — must be 0x + 64 hex chars (32 bytes)
        if (!/^0x[0-9a-fA-F]{64}$/.test(tx_hash)) {
            return NextResponse.json({ error: 'Invalid transaction hash format' }, { status: 400 })
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
                return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
            }

            if (!tx.blockNumber) {
                return NextResponse.json({ error: 'Transaction not confirmed yet — please wait' }, { status: 400 })
            }

            // Require minimum block confirmations to prevent reorg attacks
            const txBlock = parseInt(tx.blockNumber as string, 16)
            const currentBlock = parseInt(currentBlockHex, 16)
            const confirmations = currentBlock - txBlock
            if (confirmations < MIN_CONFIRMATIONS) {
                return NextResponse.json({
                    error: `Transaction needs ${MIN_CONFIRMATIONS - confirmations} more confirmation(s) — please wait`,
                }, { status: 400 })
            }

            // Must be sent to the vault wallet
            const toAddress: string = tx.to ?? ''
            if (toAddress.toLowerCase() !== VAULT_WALLET.toLowerCase()) {
                return NextResponse.json({ error: 'Transaction was not sent to the vault' }, { status: 400 })
            }

            // Amount is chain-authoritative — never trust client-supplied value
            const valueWei = BigInt(tx.value ?? '0x0')
            // Split BigInt into whole + fractional parts before converting to Number
            // to avoid IEEE-754 precision loss for amounts > 2^53 wei (~9007 APE)
            const DECIMALS = BigInt('1000000000000000000') // 1e18
            const whole = valueWei / DECIMALS
            const fractional = valueWei % DECIMALS
            actualAmount = Number(whole) + Number(fractional) / 1e18

            fromAddress = (tx.from ?? '').toLowerCase()
        } catch (verifyErr: any) {
            console.error('[deposit] Chain verification failed:', verifyErr.message)
            return NextResponse.json({ error: 'Could not verify transaction on-chain — please retry' }, { status: 400 })
        }

        // Sender must match the claiming wallet
        if (fromAddress !== wallet.toLowerCase()) {
            return NextResponse.json({
                error: 'Transaction sender does not match your wallet',
            }, { status: 400 })
        }

        // Enforce minimum deposit
        if (actualAmount < MIN_DEPOSIT) {
            return NextResponse.json({
                error: `Minimum deposit is ${MIN_DEPOSIT} APE (received: ${actualAmount.toFixed(4)} APE)`,
            }, { status: 400 })
        }

        // ── Atomic credit via stored proc ──────────────────────────────────────
        // process_flight_deposit uses pg_advisory_xact_lock(hashtext(tx_hash)) to
        // serialise concurrent calls. INSERT ... ON CONFLICT DO NOTHING ensures
        // only one call credits the balance even under heavy concurrent load.
        const { data: result, error: rpcErr } = await supabaseAdmin.rpc('process_flight_deposit', {
            p_wallet:  wallet,
            p_tx_hash: tx_hash,
            p_amount:  actualAmount,
        })

        if (rpcErr) {
            console.error('[deposit] process_flight_deposit failed:', rpcErr.message)
            return NextResponse.json({ error: 'Failed to process deposit — please contact support' }, { status: 500 })
        }

        return NextResponse.json({
            success:     true,
            deposited:   result.credited ? actualAmount : 0,
            new_balance: result.new_balance,
            ...(result.already_done ? { info: 'Transaction already processed' } : {}),
        })

    } catch (err: any) {
        console.error('[flight/deposit]', err.message)
        // Never expose internal error details to the client
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
