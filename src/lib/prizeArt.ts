// Как выглядит приз-дроид в Glitch Cards.
//
// В nft_inventory у дроидов лежат ссылки на пиксельный арт в старом хранилище
// Supabase — они попали туда задолго до 3D-релиза и до переезда ассетов на R2.
// Править 37 строк руками смысла нет: адрес картинки однозначно выводится из
// токена, поэтому вид резолвится на лету и новые призы подхватят его сами.

import { supabaseAdmin } from './supabase'
import { droid3dPfpThumbUrl } from './media'

const DROID_CONTRACT = (process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || '').trim().toLowerCase()

/** Приз из нашей базовой коллекции? У honorary и чужих коллекций 3D нет. */
export const isDroidPrize = (contract?: string | null): boolean =>
    !!DROID_CONTRACT && (contract || '').trim().toLowerCase() === DROID_CONTRACT

type PrizeRef = { contract_address?: string | null; token_id?: string | number | null }

/**
 * Одним запросом собирает 3D-бюсты для всех призов-дроидов из списка.
 * Ключ — token_id строкой, как он лежит в логах игры.
 *
 * Набор выбирается по состоянию токена: SUPER рисуется на оранжевом фоне,
 * остальные на синем. Если запрос к базе не удался, возвращается пустая карта
 * и вызывающий код просто оставляет картинку, которая была.
 */
export async function droid3dPrizeImages(items: PrizeRef[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()

    const ids = [...new Set(
        items
            .filter((i) => isDroidPrize(i.contract_address))
            .map((i) => parseInt(String(i.token_id)))
            .filter((n) => Number.isInteger(n) && n > 0)
    )]
    if (ids.length === 0) return out

    const { data, error } = await supabaseAdmin
        .from('droidz')
        .select('token_id, level, is_super')
        .in('token_id', ids)

    if (error) {
        console.error('[prizeArt] не удалось прочитать droidz:', error.message)
        return out
    }

    const state = new Map<number, { level: number; isSuper: boolean }>()
    for (const row of data || []) {
        state.set(row.token_id, { level: row.level || 1, isSuper: !!row.is_super })
    }

    for (const id of ids) {
        const s = state.get(id) || { level: 1, isSuper: false }
        // ?v=1 — тот же ключ кэша, что у ленты коллекции на лендинге: часть
        // 512px превью Cloudflare успел закэшировать как 404, пока шла заливка.
        out.set(String(id), `${droid3dPfpThumbUrl(id, s.level, s.isSuper)}?v=1`)
    }

    return out
}
