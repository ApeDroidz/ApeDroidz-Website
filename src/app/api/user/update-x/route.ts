import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireWalletAuth } from '@/lib/walletAuth'

const X_HANDLE_REGEX = /^@?[A-Za-z0-9_]{1,15}$/

/**
 * POST /api/user/update-x
 * Body: { xHandle }      (wallet comes from session cookie)
 *
 * Auth: requires session. Anyone could previously overwrite an arbitrary
 * wallet's X handle and grief the daily-claim "anti-multi-wallet" check.
 */
export async function POST(req: Request) {
    const auth = requireWalletAuth(req)
    if (auth instanceof Response) return auth
    const wallet = auth.wallet

    let body: any
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const raw = typeof body?.xHandle === 'string' ? body.xHandle.trim() : ''
    if (!raw) return NextResponse.json({ error: 'Missing handle' }, { status: 400 })

    const stripped = raw.replace(/^@/, '')
    if (!X_HANDLE_REGEX.test(stripped)) {
        return NextResponse.json({ error: 'Invalid X handle' }, { status: 400 })
    }
    const handle = '@' + stripped

    try {
        if (!supabaseAdmin) {
            return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
        }

        // Use the SECURITY DEFINER RPC which only fills the field if currently null,
        // preventing later overwrites by attackers (defence in depth alongside auth).
        const { error } = await supabaseAdmin.rpc('set_glitch_user_x_handle', {
            p_wallet: wallet,
            p_handle: handle,
        })

        if (error) {
            console.error('Update X Handle Error:', error.message)
            // Fall back to direct upsert if RPC missing (older deployments).
            const { error: upsertErr } = await supabaseAdmin
                .from('glitch_users')
                .upsert({ wallet_address: wallet, x_handle: handle }, { onConflict: 'wallet_address' })
            if (upsertErr) return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
        }

        return NextResponse.json({ success: true })

    } catch (err: any) {
        console.error('Update X Handle Error:', err)
        return NextResponse.json({ error: err.message || 'Failed to update' }, { status: 500 })
    }
}
