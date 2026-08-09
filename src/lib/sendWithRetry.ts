import { sendTransaction } from 'thirdweb';
import type { PreparedTransaction } from 'thirdweb';
import type { Account } from 'thirdweb/wallets';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const RATE_LIMIT_DELAY_MS = 1200;

/**
 * Sends a blockchain transaction with automatic retry on nonce-related errors.
 * 
 * When multiple transactions are sent from the same wallet concurrently,
 * the nonce can get out of sync. This wrapper detects "nonce too low" errors
 * and retries with a fresh nonce (via re-calling sendTransaction).
 */
export async function sendTransactionWithRetry({
    transaction,
    account,
    label = 'TX',
}: {
    transaction: PreparedTransaction;
    account: Account;
    label?: string;
}) {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const receipt = await sendTransaction({ transaction, account });
            if (attempt > 1) {
                console.log(`✅ [${label}] Retry #${attempt} succeeded. TX: ${receipt.transactionHash}`);
            }
            return receipt;
        } catch (err: any) {
            lastError = err;
            const msg = (err?.message || '').toLowerCase();

            const isNonceError =
                msg.includes('nonce too low') ||
                msg.includes('nonce has already been used') ||
                msg.includes('replacement transaction underpriced') ||
                msg.includes('already known');

            // Провайдер притормаживает нас (HTTP 429). Ошибка целиком временная:
            // достаточно подождать и повторить. Раньше она летела наружу сразу,
            // и игрок терял спин из-за секундного всплеска нагрузки.
            const isRateLimited =
                msg.includes('429') ||
                msg.includes('too many requests') ||
                msg.includes('rate limit');

            const retryable = isNonceError || isRateLimited;

            if (!retryable || attempt === MAX_RETRIES) {
                throw err;
            }

            // На лимите ждём заметно дольше: окно провайдера считается секундами,
            // и повтор через 500мс упрётся в тот же лимит.
            const delay = isRateLimited
                ? RATE_LIMIT_DELAY_MS * attempt      // 1200ms, 2400ms
                : BASE_DELAY_MS * attempt;           // 500ms, 1000ms
            console.warn(
                `⚠️ [${label}] ${isRateLimited ? 'Rate limited' : 'Nonce error'} on attempt ` +
                `${attempt}/${MAX_RETRIES}: "${err.message}". Retrying in ${delay}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    // Should not reach here, but safety net
    throw lastError || new Error('sendTransactionWithRetry exhausted all retries');
}
