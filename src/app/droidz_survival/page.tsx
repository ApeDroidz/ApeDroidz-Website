import { supabaseAdmin } from '@/lib/supabase'
import { isTestSku, loadCatalog } from '@/lib/survivalShop'
import { SurvivalLanding, type LandingPrice } from '@/components/survival/landing'

/**
 * /droidz_survival — the landing, for everyone, no sign-in (owner, 03.10.2026: «лендинг для всех в
 * стиле сайта, а не игры»). PLAY leads to /droidz_survival/play, where the sign-in and the game are.
 *
 * The price list is read here, on the server, from the live catalog (survival_catalog — the same rows
 * the game sells; a running sale already taken off by loadCatalog) — there is no public price
 * endpoint, and /api/survival/credits needs a signed-in wallet. Test rows (test_*) never show.
 * The page is regenerated at most once a minute (ISR), so a landing view costs no database read:
 * `fetchCache` lets the supabase-js read (no-store by default, lib/supabase.ts) be cached here.
 * The live numbers — the pool and the board — the page fetches on its own from their public routes.
 */
export const revalidate = 60
export const fetchCache = 'force-cache'

async function loadPrices(): Promise<LandingPrice[]> {
    if (!supabaseAdmin) return []
    try {
        const items = await loadCatalog(true)
        return items
            .filter((i) => !isTestSku(i.sku) && (i.kind === 'runs' || i.kind === 'ticket' || i.kind === 'season_pass'))
            .map((i) => ({
                sku: i.sku,
                kind: i.kind,
                title: i.title,
                priceApe: i.price_ape,
                fullPriceApe: i.list_price_ape,
                salePct: i.sale_pct,
                saleUntil: i.sale_until,
                holderDiscountPct: i.holder_discount_pct,
            }))
    } catch {
        return []
    }
}

export default async function DroidzSurvivalLandingPage() {
    const prices = await loadPrices()
    return <SurvivalLanding prices={prices} />
}
