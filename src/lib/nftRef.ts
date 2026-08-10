import type { TokenStandard } from '@/lib/tokenStandard'

/** Результат разбора одной ссылки для импорта призов. */
export interface ResolvedRef {
    ref: string
    ok: boolean
    error?: string
    contract?: string
    tokenId?: string
    standard?: TokenStandard
    name?: string
    imageUrl?: string
    /** Сколько штук у волта: для ERC721 это 0/1, для ERC1155 — реальный баланс. */
    vaultBalance?: number
    inVault?: boolean
}

/**
 * Из ссылки достаём адрес контракта и id токена. Ссылки прилетают разные —
 * OpenSea (старый /assets и новый /item), маркетплейсы поменьше, или просто
 * «контракт/id», скопированный руками. Поэтому не парсим по конкретному
 * домену, а берём первый адрес и первое число после него.
 */
export function parseNftRef(raw: string): { contract: string; tokenId: string } | null {
    const s = raw.trim()
    if (!s) return null

    const addr = s.match(/0x[a-fA-F0-9]{40}/)
    if (!addr) return null
    const contract = addr[0].toLowerCase()

    const tail = s.slice(s.indexOf(addr[0]) + addr[0].length)
    const id = tail.match(/\d+/)
    if (!id) return null

    return { contract, tokenId: id[0] }
}
