import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
    try {
        const { data: prizes, error } = await supabaseAdmin
            .from("prize_types")
            .select("id, name, type, image_url, xp_reward, drop_chance")
            .eq("is_active", true)
            .order("xp_reward", { ascending: false })

        if (error) throw error

        return NextResponse.json({ prizes: prizes ?? [] })
    } catch (err: any) {
        console.error("Prizes fetch error:", err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
