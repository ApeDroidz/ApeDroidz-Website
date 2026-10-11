import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { logEvent } from '@/lib/survivalLog'
import { ARCADE_MML_URL, cleanVideoUrl, dropArcadeSettingsMemo, getArcadeSettings } from '@/lib/arcade'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * GET  /api/admin/otherside/arcade                 → { videoUrl, mmlUrl }
 * POST /api/admin/otherside/arcade { videoUrl }    → save the cabinet's screen video
 *
 * Owner, 11.10.2026: «сделай так чтобы видос мы тоже могли менять на экране». The cabinet MML reads
 * it per request (cached 30 s per instance), so a new clip reaches Otherside without a deploy.
 * The clip must be an https URL the client can stream (H.264 MP4 on R2 works, like the trailer).
 */
export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    dropArcadeSettingsMemo()
    const s = await getArcadeSettings()
    return NextResponse.json({ ok: true, videoUrl: s.videoUrl, mmlUrl: ARCADE_MML_URL }, { headers })
}

export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const body = await request.json().catch(() => ({})) as { videoUrl?: unknown }
    const url = cleanVideoUrl(body.videoUrl)
    if (!url) return NextResponse.json({ error: 'videoUrl must be an https link (no spaces or quotes)' }, { status: 400, headers })
    const { data: before } = await supabaseAdmin.from('site_settings').select('value').eq('key', 'otherside_arcade').maybeSingle()
    const value = { ...((before?.value ?? {}) as Record<string, unknown>), video_url: url }
    const { error } = await supabaseAdmin.from('site_settings')
        .upsert({ key: 'otherside_arcade', value, updated_at: new Date().toISOString(), updated_by: 'spltpnl' }, { onConflict: 'key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 400, headers })
    dropArcadeSettingsMemo()
    logEvent({ level: 'info', source: 'server', kind: 'arcade.video', message: url, data: { before: before?.value ?? null } })
    return NextResponse.json({ ok: true, videoUrl: url, mmlUrl: ARCADE_MML_URL }, { headers })
}
