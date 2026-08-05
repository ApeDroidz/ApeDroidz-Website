// Single source of truth for droid/battery art URLs.
//
// Art lives on Cloudflare R2 behind assets.apedroidz.com (moved off Supabase
// Storage — R2 has free egress and no 1 GB cap). Override the host with
// NEXT_PUBLIC_MEDIA_URL if the bucket/domain ever changes.
//
// Bucket layout (bucket `apedroidz`):
//   apedroidz/pixel-media/lvl_1_png/<id>.png        L1 static        (blue bg)
//   apedroidz/pixel-media/lvl_2_gif/<id>.gif        L2 animated      (blue bg)
//   apedroidz/pixel-media/lvl_2_super_gif/<id>.gif  L2 SUPER animated(orange bg)
//   apedroidz/pixel-media/lvl_2_super_png/<id>.png  L2 SUPER static  (orange bg)
//   apedroidz_honorary/png/<id>.png                 honorary static
//   apedroidz_honorary/gif/<id>.gif                 honorary animated
//   batteries/<name>.webp|.gif
//   shards/shard_0N.webp
//
// NOTE: there is no standard-L2 STATIC set (blue png). `lvl_2_super_png` is the
// orange super render for every token. Until a `lvl_2_png` folder exists, the
// pixel view of a standard L2 droid falls back to the super static art — see
// L2_STANDARD_STATIC_DIR below, which is the one line to change.
export const MEDIA_BASE = (
  process.env.NEXT_PUBLIC_MEDIA_URL || 'https://assets.apedroidz.com'
).replace(/\/+$/, '')

const PIXEL_MEDIA = `${MEDIA_BASE}/apedroidz/pixel-media`
const HONORARY = `${MEDIA_BASE}/apedroidz_honorary`

// Swap to 'lvl_2_png' once the blue standard-L2 static set is uploaded.
const L2_STANDARD_STATIC_DIR = 'lvl_2_super_png'

/** Static ("pixel") art for a droid. */
export const droidStaticUrl = (tokenId: string | number, level: number, isSuper: boolean): string => {
  if (level >= 2) {
    const dir = isSuper ? 'lvl_2_super_png' : L2_STANDARD_STATIC_DIR
    return `${PIXEL_MEDIA}/${dir}/${tokenId}.png`
  }
  return `${PIXEL_MEDIA}/lvl_1_png/${tokenId}.png`
}

/** Animated (GIF) art. Level-1 droids have no animation of their own — the
 *  standard L2 render doubles as the "upgrade teaser" preview. */
export const droidAnimatedUrl = (tokenId: string | number, isSuper: boolean): string =>
  `${PIXEL_MEDIA}/${isSuper ? 'lvl_2_super_gif' : 'lvl_2_gif'}/${tokenId}.gif`

export const honoraryStaticUrl = (tokenId: string | number): string =>
  `${HONORARY}/png/${tokenId}.png`

export const honoraryAnimatedUrl = (tokenId: string | number): string =>
  `${HONORARY}/gif/${tokenId}.gif`

export const batteryUrl = (isSuper: boolean, ext: 'webp' | 'gif' = 'webp'): string =>
  `${MEDIA_BASE}/batteries/${isSuper ? 'super' : 'standart'}_battery.${ext}`

export const shardUrl = (n: number | string): string => {
  const padded = String(n).padStart(2, '0')
  return `${MEDIA_BASE}/shards/shard_${padded}.webp`
}
