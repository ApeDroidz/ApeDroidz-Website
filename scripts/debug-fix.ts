import { supabaseAdmin } from "@/lib/supabase"

export async function main() {
    console.log("--- Checking table: daily_claims_log ---")
    if (!supabaseAdmin) {
        console.error("❌ supabaseAdmin is null")
        return
    }

    // Insert a dummy row with valid data to see what fails, 
    // or just select * limit 1 to see structure if possible (but select * doesn't show columns if empty)
    // Better: try to select specific columns I expect.

    const { data, error } = await supabaseAdmin
        .from("daily_claims_log")
        .select("wallet_address, task_config_id, proof_link")
        .limit(1)

    if (error) {
        console.error("❌ SELECT error:", error.message)
        console.error("Code:", error.code)
        console.error("Details:", error.details)
        // hint: 42703 means column does not exist
    } else {
        console.log("✅ SELECT successful. Columns exist.")
    }

    console.log("\n--- Checking File System for Favicon ---")
    const fs = require('fs')
    const filesToCheck = [
        'src/app/favicon.ico',
        'public/favicon.ico',
        'src/app/icon.png',
        'public/icon.png'
    ]

    filesToCheck.forEach(f => {
        try {
            const stats = fs.statSync(f)
            console.log(`✅ Found ${f} (${stats.size} bytes)`)
        } catch (e) {
            console.log(`❌ Missing ${f}`)
        }
    })
}

main().catch(console.error)
