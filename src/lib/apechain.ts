import { createThirdwebClient, defineChain } from 'thirdweb'

/**
 * Единая точка настройки ApeChain для серверных роутов.
 *
 * Почему не `defineChain(33139)`: с одним лишь номером сети thirdweb гонит все
 * запросы через собственный шлюз 33139.rpc.thirdweb.com, а он режет по лимиту
 * тарифа. На быстрой игре в Glitch Cards (спин раз в 6 секунд — это несколько
 * RPC-вызовов на спин) шлюз начинал отдавать 429 «You've been rate limited»,
 * и трансфер приза падал. Официальный публичный RPC ApeChain таких лимитов не
 * ставит; переменной окружения его можно подменить на выделенный, не трогая код.
 */
export const APECHAIN_RPC_URL =
    process.env.APECHAIN_RPC_URL || 'https://rpc.apechain.com/http'

export const apeChainServer = defineChain({
    id: 33139,
    rpc: APECHAIN_RPC_URL,
})

/**
 * Клиент для серверных роутов.
 *
 * На сервере нужен секретный ключ: публичный clientId привязан к списку доменов
 * и на бэкенде считается по более жёстким лимитам. Часть роутов (merge, upgrade,
 * buy) давно ходит по секретному ключу, а glitch_game/play и flight остались на
 * публичном — эта функция приводит всех к одному знаменателю. Фолбэк на clientId
 * оставлен, чтобы роут не падал, если секрет не проставлен в окружении.
 */
export function createServerThirdwebClient() {
    const secretKey = process.env.THIRDWEB_SECRET_KEY
    if (secretKey) return createThirdwebClient({ secretKey })

    const clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID
    if (!clientId) throw new Error('Neither THIRDWEB_SECRET_KEY nor NEXT_PUBLIC_THIRDWEB_CLIENT_ID is set')
    console.warn('[apechain] THIRDWEB_SECRET_KEY не задан — работаем по публичному clientId')
    return createThirdwebClient({ clientId })
}
