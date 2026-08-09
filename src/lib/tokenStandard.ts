import { getContract, readContract } from 'thirdweb'
import type { Chain, ThirdwebClient } from 'thirdweb'

/**
 * Определение стандарта токена по ERC-165.
 *
 * Зачем: выдача призов всегда звала ERC721 `transferFrom`, а Honorary-контракт
 * на ApeChain (0x427ff4b9…) — ERC1155. Транзакция отлетала с
 * `UnsupportedFunctionSelector - 0x23b872dd` (это как раз селектор ERC721
 * transferFrom), и приз не уезжал победителю.
 *
 * Определяем на лету, а не колонкой в базе, чтобы новые призы можно было
 * заводить простой ссылкой на NFT — админу не нужно знать стандарт контракта.
 */

const ERC721_INTERFACE = '0x80ac58cd'
const ERC1155_INTERFACE = '0xd9b67a26'

export type TokenStandard = 'erc721' | 'erc1155'

// Стандарт контракта неизменен, поэтому держим результат в памяти процесса.
const cache = new Map<string, TokenStandard>()

export async function detectTokenStandard({
    client,
    chain,
    address,
}: {
    client: ThirdwebClient
    chain: Chain
    address: string
}): Promise<TokenStandard> {
    const key = `${chain.id}:${address.toLowerCase()}`
    const cached = cache.get(key)
    if (cached) return cached

    const contract = getContract({ client, chain, address })
    const supports = (interfaceId: string) =>
        readContract({
            contract,
            method: 'function supportsInterface(bytes4 interfaceId) view returns (bool)',
            params: [interfaceId as `0x${string}`],
        }).catch(() => false)

    // Спрашиваем оба: контракт без ERC-165 ответит отказом на любой из них,
    // и тогда безопаснее считать его ERC721 — так вело себя всё до этой правки.
    const [is1155, is721] = await Promise.all([
        supports(ERC1155_INTERFACE),
        supports(ERC721_INTERFACE),
    ])

    const standard: TokenStandard = is1155 && !is721 ? 'erc1155' : 'erc721'
    cache.set(key, standard)
    return standard
}
