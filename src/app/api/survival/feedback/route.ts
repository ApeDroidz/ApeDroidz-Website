import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { logEvent } from '@/lib/survivalLog'

/**
 * Отзыв о закрытой бете — за Ape Mini.
 *
 *   GET  /api/survival/feedback  → сколько забегов за плечами, открыта ли форма,
 *                                  тариф и уже отправленный отзыв (или null)
 *   POST /api/survival/feedback { rating, comment?, clientVersion? }
 *                               → { ok, awarded, totalAwarded } — `awarded` игра
 *                                 прибавляет себе через Save.addCoins() и ничего больше
 *
 * Считать и выдавать здесь нечего: и порог, и тариф, и защита от повторной выдачи живут
 * в survival_submit_feedback (20260920_survival_beta_feedback.sql) — одной транзакцией,
 * потому что между «прочитал, сколько уже выдано» и «выдал» помещается второй клик.
 * Роут только проверяет сессию, приводит тело к числам и строкам и пересказывает ответ.
 */
export const dynamic = 'force-dynamic'

/** Дублируется в игре (systems/Feedback.ts) только как подпись на кнопке; выдаёт всегда база. */
const MIN_RUNS = 3
const REWARD = { rating: 200, comment: 800, commentMin: 50 } as const
const MAX_COMMENT = 2000

interface FeedbackRow {
    rating: number
    comment: string | null
    coins_awarded: number
    updated_at: string
    edited_count: number
}

async function finishedRuns(wallet: string): Promise<number> {
    const { count } = await supabaseAdmin!
        .from('survival_runs')
        .select('*', { count: 'exact', head: true })
        .eq('wallet', wallet)
        .eq('status', 'finished')
    return count ?? 0
}

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()

    const [{ data, error }, runs] = await Promise.all([
        supabaseAdmin.from('survival_feedback')
            .select('rating, comment, coins_awarded, updated_at, edited_count')
            .eq('wallet', caller.wallet).maybeSingle(),
        finishedRuns(caller.wallet),
    ])
    if (error) { console.error('[survival/feedback] get', error.message); return noServer() }

    const row = data as FeedbackRow | null
    return NextResponse.json({
        ok: true,
        runs,
        minRuns: MIN_RUNS,
        // Право дописать мысль уже заслужено: тому, кто отправил, форма открыта всегда.
        eligible: row !== null || runs >= MIN_RUNS,
        reward: REWARD,
        feedback: row
            ? { rating: row.rating, comment: row.comment, coinsAwarded: row.coins_awarded, updatedAt: row.updated_at }
            : null,
    }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()

    const body = await readBody(req)
    const rating = typeof body.rating === 'number' && Number.isFinite(body.rating) ? Math.floor(body.rating) : 0
    if (rating < 1 || rating > 5) {
        return NextResponse.json({ ok: false, state: 'bad_rating' }, { status: 400 })
    }
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, MAX_COMMENT) : null
    const clientVersion = typeof body.clientVersion === 'string' ? body.clientVersion.slice(0, 64) : null

    // Профиль обязан существовать по внешнему ключу: у отыгравшего три забега он есть,
    // но отдельная строка дешевле, чем 500 на ровном месте у крайнего случая.
    await supabaseAdmin.from('survival_players')
        .upsert({ wallet: caller.wallet, last_seen: new Date().toISOString() }, { onConflict: 'wallet' })

    const { data, error } = await supabaseAdmin.rpc('survival_submit_feedback', {
        p_wallet: caller.wallet,
        p_rating: rating,
        p_comment: comment,
        p_client_version: clientVersion,
    })
    if (error) {
        console.error('[survival/feedback] submit', error.message)
        logEvent({ level: 'error', kind: 'feedback.failed', wallet: caller.wallet, message: error.message, clientVersion: clientVersion ?? undefined })
        return noServer()
    }
    if (!data?.ok) {
        return NextResponse.json({ ok: false, state: data?.error ?? 'refused', runs: data?.runs ?? 0 }, { status: 400 })
    }

    logEvent({
        level: 'info', kind: 'feedback.submitted', wallet: caller.wallet,
        message: `${rating}★${comment ? ` · ${comment.length} симв.` : ''} → +${data.awarded} Ape Mini`,
        data: { rating, commentLength: comment?.length ?? 0, awarded: data.awarded, totalAwarded: data.total_awarded, mirrored: data.mirrored },
        clientVersion: clientVersion ?? undefined,
    })

    return NextResponse.json({
        ok: true,
        awarded: data.awarded ?? 0,
        totalAwarded: data.total_awarded ?? 0,
        rating: data.rating ?? rating,
        comment: data.comment ?? null,
    }, { headers: { 'cache-control': 'no-store' } })
}
