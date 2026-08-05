// Shared display-resolution logic for droids, used by /api/metadata/batch and
// /api/owned-droids so the image/level/view rules live in exactly one place.

import { droidStaticUrl, droidAnimatedUrl } from './media'

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

  // Pixel = STATIC png, animated = GIF. Paths resolved by lib/media (R2).
  const pixelUrl = droidStaticUrl(tokenId, level, isSuper)
  const animatedUrl = droidAnimatedUrl(tokenId, isSuper)

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
