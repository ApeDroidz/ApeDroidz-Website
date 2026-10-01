import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireWalletAuthMatch } from '@/lib/walletAuth'
import { computeNftProgress, writeUserRow } from '@/lib/userNftProgress'

export const dynamic = 'force-dynamic'

/**
 * POST /api/user/sync-progress
 * Body: { wallet? } — только для сверки с кукой (403 при расхождении, чтобы
 * после смены кошелька не показать чужие числа). Пишем всегда по кошельку из
 * куки; числа сервер считает сам, из тела ничего не берёт.
 *
 * Замена клиентского upsert в `users` из user-progress-provider.tsx: раньше
 * браузер присылал xp/droids_count анонимным ключом, и их мог переписать кто
 * угодно для любого кошелька (xp — глобальный лидерборд, droids_count —
 * запасной признак холдера в quest/claim и dashboard).
 *
 * Ответ: { ok, nftXp, droids, batteries }.
 */

// Лёгкий тормоз на кошелёк: провайдер дёргает синк на каждое
// `user_progress_updated`, а каждый синк — это запросы к индексеру.
const MIN_INTERVAL_MS = 10_000
const lastSync = new Map<string, number>()

export async function POST(req: Request) {
    let body: any = null
    try { body = await req.json() } catch { /* тело необязательно */ }
    const auth = requireWalletAuthMatch(req, body?.wallet)
    if (auth instanceof Response) return auth
    const wallet = auth.wallet

    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
    }

    const now = Date.now()
    const prev = lastSync.get(wallet) ?? 0
    if (now - prev < MIN_INTERVAL_MS) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    lastSync.set(wallet, now)
    if (lastSync.size > 5000) {
        for (const [w, t] of lastSync) if (now - t > MIN_INTERVAL_MS) lastSync.delete(w)
    }

    let progress
    try {
        progress = await computeNftProgress(wallet)
    } catch (e: any) {
        console.warn('[sync-progress] compute failed:', e?.message)
        // Не пишем ничего, если индексер/БД не ответили: лучше старые верные
        // числа, чем обнулённые.
        lastSync.delete(wallet)
        return NextResponse.json({ error: 'Indexer unavailable, try again' }, { status: 502 })
    }

    try {
        await writeUserRow(wallet, {
            xp: progress.nftXp,   // только NFT-XP — сезонный XP живёт в таблицах сезонов
            droids_count: progress.droids,
            batteries_count: progress.batteries,
            updated_at: new Date().toISOString(),
        })
    } catch (e: any) {
        console.error('[sync-progress] write failed:', e?.message)
        return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, ...progress })
}
