import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/stats/profit
 *
 * Экономика Glitch Cards.
 *
 * Приход — APE за купленные билеты. Расход — то, во что нам обошлись призы:
 * выплаченные APE плюс себестоимость выданных NFT (колонка acquisition_ape,
 * цена приобретения). Батарейки и шарды мы выпускаем сами, себестоимости у
 * них нет — они остаются с NULL и в расход не попадают.
 *
 * Считается и в целом, и по кошелькам: видно, кто сколько наиграл, сколько
 * занёс и во сколько обошлись его призы.
 */

const PAGE = 1000

/**
 * Тянем всю таблицу постранично: PostgREST отдаёт максимум 1000 строк за раз.
 *
 * Каждая страница обязана быть отсортирована по стабильному ключу. Без
 * ORDER BY порядок строк между запросами не определён, страницы перекрываются,
 * и часть строк не попадает в выборку вообще — так потерялись позиции с уже
 * проставленной ценой, и себестоимость выданных NFT показывалась нулевой.
 */
async function fetchAll<T>(
    build: (from: number, to: number) => any,
): Promise<T[]> {
    const out: T[] = []
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1)
        if (error) throw error
        const rows = (data ?? []) as T[]
        out.push(...rows)
        if (rows.length < PAGE) break
    }
    return out
}

export async function GET(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    try {
        const { data: prizeRows, error: prizeErr } = await supabaseAdmin
            .from('prize_types').select('id, type, amount')
        if (prizeErr) throw prizeErr
        const tokenPrizes = new Map<string, number>(
            (prizeRows ?? []).filter((p: any) => p.type === 'token')
                .map((p: any) => [p.id, Number(p.amount) || 0])
        )

        // Себестоимость NFT. Колонки может ещё не быть — тогда считаем расход
        // только по APE и честно говорим об этом в ответе.
        let costColumnMissing = false
        let claimed: any[] = []
        try {
            claimed = await fetchAll<any>((from, to) =>
                supabaseAdmin.from('nft_inventory')
                    .select('prize_type_id, winner_wallet, acquisition_ape')
                    .eq('status', 'claimed')
                    .order('id', { ascending: true })
                    .range(from, to)
            )
        } catch (e: any) {
            if (/acquisition_ape/.test(e?.message ?? '')) costColumnMissing = true
            else throw e
        }

        const [purchases, plays] = await Promise.all([
            fetchAll<any>((from, to) =>
                supabaseAdmin.from('ticket_purchases')
                    .select('wallet_address, ape_amount, ticket_count, status')
                    .order('id', { ascending: true })
                    .range(from, to)
            ),
            fetchAll<any>((from, to) =>
                supabaseAdmin.from('game_logs')
                    .select('wallet_address, prize_type_id, prize_amount_or_id, status')
                    .eq('status', 'success')
                    .order('id', { ascending: true })
                    .range(from, to)
            ),
        ])

        type Row = { wallet: string; spent: number; tickets: number; plays: number; apeWon: number; nftCost: number; nftWon: number }
        const byWallet = new Map<string, Row>()
        const row = (w: string): Row => {
            const k = (w ?? '').toLowerCase()
            let r = byWallet.get(k)
            if (!r) { r = { wallet: k, spent: 0, tickets: 0, plays: 0, apeWon: 0, nftCost: 0, nftWon: 0 }; byWallet.set(k, r) }
            return r
        }

        // Покупка засчитывается, только когда оплата подтверждена ончейн —
        // в этой таблице такой статус называется verified.
        const PAID = new Set(['verified', 'confirmed', 'success'])
        for (const p of purchases) {
            if (p.status && !PAID.has(String(p.status))) continue
            const r = row(p.wallet_address)
            r.spent += Number(p.ape_amount) || 0
            r.tickets += Number(p.ticket_count) || 0
        }

        for (const g of plays) {
            const r = row(g.wallet_address)
            r.plays += 1
            if (tokenPrizes.has(g.prize_type_id)) {
                // В логе лежит фактически выданная сумма; на старых записях её
                // может не быть — тогда берём номинал приза из каталога.
                const logged = Number(g.prize_amount_or_id)
                r.apeWon += Number.isFinite(logged) && logged > 0
                    ? logged
                    : (tokenPrizes.get(g.prize_type_id) ?? 0)
            }
        }

        for (const c of claimed) {
            if (!c.winner_wallet) continue
            const r = row(c.winner_wallet)
            r.nftWon += 1
            r.nftCost += Number(c.acquisition_ape) || 0
        }

        const wallets = [...byWallet.values()].map(r => ({
            ...r,
            profit: r.spent - r.apeWon - r.nftCost,
        }))

        const totals = wallets.reduce((t, r) => ({
            spent: t.spent + r.spent,
            tickets: t.tickets + r.tickets,
            plays: t.plays + r.plays,
            apeWon: t.apeWon + r.apeWon,
            nftCost: t.nftCost + r.nftCost,
            nftWon: t.nftWon + r.nftWon,
        }), { spent: 0, tickets: 0, plays: 0, apeWon: 0, nftCost: 0, nftWon: 0 })

        // Сколько выданных NFT ещё без проставленной цены — по ним расход
        // занижен, и об этом нужно знать, глядя на профит.
        const pricedClaims = claimed.filter((c: any) => Number(c.acquisition_ape) > 0).length
        const unpricedClaims = claimed.length - pricedClaims

        return NextResponse.json({
            generatedAt: new Date().toISOString(),
            costColumnMissing,
            totals: { ...totals, profit: totals.spent - totals.apeWon - totals.nftCost },
            coverage: { claimedNfts: claimed.length, priced: pricedClaims, unpriced: unpricedClaims },
            wallets: wallets.sort((a, b) => b.spent - a.spent).slice(0, 100),
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
