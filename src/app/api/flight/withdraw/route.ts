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
const DAILY_CAP = 500    // APE fallback if vault_limits unavailable
const MIN_WITHDRAW = 1   // APE — below this gas cost exceeds withdrawal value

/**
 * POST /api/flight/withdraw
 * Body: { wallet, amount, nonce, signature }
 *
 * Security guarantees:
 * - EIP-191 signature proves wallet ownership
 * - Nonce is locked (INSERT) before any balance changes — prevents TOCTOU
 * - Daily cap counts confirmed + pending records (prevents concurrent bypass)
 * - On blockchain send failure: TX is checked on-chain before rolling back balance
 *   to avoid false rollback when TX actually landed (network timeout scenario)
 */
export async function POST(req: NextRequest) {
    try {
        const { wallet, amount, nonce, signature } = await req.json()

        // ── Input validation ───────────────────────────────────────────────────

        if (!wallet || amount == null || !nonce || !signature) {
            return NextResponse.json({ error: 'wallet, amount, nonce, signature required' }, { status: 400 })
        }

        // Strict numeric validation — reject NaN, Infinity, strings
        const numAmount = Number(amount)
        if (!Number.isFinite(numAmount) || isNaN(numAmount)) {
            return NextResponse.json({ error: 'amount must be a finite number' }, { status: 400 })
        }
        if (numAmount < MIN_WITHDRAW) {
            return NextResponse.json({ error: `Minimum withdrawal is ${MIN_WITHDRAW} APE` }, { status: 400 })
        }
        // Cap precision to 4 decimal places to prevent float shenanigans
        const safeAmount = parseFloat(numAmount.toFixed(4))

        if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
            return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
        }

        // Nonce format: "{timestamp}.{uuid}" — must be fresh (within 10 minutes)
        const nonceParts = String(nonce).split('.')
        const nonceTs = parseInt(nonceParts[0] ?? '0', 10)
        const now = Date.now()
        // Reject stale nonces (older than 10 minutes) AND future nonces (more than 60s ahead)
        if (isNaN(nonceTs) || now - nonceTs > 10 * 60 * 1000 || nonceTs - now > 60 * 1000) {
            return NextResponse.json({ error: 'Request expired — please try again' }, { status: 400 })
        }
        // Nonce must not be absurdly long (prevent DB column abuse)
        if (String(nonce).length > 200) {
            return NextResponse.json({ error: 'Invalid nonce format' }, { status: 400 })
        }

        // ── 1. Verify EIP-191 signature (cheap, no DB writes yet) ──────────────
        const message = `Withdraw ${safeAmount} APE nonce:${nonce}`
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

        // ── 2. Lock nonce atomically ───────────────────────────────────────────
        // Insert pending record FIRST — unique index on nonce serialises concurrent
        // requests. Any duplicate nonce or concurrent duplicate hits the constraint.
        const { data: txRecord, error: nonceLockError } = await supabaseAdmin
            .from('flight_transactions')
            .insert({
                wallet_address: wallet.toLowerCase(),
                type:   'withdrawal',
                amount: safeAmount,
                nonce,
                status: 'pending',
            })
            .select('id')
            .single()

        if (nonceLockError) {
            return NextResponse.json({ error: 'Nonce already used or duplicate request' }, { status: 400 })
        }

        const txId = txRecord.id

        // Helper: mark this record failed and return an error response
        const fail = async (msg: string, status: number) => {
            await supabaseAdmin.from('flight_transactions').update({ status: 'failed' }).eq('id', txId)
            return NextResponse.json({ error: msg }, { status })
        }

        // ── 3. Check in-game balance ───────────────────────────────────────────
        const { data: balData } = await supabaseAdmin
            .from('flight_balances')
            .select('balance')
            .ilike('wallet_address', wallet)
            .maybeSingle()

        if (!balData || Number(balData.balance) < safeAmount) {
            return fail('Insufficient balance', 400)
        }

        // ── 4. Daily withdrawal cap ────────────────────────────────────────────
        // Count confirmed + pending (our pending record is already inserted above,
        // so it's included here — this prevents concurrent-request cap bypass).
        // We subtract our own record's amount from the sum then re-add to check,
        // to avoid double-counting this request against itself.
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: dailyData } = await supabaseAdmin
            .from('flight_transactions')
            .select('id, amount')
            .ilike('wallet_address', wallet)
            .eq('type', 'withdrawal')
            .in('status', ['confirmed', 'pending'])
            .gte('created_at', since)

        const { data: limits } = await supabaseAdmin
            .from('vault_limits')
            .select('daily_withdrawal_cap, max_win_pct')
            .eq('id', 1)
            .maybeSingle()

        const dailyCap = Number(limits?.daily_withdrawal_cap ?? DAILY_CAP)

        // Sum all records EXCEPT our own pending record (already locked above),
        // then add safeAmount once — avoids the double-count bug.
        const otherPendingTotal = (dailyData ?? [])
            .filter((r: { id: string; amount: number }) => r.id !== txId)
            .reduce((s: number, r: { id: string; amount: number }) => s + Number(r.amount), 0)

        if (otherPendingTotal + safeAmount > dailyCap) {
            return fail(`Daily withdrawal limit exceeded (${dailyCap} APE/day)`, 400)
        }

        // ── 5. Max win cap: % of vault balance ─────────────────────────────────
        const { data: vaultNet } = await supabaseAdmin.rpc('get_vault_net_balance')
        const maxWinPct = Number(limits?.max_win_pct ?? 0.10)
        const maxPayout = Number(vaultNet ?? 0) * maxWinPct

        if (safeAmount > maxPayout && maxPayout > 0) {
            return fail(`Withdrawal exceeds max single payout (${maxPayout.toFixed(2)} APE)`, 400)
        }

        // ── 6. Deduct in-game balance atomically ───────────────────────────────
        const { data: deductResult } = await supabaseAdmin.rpc('deduct_flight_balance', {
            p_wallet: wallet,
            p_amount: safeAmount,
        })

        if (!deductResult?.success) {
            return fail(deductResult?.error ?? 'Deduction failed', 400)
        }

        // ── 7. Acquire vault send mutex ────────────────────────────────────────
        // Serialises concurrent blockchain sends from the single vault wallet.
        // Without this, two simultaneous withdrawals can both call sendTransaction
        // and produce two confirmed TXs with different nonces — doubling the payout.
        const { data: lockAcquired } = await supabaseAdmin.rpc('acquire_vault_send_lock', { p_tx_id: txId })
        if (!lockAcquired) {
            return fail('Another withdrawal is being processed — please try again in a moment.', 429)
        }

        // ── 8. Send on-chain & confirm (mutex always released in finally) ──────
        // try-finally guarantees the mutex is released even when an early return
        // fires inside the catch block (JS/TS: finally runs before return exits).
        let txHash = ''
        try {
            try {
                const vaultAccount = privateKeyToAccount({ client: thirdwebClient, privateKey: FLIGHT_VAULT_PK })
                const tx = prepareTransaction({
                    chain:  apeChain,
                    client: thirdwebClient,
                    to:     wallet,
                    value:  toWei(String(safeAmount)),
                })
                const receipt = await sendTransactionWithRetry({
                    transaction: tx,
                    account: vaultAccount,
                    label: 'FlightWithdraw',
                })
                txHash = receipt.transactionHash

            } catch (sendErr: any) {
                // ── Verify on-chain before deciding how to handle ─────────────
                // Network errors (timeout, connection reset) can occur AFTER the TX
                // was broadcast and included in a block. Rolling back without certainty
                // would restore balance while APE were already sent on-chain → double money.
                //
                // Strategy:
                //   Hard failures (node rejected, insufficient funds) → safe rollback.
                //   SDK has transactionHash on error → query on-chain:
                //     confirmed → set txHash, fall through to confirm step.
                //     not mined → pending_investigation, do NOT restore balance.
                //   No hash in error → outcome unknown → pending_investigation.
                console.error('[withdraw] Blockchain send error:', sendErr.message)

                const errMsg = (sendErr?.message ?? '').toLowerCase()
                const isHardFailure =
                    errMsg.includes('insufficient funds') ||
                    errMsg.includes('nonce too low') ||
                    errMsg.includes('nonce has already been used') ||
                    errMsg.includes('execution reverted')

                if (isHardFailure) {
                    // TX rejected by the node before broadcast — safe to roll back
                    await supabaseAdmin.rpc('credit_flight_balance', { p_wallet: wallet, p_amount: safeAmount })
                    await supabaseAdmin.from('flight_transactions').update({ status: 'failed' }).eq('id', txId)
                    return NextResponse.json({ error: 'Blockchain send failed — balance restored. Please try again.' }, { status: 500 })
                    // finally runs → mutex released automatically
                }

                const maybeTxHash: string | undefined = (sendErr as any).transactionHash
                if (maybeTxHash && /^0x[0-9a-fA-F]{64}$/.test(maybeTxHash)) {
                    try {
                        const rpc = await import('thirdweb/rpc')
                        const rpcClient = rpc.getRpcClient({ client: thirdwebClient, chain: apeChain })
                        const onChainTx = await rpcClient({
                            method: 'eth_getTransactionByHash',
                            params: [maybeTxHash as `0x${string}`],
                        }) as any

                        if (onChainTx?.blockNumber) {
                            // TX confirmed — fall through to confirm step below
                            txHash = maybeTxHash
                            console.warn('[withdraw] TX landed despite send error — confirming', { txHash })
                        } else {
                            // TX outcome unknown — hold balance, require support review
                            await supabaseAdmin
                                .from('flight_transactions')
                                .update({ status: 'pending_investigation', tx_hash: maybeTxHash })
                                .eq('id', txId)
                            console.error('[withdraw] TX pending_investigation', { txHash: maybeTxHash, wallet })
                            return NextResponse.json({
                                error: 'Withdrawal status unknown — your balance has been held. Please contact support with your request ID.',
                                request_id: txId,
                            }, { status: 500 })
                        }
                    } catch (checkErr: any) {
                        await supabaseAdmin
                            .from('flight_transactions')
                            .update({ status: 'pending_investigation' })
                            .eq('id', txId)
                        console.error('[withdraw] On-chain check failed — pending_investigation', { txId, wallet, error: checkErr.message })
                        return NextResponse.json({
                            error: 'Withdrawal status unknown — your balance has been held. Please contact support with your request ID.',
                            request_id: txId,
                        }, { status: 500 })
                    }
                } else {
                    // No tx hash available — cannot determine outcome, do NOT rollback
                    await supabaseAdmin
                        .from('flight_transactions')
                        .update({ status: 'pending_investigation' })
                        .eq('id', txId)
                    console.error('[withdraw] TX hash unknown — pending_investigation', { txId, wallet, error: sendErr.message })
                    return NextResponse.json({
                        error: 'Withdrawal status unknown — your balance has been held. Please contact support with your request ID.',
                        request_id: txId,
                    }, { status: 500 })
                }
            }

            // ── 9. Confirm transaction record ──────────────────────────────────
            await supabaseAdmin
                .from('flight_transactions')
                .update({ status: 'confirmed', tx_hash: txHash })
                .eq('id', txId)

        } finally {
            // Always release vault send mutex — runs even when catch returns early.
            // Note: Supabase PostgrestBuilder is thenable but lacks `.catch()`
            // in some runtime/version combinations, so use try/await.
            try {
                await supabaseAdmin.rpc('release_vault_send_lock', { p_tx_id: txId })
            } catch { /* swallow — best-effort release */ }
        }

        // ── 10. Return new balance ─────────────────────────────────────────────
        const { data: newBal } = await supabaseAdmin
            .from('flight_balances')
            .select('balance')
            .ilike('wallet_address', wallet)
            .maybeSingle()

        return NextResponse.json({
            success:     true,
            tx_hash:     txHash,
            new_balance: newBal?.balance ?? 0,
        })

    } catch (err: any) {
        console.error('[flight/withdraw]', err.message)
        // Never expose internal error details to clients
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
