import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildDroidMml } from '@/lib/mml'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Один MML на токен, содержимое собирается в момент запроса. Апгрейд до level 2
// добавляет в тот же файл кроссовки, будущий гардероб — купленную одежду, и
// ссылка в метаданных при этом не меняется.
//
// no-store здесь не паранойя: после апгрейда аватар обязан поменяться сразу,
// а Otherside и вьюеры ходят по ссылке напрямую.
const headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers })
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params

  // Ссылка выглядит как файл — /api/mml/2171.mml — чтобы не смущать
  // потребителей, которые ждут от MML расширения.
  const raw = id.trim().replace(/\.mml$/i, '')
  const tokenId = parseInt(raw, 10)
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    return NextResponse.json({ error: 'Invalid token id' }, { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const { data: droid, error } = await supabaseAdmin
    .from('droidz')
    .select('token_id, traits, level, is_super')
    .eq('token_id', tokenId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } })
  }
  if (!droid) {
    return NextResponse.json({ error: 'Droid not found' }, { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const traits: Record<string, string> = {}
  for (const attr of (droid.traits || []) as Array<{ trait_type?: string; value?: string }>) {
    if (attr?.trait_type && typeof attr.value === 'string') traits[attr.trait_type.toLowerCase()] = attr.value
  }

  let body: string
  try {
    body = buildDroidMml({
      traits,
      level: droid.level || 1,
      isSuper: !!droid.is_super,
    })
  } catch {
    return NextResponse.json({ error: 'Droid has no body trait' }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  return new NextResponse(body, { headers })
}
