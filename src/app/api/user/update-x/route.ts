import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
    try {
        const { wallet, xHandle } = await req.json()

        if (!wallet || !xHandle) {
            return NextResponse.json({ error: "Missing wallet or handle" }, { status: 400 })
        }

        // Use Service Role to bypass RLS
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        const { error } = await supabaseAdmin.from('glitch_users').upsert({
            wallet_address: wallet,
            x_handle: xHandle
        }, { onConflict: 'wallet_address' })

        if (error) {
            console.error("Supabase upsert error:", error)
            throw error
        }

        return NextResponse.json({ success: true })

    } catch (err: any) {
        console.error("Update X Handle Error:", err)
        return NextResponse.json({ error: err.message || "Failed to update" }, { status: 500 })
    }
}
