import { NextResponse } from 'next/server'
import { privateKeyToAccount } from 'thirdweb/wallets'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { createServerThirdwebClient } from '@/lib/apechain'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/inventory/price   { ids: string[] }
 *
 * Pulls what each NFT cost us from OpenSea instead of asking anyone to type
 * it in: the last sale that happened before the token was transferred into
 * the prize vault. That transfer is the moment it became ours, so any sale
 * after it belongs to somebody else's trade and must not count.
 *
 * A token that reached us without a sale — minted, airdropped, swapped —
 * has no acquisition price, and the row says so rather than guessing zero:
 * a zero would silently understate what the prizes cost.
 */

const OPENSEA_API = 'https://api.opensea.io/api/v2'
const CHAIN = 'ape_chain'
const MAX_IDS = 100

interface PriceResult {
    id: string
    ok: boolean
    ape?: number | null
    reason?: string
}

export async function POST(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const key = process.env.OPENSEA_API_KEY
    if (!key) return NextResponse.json({ error: 'OPENSEA_API_KEY not set' }, { status: 500 })

    const pk = process.env.PRIZE_VAULT_PRIVATE_KEY
    if (!pk) return NextResponse.json({ error: 'PRIZE_VAULT_PRIVATE_KEY not set' }, { status: 500 })

    let body: any
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : []
    if (!ids.length) return NextResponse.json({ error: 'ids required' }, { status: 400 })
    if (ids.length > MAX_IDS) return NextResponse.json({ error: `too many ids (max ${MAX_IDS})` }, { status: 400 })

    const vault = privateKeyToAccount({
        client: createServerThirdwebClient(), privateKey: pk,
    }).address.toLowerCase()

    const { data: rows, error } = await supabaseAdmin
        .from('nft_inventory')
        .select('id, contract_address, token_id')
        .in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    async function priceOf(contract: string, tokenId: string): Promise<{ ape: number | null; reason?: string }> {
        const url = new URL(`${OPENSEA_API}/events/chain/${CHAIN}/contract/${contract}/nfts/${tokenId}`)
        url.searchParams.append('event_type', 'sale')
        url.searchParams.append('event_type', 'transfer')
        url.searchParams.set('limit', '50')

        const res = await fetch(url.toString(), {
            headers: { 'X-API-KEY': key!, accept: 'application/json' },
            signal: AbortSignal.timeout(20_000),
        })
        if (!res.ok) return { ape: null, reason: `opensea ${res.status}` }

        const json = await res.json()
        const events: any[] = json?.asset_events ?? []
        const ts = (e: any) => Number(e?.event_timestamp ?? 0)

        // Момент, когда токен стал нашим.
        const intoVault = events
            .filter(e => e.event_type === 'transfer' && String(e.to_address ?? '').toLowerCase() === vault)
            .sort((a, b) => ts(b) - ts(a))[0]

        const sales = events
            .filter(e => e.event_type === 'sale' && e.payment)
            .sort((a, b) => ts(b) - ts(a))

        if (!sales.length) return { ape: null, reason: 'продаж не было' }

        const cutoff = intoVault ? ts(intoVault) : Infinity
        const sale = sales.find(s => ts(s) <= cutoff)
        if (!sale) return { ape: null, reason: 'все продажи позже передачи в волт' }

        const q = Number(sale.payment.quantity)
        const dec = Number(sale.payment.decimals ?? 18)
        if (!Number.isFinite(q)) return { ape: null, reason: 'цена не распознана' }

        return { ape: q / 10 ** dec }
    }

    const results: PriceResult[] = []
    // Последовательно: у OpenSea жёсткий лимит запросов, а параллельный
    // залп по сотне токенов упрётся в 429 и вернёт мусор вместо цен.
    for (const row of rows ?? []) {
        try {
            const { ape, reason } = await priceOf(String(row.contract_address).toLowerCase(), String(row.token_id))
            if (ape != null) {
                await supabaseAdmin.from('nft_inventory')
                    .update({ acquisition_ape: ape }).eq('id', row.id)
            }
            results.push({ id: String(row.id), ok: ape != null, ape, reason })
        } catch (e: any) {
            results.push({ id: String(row.id), ok: false, reason: e?.message ?? 'failed' })
        }
    }

    const priced = results.filter(r => r.ok).length
    return NextResponse.json({
        success: true,
        priced,
        skipped: results.length - priced,
        results,
    }, { headers: { 'cache-control': 'no-store' } })
}
