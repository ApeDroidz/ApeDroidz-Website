import sharp from 'sharp'
import { supabaseAdmin } from '@/lib/supabase'
import { SITE_BASE, MEDIA_BASE } from '@/lib/media'
import { poolApeOf } from '@/lib/survivalPoolLevels'
import { ARCADE_MML_TEMPLATE } from './mml.template'
import { BOARD_LAYOUT, BOARD_BASE_PNG, BOARD_DIGITS_PNG, PRICE_LAYOUT, PRICE_BASE_PNG, PRICE_TILES_PNG } from './board.assets'
import { loadCatalog } from '@/lib/survivalShop'

/**
 * The Droidz Survival arcade cabinet for Otherside, served by the site.
 *
 * The cabinet is a set of GLB modules on R2 (3D/Arcade/ builds them) placed by one MML document,
 * which /api/otherside/arcade.mml renders per request with two live parts:
 *   · the prize-pool board — an image of the CURRENT sum (/api/otherside/arcade-pool.png?p=<sum>);
 *     the sum is in its URL, so a client that cached the old picture fetches the new one;
 *   · the screen video — editable in the admin panel (site_settings.otherside_arcade.video_url),
 *     so a new clip needs no deploy (owner, 11.10.2026).
 *
 *   · the run price on the deck front — an image of what a run costs NOW (catalog sku `run`, a running
 *     sale already taken off, with a «-NN%» tag while it lasts): /api/otherside/arcade-price.png.
 *
 * Modules live under an immutable versioned folder: the asset zone caches for a year and the token
 * cannot purge, so new models go to a new folder (bump ARCADE_ASSET_VERSION), never over the old.
 */
export const ARCADE_ASSET_VERSION = 'v3'
export const ARCADE_ASSET_BASE = `${MEDIA_BASE}/apedroidz/3D-objects/arcade/${ARCADE_ASSET_VERSION}/`
export const ARCADE_MML_URL = `${SITE_BASE}/api/otherside/arcade.mml`
const DEFAULT_VIDEO = `${MEDIA_BASE}/apedroidz/droidz-survival/media/beta-announce.mp4`

export type ArcadeSettings = { videoUrl: string }

const MEMO_MS = 30_000
let settingsMemo: { until: number; value: Promise<ArcadeSettings> } | null = null
let poolMemo: { until: number; value: Promise<number | null> } | null = null

/** A clean https URL or null: the value goes into an MML attribute. */
export function cleanVideoUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null
    const s = raw.trim()
    if (s.length > 500 || !/^https:\/\/[^\s"'<>]+$/i.test(s)) return null
    return s
}

export async function getArcadeSettings(): Promise<ArcadeSettings> {
    const now = Date.now()
    if (!settingsMemo || settingsMemo.until < now) {
        settingsMemo = {
            until: now + MEMO_MS,
            value: (async () => {
                // No table yet / no row → the trailer, so the cabinet works before the migration.
                if (!supabaseAdmin) return { videoUrl: DEFAULT_VIDEO }
                const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', 'otherside_arcade').maybeSingle()
                const v = (data?.value ?? {}) as Record<string, unknown>
                return { videoUrl: cleanVideoUrl(v.video_url) ?? DEFAULT_VIDEO }
            })().catch(() => ({ videoUrl: DEFAULT_VIDEO })),
        }
    }
    return settingsMemo.value
}

/** Forget the cached settings (the admin route calls this after a save on the same instance). */
export function dropArcadeSettingsMemo() { settingsMemo = null }

/** The live season's pool in APE, summed the same way as /api/survival/pool; null = no live season. */
export async function getLivePoolApe(): Promise<number | null> {
    const now = Date.now()
    if (!poolMemo || poolMemo.until < now) {
        poolMemo = {
            until: now + MEMO_MS,
            value: (async () => {
                if (!supabaseAdmin) return null
                const { data: season } = await supabaseAdmin.from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle()
                if (!season) return null
                const { data: st, error } = await supabaseAdmin.rpc('survival_pool_stats', { p_season: season.id })
                if (error) return null
                const r = ((st as Array<Record<string, number | string>> | null) ?? [])[0] ?? {}
                return poolApeOf(Number(r.solo_ape ?? 0), Number(r.coop_ape ?? 0))
            })().catch(() => null),
        }
    }
    return poolMemo.value
}

export type RunPrice = { price: number; salePct: number }
let priceMemo: { until: number; value: Promise<RunPrice | null> } | null = null

/** What one solo run costs right now (catalog `run`, sale applied by loadCatalog); null = not on sale. */
export async function getRunPrice(): Promise<RunPrice | null> {
    const now = Date.now()
    if (!priceMemo || priceMemo.until < now) {
        priceMemo = {
            until: now + MEMO_MS,
            value: loadCatalog(true).then((items) => {
                const run = items.find((i) => i.sku === 'run')
                return run ? { price: run.price_ape, salePct: run.sale_pct } : null
            }).catch(() => null),
        }
    }
    return priceMemo.value
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The cabinet's MML with the module folder, the board image for this sum and the video. */
export function buildArcadeMml(pool: number | null, settings: ArcadeSettings, price: RunPrice | null = null): string {
    const p = pool === null ? 'none' : String(Math.floor(pool))
    const pr = price === null ? 'none' : `${price.price}-${price.salePct}`
    return ARCADE_MML_TEMPLATE
        .split('{{PRICE}}').join(attr(`${SITE_BASE}/api/otherside/arcade-price.png?p=${pr}`))
        .split('{{BASE}}').join(ARCADE_ASSET_BASE)
        .split('{{POOL}}').join(attr(`${SITE_BASE}/api/otherside/arcade-pool.png?p=${p}`))
        .split('{{VIDEO}}').join(attr(settings.videoUrl))
}

const fmt = (n: number) => Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

/**
 * The board as a PNG: the pre-lit board with the sum's digit tiles laid on it (screen blend, so the
 * glows add up). Up to 5 digits share one size; a longer sum shrinks to the board's inner width.
 * No live season → a dash.
 */
export async function renderPoolBoard(pool: number | null): Promise<Buffer> {
    const L = BOARD_LAYOUT
    const text = pool === null ? '' : fmt(pool)
    type Tile = { adv: number; w: number; h: number; pad?: number }
    const all = L.tiles as unknown as Record<string, Tile>
    const tiles = [...text].map((c) => ({ c, t: all[c === ' ' ? 'sp' : c] })).filter((x) => x.t)
    const total = tiles.reduce((a, x) => a + x.t.adv, 0)
    const k = total > 0 ? Math.min(1, (L.w - 2 * L.pad) / total) : 1
    let x = Math.round((L.w - total * k) / 2 / L.pitch) * L.pitch
    const top = L.num_top + Math.round((L.num_h - L.digit_h * k) / 2)
    const layers: sharp.OverlayOptions[] = []
    for (const { c, t } of tiles) {
        if (c !== ' ') {
            const full = { ...t, pad: t.pad ?? 0 }
            let buf: Buffer = Buffer.from(BOARD_DIGITS_PNG[c], 'base64')
            if (k < 1) buf = await sharp(buf).resize(Math.max(1, Math.round(full.w * k)), Math.max(1, Math.round(full.h * k)), { kernel: 'nearest' }).toBuffer()
            layers.push({ input: buf, left: Math.round(x - full.pad * k), top: Math.round(top - full.pad * k), blend: 'screen' })
        }
        x += t.adv * k
    }
    return sharp(Buffer.from(BOARD_BASE_PNG, 'base64')).composite(layers).png({ compressionLevel: 9 }).toBuffer()
}

const fmtPrice = (n: number) => String(Math.round(n * 100) / 100)

/**
 * The deck's price strip as a PNG: «[coin] 1 RUN = <price> APE», plus a red «-NN%» tag while a sale
 * runs. The base and the glyph tiles are pre-drawn in the game font (3D/Arcade/scripts/board_assets.py).
 */
export async function renderPriceStrip(price: RunPrice | null): Promise<Buffer> {
    const L = PRICE_LAYOUT
    const T = L.tiles as unknown as Record<string, { adv: number; w: number; h: number }>
    const tile = (k: string) => Buffer.from(PRICE_TILES_PNG[k], 'base64')
    // 1. the row on a transparent strip, left to right: [coin] 1 RUN = <price> APE [-NN%]
    const rowH = 100
    const mid = rowH / 2
    const base = mid + L.glyph_h / 2          // the price sits on one baseline (the dot too)
    const layers: sharp.OverlayOptions[] = []
    let x = 0
    const put = (key: string, onBase = false) => {
        const t = T[key]
        layers.push({ input: tile(key), left: Math.round(x), top: Math.round(onBase ? base - t.h : mid - t.h / 2) })
        x += t.adv
    }
    put('lead')
    if (price) {
        x += L.gap
        for (const c of fmtPrice(price.price)) put(c === '.' ? 'dot' : c, true)
        x += L.gap
        put('ape', true)
        if (price.salePct > 0) {
            x += L.gap
            const keys = [...`-${Math.round(price.salePct)}%`].map((c) => 's_' + (c === '-' ? 'minus' : c === '%' ? 'pct' : c))
            const w = keys.reduce((a, k) => a + T[k].adv, 0) + 24
            const h = Math.max(...keys.map((k) => T[k].h)) + 16
            layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="10" fill="#F92C2C"/></svg>`), left: Math.round(x), top: Math.round(mid - h / 2) })
            x += 12
            for (const k of keys) put(k)
            x += 12
        }
    }
    const rowW = Math.ceil(x)
    let row = await sharp({ create: { width: rowW, height: rowH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(layers).png().toBuffer()
    // 2. centred on the frame; a row wider than the frame shrinks to fit
    const maxW = L.w - 2 * L.margin
    let w = rowW, h = rowH
    if (rowW > maxW) {
        w = maxW; h = Math.round(rowH * maxW / rowW)
        row = await sharp(row).resize(w, h, { kernel: 'nearest' }).toBuffer()
    }
    return sharp(Buffer.from(PRICE_BASE_PNG, 'base64'))
        .composite([{ input: row, left: Math.round((L.w - w) / 2), top: Math.round((L.h - h) / 2) }])
        .png({ compressionLevel: 9 }).toBuffer()
}
