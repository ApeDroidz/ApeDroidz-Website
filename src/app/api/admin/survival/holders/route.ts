import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }

const DROID_CONTRACT = (process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || '').toLowerCase()
const CHAIN_ID = 33139 // ApeChain
const CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || ''
const SECRET_KEY = process.env.THIRDWEB_SECRET_KEY || ''
const INSIGHT_BASE = 'https://insight.thirdweb.com/v1/nfts'

/** Сколько адресов спрашиваем у индексера одновременно. */
const CONCURRENCY = 5
/** Больше сотни считать незачем: вопрос «холдер или нет», а не «сколько именно». */
const PAGE = 100

/**
 * GET /api/admin/survival/holders
 *
 * Сколько ApeDroidz на каждом кошельке из беты-листа (владелец, 20.09.2026:
 * «хочу видеть, у кого на кошельке есть дроидз, а у кого нет — то есть наших
 * холдеров»).
 *
 * Считает индексер thirdweb Insight, как и весь остальной сайт: RPC-квота не
 * тратится, домен-allowlist не при чём (см. /api/owned-droids). Таблицу `droidz`
 * для этого использовать нельзя — колонка `owner_address` там пустая на всех
 * 3333 строках, это витрина метаданных, а не реестр владельцев.
 *
 * Отдельным запросом, а не внутри /api/admin/survival: это два-три десятка
 * внешних вызовов, и вешать их на каждое обновление панели незачем — панель
 * подтягивает их фоном, уже показав всё остальное.
 */
export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    if (!DROID_CONTRACT) return NextResponse.json({ error: 'Droid contract not configured' }, { status: 500, headers })

    const { data, error } = await supabaseAdmin.from('survival_allowlist').select('wallet')
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
    const wallets = ((data ?? []) as Array<{ wallet: string }>).map((r) => r.wallet.toLowerCase())

    const authHeaders: Record<string, string> = SECRET_KEY
        ? { 'x-secret-key': SECRET_KEY }
        : { 'x-client-id': CLIENT_ID, 'Origin': 'https://apedroidz.com' }

    // null = не смогли спросить (индексер не ответил). Это НЕ то же самое, что
    // «нет дроидов», и в панели показывается по-другому.
    const counts: Record<string, number | null> = {}
    const countOf = async (wallet: string): Promise<number | null> => {
        try {
            const url = `${INSIGHT_BASE}?chain=${CHAIN_ID}&owner_address=${wallet}`
                + `&contract_address=${DROID_CONTRACT}&limit=${PAGE}&page=0`
            const res = await fetch(url, { headers: authHeaders, cache: 'no-store' })
            if (!res.ok) return null
            const json = await res.json()
            return Array.isArray(json?.data) ? json.data.length : 0
        } catch {
            return null
        }
    }

    const queue = [...wallets]
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let w = queue.shift(); w; w = queue.shift()) counts[w] = await countOf(w)
    }))

    return NextResponse.json({ counts, checkedAt: new Date().toISOString() }, { headers })
}
