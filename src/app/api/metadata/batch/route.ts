import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ASSETS_BASE = 'https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
}

/**
 * POST /api/metadata/batch
 *
 * Resolve display data for many droids in ONE DB round-trip instead of N calls
 * to /api/metadata/droidz/{id}. Used by the site inventory panels so the wallet
 * sync is fast even for holders with dozens of droids.
 *
 * Body:  { ids: (number|string)[] }
 * Reply: { droids: { [tokenId]: { name, image, image_pixel, image_animated,
 *          level, is_super, display_view, attributes } } }
 */
export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders }) }

  const rawIds: unknown[] = Array.isArray(body?.ids) ? body.ids : []
  const ids = [...new Set(
    rawIds.map((x) => parseInt(String(x))).filter((n) => Number.isInteger(n) && n >= 0)
  )]

  if (ids.length === 0) {
    return NextResponse.json({ droids: {} }, { headers: corsHeaders })
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: 'Too many ids (max 500)' }, { status: 400, headers: corsHeaders })
  }

  const { data: rows, error } = await supabaseAdmin!
    .from('droidz')
    .select('token_id, level, is_super, traits, description, image_url, animation_url, display_pref')
    .in('token_id', ids)

  if (error) {
    console.error('[metadata/batch] query failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500, headers: corsHeaders })
  }

  const droids: Record<string, any> = {}
  for (const droid of rows || []) {
    const tokenId = droid.token_id
    const isSuper = !!droid.is_super
    const level = droid.level || 1

    let levelString = String(level)
    if (level >= 2) levelString = isSuper ? '2 SUPER' : '2'

    const cleanAttributes = (droid.traits || []).filter((attr: any) => {
      const tType = attr.trait_type?.toLowerCase() || ''
      return !['level', 'upgraded', 'upgrade level', 'upgraded level', 'rank', 'rank value'].includes(tType)
    })

    const displayPref = ['pixel', 'animated'].includes(droid.display_pref) ? droid.display_pref : null
    const effectiveView: 'pixel' | 'animated' =
      displayPref === 'animated' && level >= 2 ? 'animated'
        : displayPref === 'pixel' ? 'pixel'
          : level >= 2 ? 'animated' : 'pixel'

    const pixelUrl = level >= 2
      ? `${ASSETS_BASE}/${isSuper ? 'super' : 'level2'}/${tokenId}.webp`
      : `${ASSETS_BASE}/level1/${tokenId}.png`
    const animatedUrl = `${ASSETS_BASE}/${isSuper ? 'super-gif' : 'level2-gif'}/${tokenId}.gif`

    const bustVersion = `${level}${isSuper ? 's' : ''}${effectiveView === 'animated' ? 'a' : 'p'}`
    const bust = (url: string) => `${url}?v=${bustVersion}`

    droids[String(tokenId)] = {
      name: `ApeDroid #${tokenId}`,
      image: bust(effectiveView === 'animated' ? animatedUrl : pixelUrl),
      image_pixel: bust(pixelUrl),
      image_animated: bust(animatedUrl),
      level,
      is_super: isSuper,
      display_view: effectiveView,
      attributes: [...cleanAttributes, { trait_type: 'Level', value: levelString }],
    }
  }

  return NextResponse.json({ droids }, { headers: corsHeaders })
}
