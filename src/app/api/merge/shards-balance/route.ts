import { NextRequest, NextResponse } from "next/server";
import { createThirdwebClient, getContract, defineChain } from "thirdweb";
import { balanceOf } from "thirdweb/extensions/erc1155";
import { supabaseAdmin } from "@/lib/supabase";

const client = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
    secretKey: process.env.THIRDWEB_SECRET_KEY,
});
const apeChain = defineChain(33139);
const SHARD_CONTRACT_ADDRESS = process.env.SHARD_CONTRACT_ADDRESS!;
const STANDARD_BATTERY_PRIZE_TYPE_ID = 'std_battery';

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        const wallet = req.nextUrl.searchParams.get("wallet");
        if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });

        if (!SHARD_CONTRACT_ADDRESS) {
            return NextResponse.json({ balance: 0, previewImageUrl: null });
        }

        const shardContract = getContract({ client, chain: apeChain, address: SHARD_CONTRACT_ADDRESS });
        const balance = await balanceOf({
            contract: shardContract,
            owner: wallet,
            tokenId: BigInt(0),
        });

        // Fetch a preview image from the next available standard battery
        let previewImageUrl: string | null = null;
        const { data: previewItem } = await supabaseAdmin
            .from("nft_inventory")
            .select("image_url")
            .eq("status", "available")
            .eq("prize_type_id", STANDARD_BATTERY_PRIZE_TYPE_ID)
            .limit(1)
            .maybeSingle();
        previewImageUrl = previewItem?.image_url || null;

        return NextResponse.json({ balance: Number(balance), previewImageUrl });
    } catch (err: any) {
        console.error("[shards-balance]", err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
