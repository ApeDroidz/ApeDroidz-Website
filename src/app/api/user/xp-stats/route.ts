
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    try {
        const wallet = req.nextUrl.searchParams.get("wallet")

        if (!wallet) {
            return NextResponse.json({ gameXP: 0 })
        }

        // Fetch all game logs for this user to sum up XP
        // Limit to 1000 most recent for performance, or handle pagination if needed.
        // For now, assuming reasonable count. If huge, we need an RPC function.
        const { data, error } = await supabaseAdmin
            .from('game_logs')
            .select('xp_awarded')
            .eq('wallet_address', wallet)

        if (error) {
            console.error("XP Stats Error:", error)
            // Fallback to 0 if error, to avoid breaking UI (though this means Game XP temporarily 0)
            return NextResponse.json({ gameXP: 0 })
        }

        const totalGameXP = data.reduce((acc: number, curr: any) => acc + (curr.xp_awarded || 0), 0)

        return NextResponse.json({ gameXP: totalGameXP })

    } catch (e) {
        console.error("XP Stats Validation Error:", e)
        return NextResponse.json({ gameXP: 0 })
    }
}
