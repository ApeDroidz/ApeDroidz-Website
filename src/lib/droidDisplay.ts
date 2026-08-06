// Shared display-resolution logic for droids, used by /api/metadata/batch and
// /api/owned-droids so the image/level/view rules live in exactly one place.

import { droidStaticUrl, droidAnimatedWebpUrl, honoraryStaticUrl, honoraryAnimatedWebpUrl } from './media'

export type DroidRow = {
  token_id: number
  level: number | null
  is_super: boolean | null
  traits: any[] | null
  display_pref: string | null
}

export type DroidDisplay = {
  name: string
  image: string
  image_pixel: string
  image_animated: string
  level: number
  is_super: boolean
  display_view: 'pixel' | 'animated'
  attributes: { trait_type: string; value: string }[]
}

const STRIP_TRAITS = ['level', 'upgraded', 'upgrade level', 'upgraded level', 'rank', 'rank value']

/**
 * Resolve the display payload (images, effective view, level string, clean
 * attributes) for one droid row. `token_id` is required; the rest default to a
 * level-1 droid when the DB has no row (should not happen for the 3333 base
 * collection, but keeps the API resilient).
 */
export function buildDroidDisplay(row: Partial<DroidRow> & { token_id: number }): DroidDisplay {
  const tokenId = row.token_id
  const isSuper = !!row.is_super
  const level = row.level || 1

  let levelString = String(level)
  if (level >= 2) levelString = isSuper ? '2 SUPER' : '2'

  const cleanAttributes = (row.traits || []).filter((attr: any) => {
    const tType = attr?.trait_type?.toLowerCase?.() || ''
    return !STRIP_TRAITS.includes(tType)
  })

  const pref = row.display_pref
  const displayPref = pref === 'pixel' || pref === 'animated' ? pref : null
  const effectiveView: 'pixel' | 'animated' =
    displayPref === 'animated' && level >= 2 ? 'animated'
      : displayPref === 'pixel' ? 'pixel'
        : level >= 2 ? 'animated' : 'pixel'

  // Pixel = STATIC png. For anything rendered directly as an image (metadata,
  // dashboard cards) the animation is WebP: it autoplays and is ~20x lighter
  // than the GIF. The GIF stays for the previewer and downloads.
  const pixelUrl = droidStaticUrl(tokenId, level, isSuper)
  const animatedUrl = droidAnimatedWebpUrl(tokenId, isSuper)

  const bustVersion = `${level}${isSuper ? 's' : ''}${effectiveView === 'animated' ? 'a' : 'p'}`
  const bust = (url: string) => `${url}?v=${bustVersion}`

  return {
    name: `ApeDroid #${tokenId}`,
    image: bust(effectiveView === 'animated' ? animatedUrl : pixelUrl),
    image_pixel: bust(pixelUrl),
    image_animated: bust(animatedUrl),
    level,
    is_super: isSuper,
    display_view: effectiveView,
    attributes: [...cleanAttributes, { trait_type: 'level', value: levelString }],
  }
}

// ── Honorary (ERC-1155) ──────────────────────────────────────────────────────
// Different rules from the base collection: no levels, and the "animated" view
// exists only for the tokens that actually have a gif in R2 (has_gif). Default
// view is the gif when there is one, otherwise the static png — but a holder can
// still pick and save the static version.

export type HonoraryRow = {
  token_id: number
  name: string | null
  description: string | null
  external_url: string | null
  traits: any[] | null
  has_gif: boolean | null
  display_pref: string | null
}

export type HonoraryDisplay = {
  name: string
  description: string
  external_url: string | null
  image: string
  image_pixel: string
  image_animated: string | null
  has_gif: boolean
  display_view: 'pixel' | 'animated'
  attributes: { trait_type: string; value: string }[]
}

export function buildHonoraryDisplay(
  row: Partial<HonoraryRow> & { token_id: number },
): HonoraryDisplay {
  const tokenId = row.token_id
  const hasGif = !!row.has_gif

  const pref = row.display_pref
  const savedPref = pref === 'pixel' || pref === 'animated' ? pref : null
  // Animated is only selectable when the asset exists; otherwise fall back.
  const effectiveView: 'pixel' | 'animated' =
    savedPref === 'animated' && hasGif ? 'animated'
      : savedPref === 'pixel' ? 'pixel'
        : hasGif ? 'animated' : 'pixel'

  const pixelUrl = honoraryStaticUrl(tokenId)
  // GIF for the previewer/downloads, WebP for anything a marketplace renders
  // directly — only WebP autoplays in an <img>.
  const animatedAutoplayUrl = hasGif ? honoraryAnimatedWebpUrl(tokenId) : null

  const bust = `${hasGif ? 'g' : 'p'}${effectiveView === 'animated' ? 'a' : 'p'}`
  const withBust = (url: string) => `${url}?v=${bust}`

  return {
    name: row.name || `Honorary DRD#${tokenId}`,
    description: row.description || 'Honorary ApeDroid.',
    external_url: row.external_url || null,
    image: withBust(effectiveView === 'animated' && animatedAutoplayUrl ? animatedAutoplayUrl : pixelUrl),
    image_pixel: withBust(pixelUrl),
    image_animated: animatedAutoplayUrl ? withBust(animatedAutoplayUrl) : null,
    has_gif: hasGif,
    display_view: effectiveView,
    attributes: row.traits || [],
  }
}
