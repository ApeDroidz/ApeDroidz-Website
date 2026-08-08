/**
 * Публичная статистика коллекции для лендинга.
 *
 * Тянем /api/v2/collections/{slug}/stats у OpenSea (нужен OPENSEA_API_KEY —
 * тот же, что использует openseaRefresh). Ответ кэшируется на сутки: цифры
 * меняются медленно, лимиты у ключа скромные, и в OpenSea/CoinGecko ходит
 * приложение раз в день, а не каждый посетитель.
 *
 * Про объём: OpenSea отдаёт `total.volume` в ETH, хотя floor и symbol на
 * ApeChain приходят в APE — 11 ETH против 4388 продаж при floor'е ~46 APE
 * сходится только так. Поэтому переводим объём в APE по курсу CoinGecko.
 *
 * ATH в их API нет вовсе: правится переменной APEDROIDZ_ATH.
 */
import { NextResponse } from "next/server"

// Раз в сутки — Next сам держит результат в кэше маршрута.
export const revalidate = 86400

const OPENSEA_API = "https://api.opensea.io/api/v2"
const SLUG = process.env.OPENSEA_COLLECTION_SLUG ?? "apedroidz"
const COINGECKO = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,apecoin&vs_currencies=usd"

/**
 * Пиковая продажа в APE — OpenSea её через API не отдаёт.
 * Правится переменной APEDROIDZ_ATH на Vercel без редеплоя кода.
 */
const ATH_OVERRIDE: number | null = (() => {
  const raw = Number(process.env.APEDROIDZ_ATH)
  return Number.isFinite(raw) && raw > 0 ? raw : 155
})()

export interface CollectionStats {
  /** суммарный объём, пересчитанный в APE */
  volume: number | null
  /** он же в исходных единицах OpenSea (ETH) — для сверки */
  volumeEth: number | null
  /** курс ETH→APE, по которому считали */
  ethToApe: number | null
  holders: number | null
  floor: number | null
  sales: number | null
  ath: number | null
  /** валюта floor по версии OpenSea (на ApeChain — APE) */
  symbol?: string | null
  /** true, когда цифры пришли от OpenSea, а не из фолбэка */
  live: boolean
}

const EMPTY: CollectionStats = {
  volume: null, volumeEth: null, ethToApe: null,
  holders: null, floor: null, sales: null, ath: ATH_OVERRIDE, live: false,
}

/** Сколько APE в одном ETH; null — если курс недоступен. */
async function fetchEthToApe(): Promise<number | null> {
  try {
    const res = await fetch(COINGECKO, { next: { revalidate } })
    if (!res.ok) return null
    const data = await res.json()
    const eth = Number(data?.ethereum?.usd)
    const ape = Number(data?.apecoin?.usd)
    if (!Number.isFinite(eth) || !Number.isFinite(ape) || ape <= 0) return null
    return eth / ape
  } catch {
    return null
  }
}

export async function GET() {
  const key = process.env.OPENSEA_API_KEY
  if (!key) return NextResponse.json(EMPTY)

  try {
    const [statsRes, ethToApe] = await Promise.all([
      fetch(`${OPENSEA_API}/collections/${SLUG}/stats`, {
        headers: { "x-api-key": key, accept: "application/json" },
        next: { revalidate },
      }),
      fetchEthToApe(),
    ])
    if (!statsRes.ok) return NextResponse.json(EMPTY)

    const data = await statsRes.json()
    const total = data?.total ?? {}
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)

    const volumeEth = num(total.volume)
    const volume = volumeEth != null && ethToApe != null ? volumeEth * ethToApe : null

    return NextResponse.json({
      volume,
      volumeEth,
      ethToApe,
      holders: num(total.num_owners),
      floor: num(total.floor_price),
      sales: num(total.sales),
      ath: ATH_OVERRIDE,
      symbol: typeof total.floor_price_symbol === "string" ? total.floor_price_symbol : null,
      live: true,
    } satisfies CollectionStats)
  } catch {
    return NextResponse.json(EMPTY)
  }
}
