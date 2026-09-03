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
//   apedroidz/3D-media/3D-PFP/lvl_1-lvl_2/<id>.jpg      3D bust, L1 + std L2 (blue bg)
//   apedroidz/3D-media/3D-PFP/lvl_2-super/<id>.jpg      3D bust, SUPER       (orange bg)
//   apedroidz/3D-media/3D-PFP-512/<same>/<id>.webp      512px thumbs of both
//   apedroidz_honorary/png/<id>.png                 honorary static
//   apedroidz_honorary/gif/<id>.gif                 honorary animated
//   batteries/<name>.webp|.gif
//   shards/shard_0N.webp
//
// NOTE: there is no standard-L2 STATIC set (blue png) — `lvl_2_super_png` is the
// orange SUPER render for every token. So a standard L2 droid's pixel view falls
// back to its level-1 art: right background, just no upgrade kicks. Showing the
// super render there would be plain wrong (orange bg on a blue droid).
// When a `lvl_2_png` set is uploaded, use it in droidStaticUrl below.
// Канонический домен сайта — на него ссылается поле mml в метаданных NFT.
// Именно www, а не голый apedroidz.com: апекс отвечает 307 на www, а гарантий,
// что читатель MML (Otherside и прочие) пойдёт за редиректом, у нас нет.
export const SITE_BASE = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://www.apedroidz.com'
).replace(/\/+$/, '')

export const MEDIA_BASE = (
  process.env.NEXT_PUBLIC_MEDIA_URL || 'https://assets.apedroidz.com'
).replace(/\/+$/, '')

const PIXEL_MEDIA = `${MEDIA_BASE}/apedroidz/pixel-media`
const PFP_3D = `${MEDIA_BASE}/apedroidz/3D-media/3D-PFP`
const HONORARY = `${MEDIA_BASE}/apedroidz_honorary`

/** Static ("pixel") art for a droid. */
export const droidStaticUrl = (tokenId: string | number, level: number, isSuper: boolean): string => {
  // Only SUPER droids have a dedicated static render. Everyone else — level 1
  // and standard level 2 — uses the level-1 png (see note above).
  if (level >= 2 && isSuper) return `${PIXEL_MEDIA}/lvl_2_super_png/${tokenId}.png`
  return `${PIXEL_MEDIA}/lvl_1_png/${tokenId}.png`
}

/** Animated (GIF) art. Level-1 droids have no animation of their own — the
 *  standard L2 render doubles as the "upgrade teaser" preview.
 *  Use this wherever the file itself is the point (previewer, downloads). */
export const droidAnimatedUrl = (tokenId: string | number, isSuper: boolean): string =>
  `${PIXEL_MEDIA}/${isSuper ? 'lvl_2_super_gif' : 'lvl_2_gif'}/${tokenId}.gif`

/** Same animation as WebP — pixel-identical to the GIF, ~20x smaller.
 *  This is what belongs in metadata `image`: marketplaces autoplay animated
 *  WebP, while a GIF in that slot renders as a still frame that only moves on
 *  hover. The previewer keeps serving the GIF so "save image" yields a GIF. */
export const droidAnimatedWebpUrl = (tokenId: string | number, isSuper: boolean): string =>
  `${PIXEL_MEDIA}/${isSuper ? 'lvl_2_super_webp' : 'lvl_2_webp'}/${tokenId}.webp`

/** 3D bust render ("3D PFP") — one 2048px JPEG per token, two background sets.
 *  Blue covers level 1 AND standard level 2: the bust crops above the knees, so
 *  the level-2 sneakers are out of frame and a separate std-L2 set would be a
 *  pixel-identical duplicate. SUPER gets its own orange-background render. */
export const droid3dPfpUrl = (tokenId: string | number, level: number, isSuper: boolean): string =>
  `${PFP_3D}/${level >= 2 && isSuper ? 'lvl_2-super' : 'lvl_1-lvl_2'}/${tokenId}.jpg`

/** 512px WebP of the same render (~40 KB vs ~2.3 MB). For grids and marquees —
 *  anywhere the image is displayed small and the full JPEG would be waste. */
export const droid3dPfpThumbUrl = (tokenId: string | number, level: number, isSuper: boolean): string =>
  `${PFP_3D}-512/${level >= 2 && isSuper ? 'lvl_2-super' : 'lvl_1-lvl_2'}/${tokenId}.webp`

export const honoraryStaticUrl = (tokenId: string | number): string =>
  `${HONORARY}/png/${tokenId}.png`

export const honoraryAnimatedUrl = (tokenId: string | number): string =>
  `${HONORARY}/gif/${tokenId}.gif`

/** Autoplaying variant for metadata `image` — see droidAnimatedWebpUrl. */
export const honoraryAnimatedWebpUrl = (tokenId: string | number): string =>
  `${HONORARY}/webp/${tokenId}.webp`

// Per-token 3D models live on GCS (separate host from the R2 image bucket) and
// are what the `mml` field in the NFT metadata points at. CORS is open, so
// useGLTF can load them straight from the browser.
export const MODEL_BASE = (
  process.env.NEXT_PUBLIC_MODEL_URL || 'https://storage.googleapis.com/apedroidz'
).replace(/\/+$/, '')

/** Full-body GLB for a droid — ids 1…3333. Фолбэк, когда MML недоступен. */
export const droidModelUrl = (tokenId: string | number): string =>
  `${MODEL_BASE}/glb/${tokenId}.glb`

/** MML-обёртка из метаданных NFT: <m-character src="…glb"> */
export const droidMmlUrl = (tokenId: string | number): string =>
  `${MODEL_BASE}/mml/${tokenId}.mml`

/** MML-аватар для Otherside. Один адрес на токен и навсегда: документ
 *  собирается на лету из БД, поэтому апгрейд до level 2 добавляет в него
 *  кроссовки, а будущий гардероб — купленную одежду, и ссылка в метаданных
 *  при этом не меняется. Сама сборка — в src/lib/mml.ts.
 *
 *  ВАЖНО: это НЕ то же, что droidMmlUrl выше. Тот указывает на запечённую
 *  модель целиком на GCS и нужен превьюеру лендинга, который читает из MML
 *  единственную ссылку на GLB. Otherside-версия ссылается на 5-6 файлов, и
 *  превьюер её не поймёт. */
export const droidOthersideMmlUrl = (tokenId: string | number): string =>
  `${SITE_BASE}/api/mml/${tokenId}.mml`

export const batteryUrl = (isSuper: boolean, ext: 'webp' | 'gif' = 'webp'): string =>
  `${MEDIA_BASE}/batteries/${isSuper ? 'super' : 'standart'}_battery.${ext}`

export const shardUrl = (n: number | string): string => {
  const padded = String(n).padStart(2, '0')
  return `${MEDIA_BASE}/shards/shard_${padded}.webp`
}
