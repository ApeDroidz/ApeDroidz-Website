import { supabaseAdmin } from '@/lib/supabase'

/**
 * Серверный подсчёт NFT-прогресса кошелька для таблицы `users`
 * (xp = только NFT-XP, droids_count, batteries_count).
 *
 * Раньше это считал браузер и сам делал upsert в `users` анонимным ключом —
 * то есть любой мог записать любому кошельку любые xp/droids_count. Теперь
 * числа из браузера не принимаются: владение берём у индексера thirdweb
 * Insight (тот же путь, что /api/owned-droids и /api/owned-batteries — без
 * RPC-квоты), уровни и сожжённые батарейки — из своей БД.
 *
 * Правила XP те же, что были в user-progress-provider.tsx:
 *   дроид: super 2000, level 2 → 1500, иначе 1000
 *   батарейка: Super 250, иначе 100 (сожжённые не считаются)
 */

const CHAIN_ID = 33139 // ApeChain
const INSIGHT_BASE = 'https://insight.thirdweb.com/v1/nfts'
const DROID_CONTRACT = (process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || '').toLowerCase()
const BATTERY_CONTRACT = (process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || '').toLowerCase()

const LEVEL_TRAIT_KEYS = ['level', 'rank value', 'upgrade level']

interface InsightNft {
    id: number
    name: string
    attributes: any[]
}

function insightHeaders(): Record<string, string> {
    const secret = process.env.THIRDWEB_SECRET_KEY || ''
    return secret
        ? { 'x-secret-key': secret }
        : { 'x-client-id': process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || '', 'Origin': 'https://apedroidz.com' }
}

/** Все NFT контракта у владельца. Бросает, если индексер не ответил. */
async function ownedFromInsight(owner: string, contract: string): Promise<InsightNft[]> {
    const out: InsightNft[] = []
    const LIMIT = 100
    for (let page = 0; page < 50; page++) {
        const url = `${INSIGHT_BASE}?chain=${CHAIN_ID}&owner_address=${owner}` +
            `&contract_address=${contract}&limit=${LIMIT}&page=${page}`
        const res = await fetch(url, { headers: insightHeaders(), cache: 'no-store' })
        if (!res.ok) {
            // Без первой страницы считать нечего; обрыв на середине — тоже не
            // пишем неполные числа поверх верных.
            throw new Error(`insight ${res.status}`)
        }
        const json = await res.json()
        const data: any[] = json?.data || []
        for (const nft of data) {
            const id = parseInt(String(nft.token_id))
            if (!Number.isInteger(id) || id < 0) continue
            const meta = nft.extra_metadata || nft.metadata || {}
            out.push({
                id,
                name: String(nft.name ?? meta.name ?? ''),
                attributes: Array.isArray(meta.attributes) ? meta.attributes
                    : Array.isArray(nft.attributes) ? nft.attributes : [],
            })
        }
        if (data.length < LIMIT) break
    }
    const seen = new Set<number>()
    return out.filter(n => (seen.has(n.id) ? false : (seen.add(n.id), true)))
}

export interface NftProgress {
    nftXp: number
    droids: number
    batteries: number
}

export async function computeNftProgress(wallet: string): Promise<NftProgress> {
    if (!DROID_CONTRACT) throw new Error('Droid contract not configured')

    const [droids, batts] = await Promise.all([
        ownedFromInsight(wallet, DROID_CONTRACT),
        BATTERY_CONTRACT ? ownedFromInsight(wallet, BATTERY_CONTRACT) : Promise.resolve([] as InsightNft[]),
    ])

    let nftXp = 0

    // Дроиды: уровни из таблицы droidz, при её отсутствии — из метаданных.
    if (droids.length > 0) {
        const { data: rows, error } = await supabaseAdmin
            .from('droidz')
            .select('token_id, level, is_super')
            .in('token_id', droids.map(d => d.id))
        if (error) throw new Error(`droidz: ${error.message}`)
        const byId = new Map<number, any>((rows || []).map((r: any) => [Number(r.token_id), r]))
        for (const nft of droids) {
            const row = byId.get(nft.id)
            if (row) {
                if (row.is_super) nftXp += 2000
                else if (row.level === 2) nftXp += 1500
                else nftXp += 1000
                continue
            }
            let lvl = 1
            let isSuper = nft.name.toLowerCase().includes('super')
            const lvlAttr = nft.attributes.find((a: any) =>
                LEVEL_TRAIT_KEYS.includes(String(a?.trait_type || '').toLowerCase()))
            if (lvlAttr) {
                const val = parseInt(String(lvlAttr.value).replace(/\D/g, ''))
                if (!isNaN(val)) lvl = val
            }
            if (nft.attributes.some((a: any) => String(a?.value).toLowerCase().includes('super'))) isSuper = true
            nftXp += isSuper ? 2000 : lvl >= 2 ? 1500 : 1000
        }
    }

    // Батарейки: сожжённые отсекаем по БД (индексер отстаёт после сжигания).
    let batteries = 0
    if (batts.length > 0) {
        const { data: rows, error } = await supabaseAdmin
            .from('batteries')
            .select('token_id, type, is_burned')
            .in('token_id', batts.map(b => b.id))
        if (error) throw new Error(`batteries: ${error.message}`)
        const byId = new Map<number, any>((rows || []).map((r: any) => [Number(r.token_id), r]))
        for (const b of batts) {
            const row = byId.get(b.id)
            if (row?.is_burned) continue
            batteries++
            const isSuper = row?.type ? row.type === 'Super' : b.name.includes('Super')
            nftXp += isSuper ? 250 : 100
        }
    }

    return { nftXp, droids: droids.length, batteries }
}

/**
 * Обновить строки `users` кошелька (все варианты регистра адреса — старые
 * строки писались с checksum-регистром) или создать строку в нижнем регистре.
 * `wallet` обязан быть уже провалидирован (0x + 40 hex) — он идёт в ilike.
 */
export async function writeUserRow(wallet: string, patch: Record<string, unknown>): Promise<void> {
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new Error('Invalid wallet')
    const { data: updated, error } = await supabaseAdmin
        .from('users')
        .update(patch)
        .ilike('wallet_address', wallet)
        .select('wallet_address')
    if (error) throw new Error(error.message)
    if (updated && updated.length > 0) return

    const { error: insertError } = await supabaseAdmin
        .from('users')
        .insert({ wallet_address: wallet, ...patch })
    if (insertError) throw new Error(insertError.message)
}
