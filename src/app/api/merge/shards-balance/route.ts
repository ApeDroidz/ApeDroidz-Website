import { NextRequest, NextResponse } from "next/server";
import { createThirdwebClient, getContract } from "thirdweb";
import { balanceOf } from "thirdweb/extensions/erc1155";
import { supabaseAdmin } from "@/lib/supabase";
import { apeChainServer } from '@/lib/apechain'

const client = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
    secretKey: process.env.THIRDWEB_SECRET_KEY,
});
const apeChain = apeChainServer;
const SHARD_CONTRACT_ADDRESS = process.env.SHARD_CONTRACT_ADDRESS!;
const STANDARD_BATTERY_PRIZE_TYPE_ID = 'std_battery';

export const dynamic = "force-dynamic";
export const fetchCache = 'force-no-store';

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

        // Fetch a preview image for shards from prize_types
        let shardImageUrl: string | null = null;
        const { data: shardPrize } = await supabaseAdmin
            .from("prize_types")
            .select("image_url")
            .eq("type", "shard")
            .limit(1)
            .maybeSingle();
        shardImageUrl = shardPrize?.image_url || null;

        console.log(`[API] Returning shard balance for ${wallet}: ${balance} from contract: ${SHARD_CONTRACT_ADDRESS}`);
        return NextResponse.json({ balance: Number(balance), imageUrl: shardImageUrl });
    } catch (err: any) {
        console.error("[shards-balance]", err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
