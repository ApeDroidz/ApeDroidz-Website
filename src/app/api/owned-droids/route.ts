import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildDroidDisplay } from '@/lib/droidDisplay'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DROID_CONTRACT = (process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || '').toLowerCase()
const CHAIN_ID = 33139 // ApeChain
const CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || ''
const SECRET_KEY = process.env.THIRDWEB_SECRET_KEY || ''
const INSIGHT_BASE = 'https://insight.thirdweb.com/v1/nfts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
}

/**
 * GET /api/owned-droids?owner=0x...
 *
 * Returns the caller's owned ApeDroidz with full display data, resolved WITHOUT
 * spending any thirdweb RPC quota:
 *   1. thirdweb Insight indexer  → owned token IDs   (indexer, not RPC)
 *   2. one Supabase query        → level/super/traits/display_pref
 *
 * The browser makes a single same-origin call — it never talks to thirdweb
 * directly, so this also sidesteps the client-id domain allowlist (Vercel
 * preview URLs, localhost, etc. all work because the server sends a fixed
 * allowlisted origin / secret key).
 */
export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get('owner')?.trim()
  if (!owner || !/^0x[a-fA-F0-9]{40}$/.test(owner)) {
    return NextResponse.json({ error: 'Invalid owner address' }, { status: 400, headers })
  }
  if (!DROID_CONTRACT) {
    return NextResponse.json({ error: 'Droid contract not configured' }, { status: 500, headers })
  }

  // Insight auth: prefer a server secret key (no origin needed); otherwise use
  // the public client id with our allowlisted origin.
  const authHeaders: Record<string, string> = SECRET_KEY
    ? { 'x-secret-key': SECRET_KEY }
    : { 'x-client-id': CLIENT_ID, 'Origin': 'https://apedroidz.com' }

  // Page through Insight (limit 100/page) until we've collected every token.
  const tokenIds: number[] = []
  try {
    const LIMIT = 100
    for (let page = 0; page < 50; page++) {
      const url = `${INSIGHT_BASE}?chain=${CHAIN_ID}&owner_address=${owner}` +
        `&contract_address=${DROID_CONTRACT}&limit=${LIMIT}&page=${page}`
      const res = await fetch(url, { headers: authHeaders, cache: 'no-store' })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        console.error(`[owned-droids] insight ${res.status}:`, text.slice(0, 200))
        // Page 0 failing is a hard error; a later page failing just stops paging.
        if (page === 0) {
          return NextResponse.json({ error: 'Indexer error', droids: [] }, { status: 502, headers })
        }
        break
      }
      const json = await res.json()
      const data: any[] = json?.data || []
      for (const nft of data) {
        const id = parseInt(String(nft.token_id))
        if (Number.isInteger(id) && id >= 0) tokenIds.push(id)
      }
      if (data.length < LIMIT) break // last page
    }
  } catch (e) {
    console.error('[owned-droids] insight fetch failed:', e)
    return NextResponse.json({ error: 'Indexer unavailable', droids: [] }, { status: 502, headers })
  }

  const uniqueIds = [...new Set(tokenIds)]
  if (uniqueIds.length === 0) {
    return NextResponse.json({ droids: [] }, { headers })
  }

  // One DB query for all owned droids' state.
  const rowsById = new Map<number, any>()
  const { data: rows, error } = await supabaseAdmin!
    .from('droidz')
    .select('token_id, level, is_super, traits, display_pref, display_pref_updated_at')
    .in('token_id', uniqueIds)
  if (error) {
    console.error('[owned-droids] db query failed:', error)
    return NextResponse.json({ error: 'Database error', droids: [] }, { status: 500, headers })
  }
  for (const row of rows || []) rowsById.set(row.token_id, row)

  // Build the frontend-ready droid list, sorted by token id.
  const droids = uniqueIds
    .sort((a, b) => a - b)
    .map((tokenId) => {
      const row = rowsById.get(tokenId) || { token_id: tokenId }
      const d = buildDroidDisplay(row)
      return {
        id: String(tokenId),
        tokenId: String(tokenId),
        name: d.name,
        image: d.image, // the droid's saved default view (pixel or animated)
        image_pixel: d.image_pixel,
        image_animated: d.image_animated,
        level: d.level,
        is_super: d.is_super,
        display_view: d.display_view,
        attributes: d.attributes,
      }
    })

  return NextResponse.json({ droids, count: droids.length }, { headers })
}
