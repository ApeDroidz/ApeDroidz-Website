import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { droidCount } from '@/lib/droidHolder'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }

/** Сколько адресов спрашиваем у индексера одновременно. */
const CONCURRENCY = 5

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
    if (!process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS) return NextResponse.json({ error: 'Droid contract not configured' }, { status: 500, headers })

    const { data, error } = await supabaseAdmin.from('survival_allowlist').select('wallet')
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
    const wallets = ((data ?? []) as Array<{ wallet: string }>).map((r) => r.wallet.toLowerCase())

    // null = не смогли спросить (индексер не ответил). Это НЕ то же самое, что
    // «нет дроидов», и в панели показывается по-другому.
    const counts: Record<string, number | null> = {}
    const countOf = droidCount

    const queue = [...wallets]
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let w = queue.shift(); w; w = queue.shift()) counts[w] = await countOf(w)
    }))

    return NextResponse.json({ counts, checkedAt: new Date().toISOString() }, { headers })
}
