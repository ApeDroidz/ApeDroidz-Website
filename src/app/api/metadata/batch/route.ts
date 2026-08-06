import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildDroidDisplay } from '@/lib/droidDisplay'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
}

/**
 * POST /api/metadata/batch
 *
 * Resolve display data for many droids in ONE DB round-trip instead of N calls
 * to /api/metadata/droidz/{id}.
 *
 * Body:  { ids: (number|string)[] }
 * Reply: { droids: { [tokenId]: DroidDisplay } }
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
    .select('token_id, level, is_super, traits, display_pref, display_pref_updated_at')
    .in('token_id', ids)

  if (error) {
    console.error('[metadata/batch] query failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500, headers: corsHeaders })
  }

  const droids: Record<string, any> = {}
  for (const row of rows || []) {
    droids[String(row.token_id)] = buildDroidDisplay(row)
  }

  return NextResponse.json({ droids }, { headers: corsHeaders })
}
