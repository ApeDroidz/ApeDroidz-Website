import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
    try {
        // 1. Fetch all active categories from prize_types
        const { data: categories, error: catError } = await supabaseAdmin
            .from("prize_types")
            .select("id, name, type, image_url, xp_reward, drop_chance, amount")
            .eq("is_active", true)
            .order("xp_reward", { ascending: false })

        if (catError) throw catError
        if (!categories || categories.length === 0) return NextResponse.json({ prizes: [] })

        const finalPrizes = []

        // 2. Process each category
        for (const category of categories) {
            if (category.type === "token" || category.type === "shard") {
                // Keep generic logic for non-NFTs. 
                // Note: we inject a stable 'unique_id' for the frontend list mapping
                finalPrizes.push({
                    ...category,
                    categoryId: category.id // preserve the original generic ID
                })
            } else if (category.type === "nft") {
                // 3. For NFTs, fetch specific active items from inventory
                // We fetch exact number of rows based on category.amount (default to 1 if not set)
                const limit = category.amount || 1
                const { data: inventoryItems, error: invError } = await supabaseAdmin
                    .from("nft_inventory")
                    .select("id, name, image_url, token_id, contract_address")
                    .eq("prize_type_id", category.id)
                    .eq("status", "available")
                    .limit(limit)

                if (invError) {
                    console.error(`Failed to fetch inventory for ${category.id}:`, invError)
                    continue // Skip this category if DB fails
                }

                if (inventoryItems && inventoryItems.length > 0) {
                    // Merge each unique inventory item with the generic category stats
                    for (const item of inventoryItems) {
                        finalPrizes.push({
                            // Inherit category stats (drop_chance, xp_reward, type)
                            ...category,
                            // Override generic display fields with unique NFT fields
                            id: category.id,            // Keep category ID so Play API logic still knows what was rolled
                            inventory_id: item.id,      // Pass exact inventory ID for UI matching or debugging
                            name: item.name,            // Specific name, e.g. "ApeDroid #1378"
                            image_url: item.image_url,  // Specific unique image
                            token_id: item.token_id,
                            contract_address: item.contract_address,
                            categoryId: category.id
                        })
                    }
                } else {
                    // No active inventory left for this NFT category.
                    // We simply don't push it to finalPrizes, removing it from the wheel automatically.
                    console.warn(`[Prizes API] Stockout for category: ${category.id}, omitting from wheel.`)
                }
            }
        }

        return NextResponse.json({ prizes: finalPrizes })
    } catch (err: any) {
        console.error("Prizes fetch error:", err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
