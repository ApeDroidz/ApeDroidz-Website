import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildHonoraryDisplay } from '@/lib/droidDisplay'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ApeDroidz Honorary is an ERC-1155 (not 721 like the base collection), so the
// owned-token lookup goes through the indexer rather than tokenOfOwnerByIndex.
const HONORARY_CONTRACT = '0x427ff4b908c4ba7bc1d689bacac280a0435b2514'
const CHAIN_ID = 33139
const CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || ''
const SECRET_KEY = process.env.THIRDWEB_SECRET_KEY || ''
const INSIGHT_BASE = 'https://insight.thirdweb.com/v1/nfts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
}

/**
 * GET /api/owned-honorary?owner=0x...
 *
 * Honorary tokens held by `owner`, with their display payload resolved.
 * Same RPC-free shape as /api/owned-droids: indexer for ownership, one Supabase
 * query for name/traits/has_gif/display_pref.
 */
export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get('owner')?.trim()
  if (!owner || !/^0x[a-fA-F0-9]{40}$/.test(owner)) {
    return NextResponse.json({ error: 'Invalid owner address' }, { status: 400, headers })
  }

  const authHeaders: Record<string, string> = SECRET_KEY
    ? { 'x-secret-key': SECRET_KEY }
    : { 'x-client-id': CLIENT_ID, 'Origin': 'https://apedroidz.com' }

  const tokenIds: number[] = []
  try {
    const LIMIT = 100
    for (let page = 0; page < 20; page++) {
      const url = `${INSIGHT_BASE}?chain=${CHAIN_ID}&owner_address=${owner}` +
        `&contract_address=${HONORARY_CONTRACT}&limit=${LIMIT}&page=${page}`
      const res = await fetch(url, { headers: authHeaders, cache: 'no-store' })
      if (!res.ok) {
        if (page === 0) return NextResponse.json({ error: 'Indexer error', droids: [] }, { status: 502, headers })
        break
      }
      const json = await res.json()
      const data: any[] = json?.data || []
      for (const nft of data) {
        // ERC-1155 rows carry a balance; skip anything the wallet no longer holds.
        if (nft.balance !== undefined && Number(nft.balance) <= 0) continue
        const id = parseInt(String(nft.token_id))
        if (Number.isInteger(id) && id >= 0) tokenIds.push(id)
      }
      if (data.length < LIMIT) break
    }
  } catch (e) {
    console.error('[owned-honorary] insight fetch failed:', e)
    return NextResponse.json({ error: 'Indexer unavailable', droids: [] }, { status: 502, headers })
  }

  const uniqueIds = [...new Set(tokenIds)]
  if (uniqueIds.length === 0) {
    return NextResponse.json({ droids: [] }, { headers })
  }

  const rowsById = new Map<number, any>()
  const { data: rows, error } = await supabaseAdmin!
    .from('honorary_droidz')
    .select('token_id, name, description, external_url, traits, has_gif, has_png, display_pref')
    .in('token_id', uniqueIds)
  if (error) {
    console.error('[owned-honorary] db query failed:', error)
    return NextResponse.json({ error: 'Database error', droids: [] }, { status: 500, headers })
  }
  for (const row of rows || []) rowsById.set(row.token_id, row)

  const droids = uniqueIds
    .sort((a, b) => a - b)
    .map((tokenId) => {
      const d = buildHonoraryDisplay(rowsById.get(tokenId) || { token_id: tokenId })
      return {
        id: `honorary-${tokenId}`,
        tokenId: String(tokenId),
        name: d.name,
        image: d.image,
        image_pixel: d.image_pixel,
        image_animated: d.image_animated,
        has_gif: d.has_gif,
        display_view: d.display_view,
        attributes: d.attributes,
        isHonorary: true,
      }
    })

  return NextResponse.json({ droids, count: droids.length }, { headers })
}
