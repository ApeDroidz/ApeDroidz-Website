import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { isValidWallet } from "@/lib/walletAuth"

/**
 * GET /api/games/state?wallet=0x...
 *
 * Returns:
 *  - activeTask: current daily task (title, tweet_url, active_to) or null
 *  - claimed: whether the user has already claimed this task
 *  - claimedAt: ISO timestamp of the claim (if any)
 */
export async function GET(req: NextRequest) {
    const queryWallet = req.nextUrl.searchParams.get("wallet")
    const wallet = queryWallet

    if (!wallet || !isValidWallet(wallet)) {
        return NextResponse.json({ activeTask: null, claimed: false, claimedAt: null })
    }

    if (!supabaseAdmin) {
        return NextResponse.json({ activeTask: null, claimed: false, claimedAt: null })
    }

    const now = new Date().toISOString()

    // 1. Fetch active task
    const { data: task, error: taskErr } = await supabaseAdmin
        .from("daily_task_config")
        .select("id, tweet_url, title, active_to")
        .lte("active_from", now)
        .gte("active_to", now)
        .order("active_from", { ascending: false })
        .limit(1)
        .maybeSingle()

    if (taskErr || !task) {
        return NextResponse.json({ activeTask: null, claimed: false, claimedAt: null })
    }

    // 2. Check if this wallet already claimed THIS specific task. We only
    //    look at the S2 table — pre-S2 history (in legacy daily_claims_log)
    //    must NOT block a returning S1 player from claiming a fresh S2 task.
    const { data: existingClaim } = await supabaseAdmin
        .from("daily_claims_log_s2")
        .select("claimed_at")
        .ilike("wallet_address", wallet)
        .eq("task_config_id", task.id)
        .maybeSingle()

    return NextResponse.json({
        activeTask: task,
        claimed: !!existingClaim,
        claimedAt: existingClaim?.claimed_at ?? null,
    })
}
