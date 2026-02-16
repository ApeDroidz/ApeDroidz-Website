import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
    const log: string[] = []

    log.push("--- CHECKING COLUMNS: daily_claims_log ---")
    if (!supabaseAdmin) {
        return new Response("supabaseAdmin missing", { status: 500 })
    }

    // Query information_schema to get actual column names
    // valid for postgres
    const { data: columns, error } = await supabaseAdmin
        .rpc('get_claims_columns') // attempt RPC if exists? No, try direct SQL if enabled? No.
    // simpler: valid supabase query on valid table?
    // We can't access information_schema via standard client usually unless exposed?
    // Let's try raw SQL via rpc if user has 'exec' function? Probably not.
    // Let's try to Selecting * from daily_claims_log limit 0? 
    // It returns data: [] but no columns info if empty.

    // Fallback: Check if specific columns exist by selecting them one by one.

    // 1. Check 'task_id'
    const { error: errId } = await supabaseAdmin.from('daily_claims_log').select('task_id').limit(1)
    log.push(`Column 'task_id' exists? ${!errId ? 'YES' : 'NO (' + errId.code + ')'}`)

    // 2. Check 'task_config_id'
    const { error: errConfig } = await supabaseAdmin.from('daily_claims_log').select('task_config_id').limit(1)
    log.push(`Column 'task_config_id' exists? ${!errConfig ? 'YES' : 'NO (' + errConfig.code + ')'}`)

    // 3. Check 'proof_link'
    const { error: errProof } = await supabaseAdmin.from('daily_claims_log').select('proof_link').limit(1)
    log.push(`Column 'proof_link' exists? ${!errProof ? 'YES' : 'NO (' + errProof.code + ')'}`)

    return new Response(log.join("\n"), {
        headers: { "Content-Type": "text/plain" }
    })
}
