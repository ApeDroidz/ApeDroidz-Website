import sharp from 'sharp'
import { supabaseAdmin } from '@/lib/supabase'
import { SITE_BASE, MEDIA_BASE } from '@/lib/media'
import { poolApeOf } from '@/lib/survivalPoolLevels'
import { ARCADE_MML_TEMPLATE } from './mml.template'
import { BOARD_LAYOUT, BOARD_BASE_PNG, BOARD_DIGITS_PNG } from './board.assets'

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
 * Modules live under an immutable versioned folder: the asset zone caches for a year and the token
 * cannot purge, so new models go to a new folder (bump ARCADE_ASSET_VERSION), never over the old.
 */
export const ARCADE_ASSET_VERSION = 'v2'
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

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The cabinet's MML with the module folder, the board image for this sum and the video. */
export function buildArcadeMml(pool: number | null, settings: ArcadeSettings): string {
    const p = pool === null ? 'none' : String(Math.floor(pool))
    return ARCADE_MML_TEMPLATE
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
