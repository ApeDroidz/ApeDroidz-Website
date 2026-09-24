import { getContract } from 'thirdweb'
import { privateKeyToAccount } from 'thirdweb/wallets'
import { transferFrom as erc721Transfer } from 'thirdweb/extensions/erc721'
import { safeTransferFrom as erc1155Transfer } from 'thirdweb/extensions/erc1155'
import { supabaseAdmin } from '@/lib/supabase'
import { apeChainServer, createServerThirdwebClient } from '@/lib/apechain'
import { sendTransactionWithRetry } from '@/lib/sendWithRetry'
import { logEvent } from '@/lib/survivalLog'

/**
 * Sends lucky-ticket NFT prizes from the prize vault — the same vault and the same transfer path as
 * Glitch Cards (PRIZE_VAULT_PRIVATE_KEY, sendTransactionWithRetry, ERC-721 / ERC-1155).
 *
 * A won token is `reserved` for its winner by the booking (survival_settle_order). Here it is taken
 * to `sending` with a compare-and-set, so two requests can never send it twice, then transferred and
 * marked `sent` with the hash. A failed transfer goes to `failed` with the error: the panel shows it
 * as an alert with «Retry», and nothing is sent again without someone pressing it.
 */
type Row = { id: number; contract: string; token_id: string; standard: 'erc721' | 'erc1155'; winner: string; name: string | null }

export async function deliverTicketNfts(opts: { wallet?: string; ids?: number[]; retryFailed?: boolean } = {}): Promise<Array<{ id: number; state: 'sent' | 'failed'; tx?: string; error?: string }>> {
    const pk = process.env.PRIZE_VAULT_PRIVATE_KEY
    if (!pk) return []
    const states = opts.retryFailed ? ['reserved', 'failed'] : ['reserved']
    let q = supabaseAdmin.from('survival_ticket_nfts').select('id, contract, token_id, standard, winner, name').in('status', states).not('winner', 'is', null).limit(10)
    if (opts.wallet) q = q.eq('winner', opts.wallet)
    if (opts.ids?.length) q = q.in('id', opts.ids)
    const { data } = await q
    const out: Array<{ id: number; state: 'sent' | 'failed'; tx?: string; error?: string }> = []
    const client = createServerThirdwebClient()
    const vault = privateKeyToAccount({ client, privateKey: pk })
    for (const r of (data as Row[] | null) ?? []) {
        // Claim the send: only one request moves a row out of reserved/failed.
        const { data: claimed } = await supabaseAdmin.from('survival_ticket_nfts').update({ status: 'sending', error: null })
            .eq('id', r.id).in('status', states).select('id')
        if (!claimed?.length) continue
        try {
            const contract = getContract({ client, chain: apeChainServer, address: r.contract })
            const tx = r.standard === 'erc1155'
                ? erc1155Transfer({ contract, from: vault.address, to: r.winner, tokenId: BigInt(r.token_id), value: BigInt(1), data: '0x' })
                : erc721Transfer({ contract, from: vault.address, to: r.winner, tokenId: BigInt(r.token_id) })
            const receipt = await sendTransactionWithRetry({ transaction: tx, account: vault, label: 'SurvivalTicketNft' })
            await supabaseAdmin.from('survival_ticket_nfts').update({ status: 'sent', tx_hash: receipt.transactionHash, sent_at: new Date().toISOString() }).eq('id', r.id)
            logEvent({ level: 'info', source: 'server', kind: 'ticket.nft_sent', wallet: r.winner, message: `${r.name ?? r.contract} #${r.token_id}`, data: { tx: receipt.transactionHash } })
            out.push({ id: r.id, state: 'sent', tx: receipt.transactionHash })
        } catch (e) {
            const error = ((e as Error).message ?? 'transfer failed').slice(0, 300)
            await supabaseAdmin.from('survival_ticket_nfts').update({ status: 'failed', error }).eq('id', r.id)
            logEvent({ level: 'error', source: 'server', kind: 'ticket.nft_failed', wallet: r.winner, message: error, data: { id: r.id } })
            out.push({ id: r.id, state: 'failed', error })
        }
    }
    return out
}
