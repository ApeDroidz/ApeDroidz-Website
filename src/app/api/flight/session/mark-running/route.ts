import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/flight/session/mark-running
 * Body: { session_id }
 * Transitions session from 'waiting' → 'running' and records started_at.
 */
export async function POST(req: Request) {
    try {
        const { session_id } = await req.json()
        if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

        await supabaseAdmin
            .from('flight_sessions')
            .update({ status: 'running', started_at: new Date().toISOString() })
            .eq('id', session_id)
            .eq('status', 'waiting')   // only if still waiting

        return NextResponse.json({ success: true })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
