// Shared display-resolution logic for droids, used by /api/metadata/batch and
// /api/owned-droids so the image/level/view rules live in exactly one place.

import {
  droidStaticUrl, droidAnimatedWebpUrl, droid3dPfpUrl, droid3dPfpThumbUrl,
  honoraryStaticUrl, honoraryAnimatedWebpUrl,
} from './media'

export type DroidRow = {
  token_id: number
  level: number | null
  is_super: boolean | null
  traits: any[] | null
  display_pref: string | null
  display_pref_updated_at?: string | null
}

export type DroidView = 'pixel' | 'animated' | 'pfp3d'

export type DroidDisplay = {
  name: string
  image: string
  image_pixel: string
  image_animated: string
  image_3d: string
  /** 512px WebP of the 3D bust — for cards and grids; `image_3d` is 2048px. */
  image_3d_thumb: string
  level: number
  is_super: boolean
  display_view: DroidView
  attributes: { trait_type: string; value: string }[]
}

/** Marketplaces cache the derived thumbnail by image URL. A bust built only
 *  from level/view repeats itself when a holder switches back to a variant they
 *  used before, so the CDN happily serves the stale derivative. Mixing in the
 *  moment the preference was saved makes every change produce a URL that was
 *  never fetched. Tokens that never changed keep their stable URL. */
const prefStamp = (updatedAt: string | null | undefined): string => {
  if (!updatedAt) return ''
  const ms = Date.parse(updatedAt)
  return Number.isFinite(ms) ? `-${Math.floor(ms / 1000).toString(36)}` : ''
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

  // Same snake_case shape the metadata route publishes — see the note there.
  let levelString = `lvl_${level}`
  if (level >= 2) levelString = isSuper ? 'lvl_2_super' : 'lvl_2'

  const cleanAttributes = (row.traits || []).filter((attr: any) => {
    const tType = attr?.trait_type?.toLowerCase?.() || ''
    return !STRIP_TRAITS.includes(tType)
  })

  const pref = row.display_pref
  const displayPref: DroidView | null =
    pref === 'pixel' || pref === 'animated' || pref === 'pfp3d' ? pref : null
  // The 3D bust exists for every token, so it needs no level gate — only
  // 'animated' does. No preference means the 3D bust: it is the collection's
  // standard look. An explicit choice by the holder always wins over it.
  const effectiveView: DroidView =
    displayPref === 'pfp3d' ? 'pfp3d'
      : displayPref === 'animated' && level >= 2 ? 'animated'
        : displayPref === 'pixel' ? 'pixel'
          : 'pfp3d'

  // Pixel = STATIC png. For anything rendered directly as an image (metadata,
  // dashboard cards) the animation is WebP: it autoplays and is ~20x lighter
  // than the GIF. The GIF stays for the previewer and downloads.
  const pixelUrl = droidStaticUrl(tokenId, level, isSuper)
  const animatedUrl = droidAnimatedWebpUrl(tokenId, isSuper)
  const url3d = droid3dPfpUrl(tokenId, level, isSuper)
  const url3dThumb = droid3dPfpThumbUrl(tokenId, level, isSuper)

  const viewTag = effectiveView === 'animated' ? 'a' : effectiveView === 'pfp3d' ? 'd' : 'p'
  const bustVersion = `${level}${isSuper ? 's' : ''}${viewTag}${prefStamp(row.display_pref_updated_at)}`
  const bust = (url: string) => `${url}?v=${bustVersion}`

  const chosen = effectiveView === 'animated' ? animatedUrl : effectiveView === 'pfp3d' ? url3d : pixelUrl

  return {
    name: `ApeDroid #${tokenId}`,
    image: bust(chosen),
    image_pixel: bust(pixelUrl),
    image_animated: bust(animatedUrl),
    image_3d: bust(url3d),
    image_3d_thumb: bust(url3dThumb),
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

// Token #100 is the "not drawn yet" droid — a single closed-up render shared by
// every honorary token whose own art has not been produced.
const HONORARY_PLACEHOLDER_ID = 100

export type HonoraryRow = {
  token_id: number
  name: string | null
  description: string | null
  external_url: string | null
  traits: any[] | null
  has_gif: boolean | null
  has_png: boolean | null
  display_pref: string | null
  display_pref_updated_at?: string | null
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
  // Undrawn tokens fall back to the shared placeholder art.
  const artId = row.has_png === false ? HONORARY_PLACEHOLDER_ID : tokenId

  const pref = row.display_pref
  const savedPref = pref === 'pixel' || pref === 'animated' ? pref : null
  // Animated is only selectable when the asset exists; otherwise fall back.
  const effectiveView: 'pixel' | 'animated' =
    savedPref === 'animated' && hasGif ? 'animated'
      : savedPref === 'pixel' ? 'pixel'
        : hasGif ? 'animated' : 'pixel'

  const pixelUrl = honoraryStaticUrl(artId)
  // GIF for the previewer/downloads, WebP for anything a marketplace renders
  // directly — only WebP autoplays in an <img>.
  const animatedAutoplayUrl = hasGif ? honoraryAnimatedWebpUrl(tokenId) : null

  const bust = `${hasGif ? 'g' : 'p'}${effectiveView === 'animated' ? 'a' : 'p'}${prefStamp(row.display_pref_updated_at)}`
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
