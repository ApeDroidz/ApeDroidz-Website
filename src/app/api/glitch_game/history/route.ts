import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const PAGE_SIZE = 20;

// GET /api/glitch_game/history?scope=global|personal&wallet=0x...&page=1
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope') || 'global';
    const wallet = searchParams.get('wallet');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const offset = (page - 1) * PAGE_SIZE;

    try {
        let query = supabaseAdmin
            .from('game_logs')
            .select('*', { count: 'exact' })
            .eq('status', 'success')
            .order('created_at', { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);

        if (scope === 'personal' && wallet) {
            query = query.ilike('wallet_address', wallet);
        }

        const { data: logs, error: logsError, count } = await query;

        if (logsError) {
            console.error('❌ Error fetching game logs:', logsError.message);
            return NextResponse.json({ error: 'Failed to fetch game logs' }, { status: 500 });
        }

        if (!logs || logs.length === 0) {
            return NextResponse.json({ history: [], hasMore: false, total: count || 0 });
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

        // Collect NFT token IDs from logs to batch-fetch their names/images from nft_inventory
        const nftTokenIds = logs
            .filter((log: any) => {
                const prizeInfo = prizeMap.get(log.prize_type_id) || prizeNameMap.get(log.prize_type_id);
                return (prizeInfo as any)?.type === 'nft' && log.prize_amount_or_id;
            })
            .map((log: any) => log.prize_amount_or_id);

        // Batch-fetch NFT details from nft_inventory
        const nftDetailMap = new Map<string, { name: string; image_url: string; contract_address: string }>();
        if (nftTokenIds.length > 0) {
            const { data: nftItems } = await supabaseAdmin
                .from('nft_inventory')
                .select('token_id, name, image_url, contract_address')
                .in('token_id', nftTokenIds);

            nftItems?.forEach((item: any) => {
                nftDetailMap.set(String(item.token_id), {
                    name: item.name,
                    image_url: item.image_url,
                    contract_address: item.contract_address,
                });
            });
        }

        // Format history
        const history = logs.map((log: any) => {
            const prizeTypeInfo = prizeMap.get(log.prize_type_id) || prizeNameMap.get(log.prize_type_id);
            const isNft = (prizeTypeInfo as any)?.type === 'nft';
            const tokenId = log.prize_amount_or_id ? String(log.prize_amount_or_id) : null;
            const nftDetail = tokenId ? nftDetailMap.get(tokenId) : null;

            const prizeName = isNft && tokenId
                ? (nftDetail?.name || (prizeTypeInfo as any)?.name || log.prize_type_id)
                : ((prizeTypeInfo as any)?.name || log.prize_type_id);

            const imageUrl = isNft
                ? (nftDetail?.image_url || (prizeTypeInfo as any)?.image_url || '')
                : ((prizeTypeInfo as any)?.image_url || '');

            const contractAddress = isNft && tokenId ? (nftDetail?.contract_address || null) : null;

            return {
                id: log.id,
                wallet: log.wallet_address,
                prizeName,
                prizeType: (prizeTypeInfo as any)?.type || 'unknown',
                imageUrl,
                nftTokenId: isNft ? tokenId : null,
                nftContractAddress: contractAddress,
                txHash: log.tx_hash,
                createdAt: log.created_at,
                xpAwarded: log.xp_awarded ? Number(log.xp_awarded) : 0,
            };
        });

        const total = count || 0;
        const hasMore = offset + PAGE_SIZE < total;

        return NextResponse.json({ history, hasMore, total, page });

    } catch (error: any) {
        console.error('🔥 Unhandled history fetch error:', error.message);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
