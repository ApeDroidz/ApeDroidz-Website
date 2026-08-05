import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { batteryUrl } from '@/lib/media'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const BATTERY_CONTRACT = (process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || '').toLowerCase()
const CHAIN_ID = 33139 // ApeChain
const CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || ''
const SECRET_KEY = process.env.THIRDWEB_SECRET_KEY || ''
const INSIGHT_BASE = 'https://insight.thirdweb.com/v1/nfts'

const BATTERY_IMG = {
  Standard: batteryUrl(false),
  Super: batteryUrl(true),
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
}

/**
 * GET /api/owned-batteries?owner=0x...
 *
 * Same RPC-free pattern as /api/owned-droids: thirdweb Insight indexer for owned
 * battery token IDs + one Supabase query for type/burned state. Burned batteries
 * are filtered via the DB `is_burned` flag (authoritative right after a burn,
 * before the indexer catches up).
 */
export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get('owner')?.trim()
  if (!owner || !/^0x[a-fA-F0-9]{40}$/.test(owner)) {
    return NextResponse.json({ error: 'Invalid owner address' }, { status: 400, headers })
  }
  if (!BATTERY_CONTRACT) {
    return NextResponse.json({ batteries: [] }, { headers })
  }

  const authHeaders: Record<string, string> = SECRET_KEY
    ? { 'x-secret-key': SECRET_KEY }
    : { 'x-client-id': CLIENT_ID, 'Origin': 'https://apedroidz.com' }

  // Owned battery token IDs from the indexer (paged).
  const tokenIds: number[] = []
  try {
    const LIMIT = 100
    for (let page = 0; page < 50; page++) {
      const url = `${INSIGHT_BASE}?chain=${CHAIN_ID}&owner_address=${owner}` +
        `&contract_address=${BATTERY_CONTRACT}&limit=${LIMIT}&page=${page}`
      const res = await fetch(url, { headers: authHeaders, cache: 'no-store' })
      if (!res.ok) {
        if (page === 0) return NextResponse.json({ error: 'Indexer error', batteries: [] }, { status: 502, headers })
        break
      }
      const json = await res.json()
      const data: any[] = json?.data || []
      for (const nft of data) {
        const id = parseInt(String(nft.token_id))
        if (Number.isInteger(id) && id >= 0) tokenIds.push(id)
      }
      if (data.length < LIMIT) break
    }
  } catch (e) {
    console.error('[owned-batteries] insight fetch failed:', e)
    return NextResponse.json({ error: 'Indexer unavailable', batteries: [] }, { status: 502, headers })
  }

  const uniqueIds = [...new Set(tokenIds)]
  if (uniqueIds.length === 0) {
    return NextResponse.json({ batteries: [] }, { headers })
  }

  // Type + burned state for those tokens.
  const typeById = new Map<number, string>()
  const burned = new Set<number>()
  const { data: rows, error } = await supabaseAdmin!
    .from('batteries')
    .select('token_id, type, is_burned')
    .in('token_id', uniqueIds)
  if (error) {
    console.error('[owned-batteries] db query failed:', error)
    return NextResponse.json({ error: 'Database error', batteries: [] }, { status: 500, headers })
  }
  for (const row of rows || []) {
    if (row.is_burned) burned.add(row.token_id)
    if (row.type) typeById.set(row.token_id, row.type)
  }

  const batteries = uniqueIds
    .filter((id) => !burned.has(id))
    .sort((a, b) => a - b)
    .map((tokenId) => {
      const batteryType = typeById.get(tokenId) === 'Super' ? 'Super' : 'Standard'
      return {
        id: `battery-${tokenId}`,
        tokenId: String(tokenId),
        name: `Energy Battery #${tokenId}`,
        image: batteryType === 'Super' ? BATTERY_IMG.Super : BATTERY_IMG.Standard,
        type: 'battery' as const,
        batteryType,
        metadata: { attributes: [{ trait_type: 'Type', value: batteryType }] },
      }
    })

  return NextResponse.json({ batteries, count: batteries.length }, { headers })
}
