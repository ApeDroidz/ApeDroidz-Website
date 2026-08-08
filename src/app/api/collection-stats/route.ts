/**
 * Публичная статистика коллекции для лендинга.
 *
 * Тянем /api/v2/collections/{slug}/stats у OpenSea (нужен OPENSEA_API_KEY —
 * тот же, что использует openseaRefresh). Ответ кэшируется на сутки: цифры
 * меняются медленно, а лимиты у бесплатного ключа скромные.
 *
 * ATH в их stats нет: `total` отдаёт объём, продажи, среднюю цену и владельцев.
 * Поэтому ATH берём из ATH_OVERRIDE (правится руками), а если он не задан —
 * отдаём null и лендинг показывает прочерк.
 */
import { NextResponse } from "next/server"

// Раз в сутки — Next сам держит результат в кэше маршрута.
export const revalidate = 86400

const OPENSEA_API = "https://api.opensea.io/api/v2"
const SLUG = process.env.OPENSEA_COLLECTION_SLUG ?? "apedroidz"

/**
 * Пиковая продажа в APE — OpenSea её через API не отдаёт.
 * Правится переменной APEDROIDZ_ATH на Vercel без редеплоя кода.
 */
const ATH_OVERRIDE: number | null = (() => {
  const raw = Number(process.env.APEDROIDZ_ATH)
  return Number.isFinite(raw) && raw > 0 ? raw : 155
})()

export interface CollectionStats {
  volume: number | null
  holders: number | null
  floor: number | null
  sales: number | null
  ath: number | null
  /** валюта floor/volume по версии OpenSea (обычно APE на ApeChain) */
  symbol?: string | null
  /** true, когда цифры пришли от OpenSea, а не из фолбэка */
  live: boolean
}

export async function GET() {
  const key = process.env.OPENSEA_API_KEY
  const empty: CollectionStats = {
    volume: null, holders: null, floor: null, sales: null, ath: ATH_OVERRIDE, live: false,
  }

  if (!key) return NextResponse.json(empty)

  try {
    const res = await fetch(`${OPENSEA_API}/collections/${SLUG}/stats`, {
      headers: { "x-api-key": key, accept: "application/json" },
      next: { revalidate },
    })
    if (!res.ok) return NextResponse.json(empty)

    const data = await res.json()
    const total = data?.total ?? {}
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)

    return NextResponse.json({
      symbol: typeof total.floor_price_symbol === "string" ? total.floor_price_symbol : null,
      volume: num(total.volume),
      holders: num(total.num_owners),
      floor: num(total.floor_price),
      sales: num(total.sales),
      ath: ATH_OVERRIDE,
      live: true,
    } satisfies CollectionStats)
  } catch {
    return NextResponse.json(empty)
  }
}
