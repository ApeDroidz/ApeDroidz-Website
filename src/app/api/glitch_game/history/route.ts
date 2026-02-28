import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/glitch_game/history
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope') || 'global';
    const wallet = searchParams.get('wallet');

    try {
        let query = supabaseAdmin
            .from('game_logs')
            .select('*')
            .eq('status', 'success')
            .order('created_at', { ascending: false })
            .limit(20);

        if (scope === 'personal' && wallet) {
            query = query.ilike('wallet_address', wallet);
        }

        const { data: logs, error: logsError } = await query;

        if (logsError) {
            console.error('❌ Error fetching game logs:', logsError.message);
            return NextResponse.json({ error: 'Failed to fetch game logs' }, { status: 500 });
        }

        if (!logs || logs.length === 0) {
            return NextResponse.json({ history: [] });
        }

        // Fetch prize_types to map IDs to Names
        const { data: prizeTypes, error: prizeError } = await supabaseAdmin
            .from('prize_types')
            .select('id, name, type, image_url');

        if (prizeError) {
            console.error('❌ Error fetching prize types:', prizeError.message);
            return NextResponse.json({ error: 'Failed to fetch prize types' }, { status: 500 });
        }

        const prizeMap = new Map(prizeTypes?.map((pt: any) => [String(pt.id), pt]));
        const prizeNameMap = new Map(prizeTypes?.map((pt: any) => [pt.name, pt]));

        // Collect NFT token IDs from logs to batch-fetch their names from nft_inventory
        const nftTokenIds = logs
            .filter((log: any) => {
                const prizeInfo = prizeMap.get(log.prize_type_id) || prizeNameMap.get(log.prize_type_id);
                return (prizeInfo as any)?.type === 'nft' && log.prize_amount_or_id;
            })
            .map((log: any) => log.prize_amount_or_id);

        // Batch-fetch NFT names from nft_inventory (one query, not N)
        const nftNameMap = new Map<string, string>();
        if (nftTokenIds.length > 0) {
            const { data: nftItems } = await supabaseAdmin
                .from('nft_inventory')
                .select('token_id, name')
                .in('token_id', nftTokenIds);

            nftItems?.forEach((item: any) => {
                nftNameMap.set(String(item.token_id), item.name);
            });
        }

        // Format history
        const history = logs.map((log: any) => {
            const prizeTypeInfo = prizeMap.get(log.prize_type_id) || prizeNameMap.get(log.prize_type_id);
            const isNft = (prizeTypeInfo as any)?.type === 'nft';

            // For NFTs: use real name from nft_inventory; fallback to prize_types name, then raw id
            const prizeName = isNft && log.prize_amount_or_id
                ? (nftNameMap.get(String(log.prize_amount_or_id)) || (prizeTypeInfo as any)?.name || log.prize_type_id)
                : ((prizeTypeInfo as any)?.name || log.prize_type_id);

            return {
                id: log.id,
                wallet: log.wallet_address,
                prizeName,
                txHash: log.tx_hash,
                createdAt: log.created_at,
            };
        });

        return NextResponse.json({ history });

    } catch (error: any) {
        console.error('🔥 Unhandled history fetch error:', error.message);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
