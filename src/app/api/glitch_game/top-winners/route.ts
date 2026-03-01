import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAGE_SIZE = 10;

// GET /api/glitch_game/top-winners?page=1
// Returns top wallets ranked by prize rarity (NFTs only, super batteries included, standard batteries excluded)
// Also sums up APE token prizes per wallet
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const offset = (page - 1) * PAGE_SIZE;

    try {
        // 1. Fetch ALL prize_types (NFTs + APE tokens)
        const { data: allPrizeTypes, error: ptErr } = await supabaseAdmin
            .from('prize_types')
            .select('id, name, type, image_url, drop_chance')
            .eq('is_active', true);

        if (ptErr) throw ptErr;

        const allPrizeMap = new Map<string, any>();
        for (const pt of allPrizeTypes || []) {
            allPrizeMap.set(pt.id, pt);
        }

        // Eligible NFT prize types (exclude standard batteries)
        const eligibleNftTypes = (allPrizeTypes || []).filter((pt: any) => {
            if (pt.type !== 'nft') return false;
            const nameLower = (pt.name || '').toLowerCase();
            return !nameLower.includes('standard');
        });

        // APE token prize types
        const apeTypes = (allPrizeTypes || []).filter((pt: any) =>
            pt.type === 'ape' || pt.type === 'token' || (pt.name || '').toLowerCase().includes('ape')
        );

        if (eligibleNftTypes.length === 0) {
            return NextResponse.json({ winners: [], hasMore: false, total: 0 });
        }

        const nftPrizeMap = new Map<string, any>();
        for (const pt of eligibleNftTypes) nftPrizeMap.set(pt.id, pt);

        const apePrizeIds = apeTypes.map((pt: any) => pt.id);
        const eligiblePrizeIds = eligibleNftTypes.map((pt: any) => pt.id);

        // 2. Fetch all NFT wins (to build the winner set and ranking)
        const { data: nftLogs, error: logsErr } = await supabaseAdmin
            .from('game_logs')
            .select('wallet_address, prize_type_id, prize_amount_or_id, created_at')
            .eq('status', 'success')
            .in('prize_type_id', eligiblePrizeIds)
            .order('created_at', { ascending: false });

        if (logsErr) throw logsErr;
        if (!nftLogs || nftLogs.length === 0) {
            return NextResponse.json({ winners: [], hasMore: false, total: 0 });
        }

        // 3. Batch-fetch NFT details from nft_inventory
        const tokenIds = nftLogs.map((l: any) => l.prize_amount_or_id).filter(Boolean);

        const nftDetailsMap = new Map<string, {
            name: string;
            image_url: string;
            contract_address: string;
            token_id: string;
        }>();

        if (tokenIds.length > 0) {
            const { data: nftItems } = await supabaseAdmin
                .from('nft_inventory')
                .select('token_id, name, image_url, contract_address')
                .in('token_id', tokenIds);

            (nftItems || []).forEach((item: any) => {
                nftDetailsMap.set(String(item.token_id), {
                    name: item.name,
                    image_url: item.image_url,
                    contract_address: item.contract_address || '',
                    token_id: String(item.token_id),
                });
            });
        }

        // 4. Aggregate NFT wins by wallet
        const walletMap = new Map<string, {
            wallet: string;
            prizes: Array<{
                name: string;
                image_url: string;
                drop_chance: number;
                won_at: string;
                contract_address: string;
                token_id: string;
            }>;
            score: number;
            total_ape: number;
        }>();

        for (const log of nftLogs) {
            const prizeInfo = nftPrizeMap.get(log.prize_type_id);
            if (!prizeInfo) continue;

            const tokenId = String(log.prize_amount_or_id || '');
            const nftDetail = nftDetailsMap.get(tokenId);
            const dropChance = Number(prizeInfo.drop_chance) || 1;

            if (!walletMap.has(log.wallet_address)) {
                walletMap.set(log.wallet_address, { wallet: log.wallet_address, prizes: [], score: 0, total_ape: 0 });
            }

            const entry = walletMap.get(log.wallet_address)!;
            entry.prizes.push({
                name: nftDetail?.name || prizeInfo.name,
                image_url: nftDetail?.image_url || prizeInfo.image_url || '',
                drop_chance: dropChance,
                won_at: log.created_at,
                contract_address: nftDetail?.contract_address || '',
                token_id: nftDetail?.token_id || tokenId,
            });
            entry.score += dropChance > 0 ? (1 / dropChance) * 1000 : 0;
        }

        // 5. Fetch APE token wins for wallets that appear in the winner set
        if (apePrizeIds.length > 0 && walletMap.size > 0) {
            const walletList = Array.from(walletMap.keys());

            // Fetch in chunks to avoid query limits (max 100 wallets per query)
            for (let i = 0; i < walletList.length; i += 100) {
                const chunk = walletList.slice(i, i + 100);
                const { data: apeLogs } = await supabaseAdmin
                    .from('game_logs')
                    .select('wallet_address, prize_amount_or_id')
                    .eq('status', 'success')
                    .in('prize_type_id', apePrizeIds)
                    .in('wallet_address', chunk);

                (apeLogs || []).forEach((log: any) => {
                    const entry = walletMap.get(log.wallet_address);
                    if (entry) {
                        const amount = parseFloat(log.prize_amount_or_id) || 0;
                        entry.total_ape += amount;
                    }
                });
            }
        }

        // 6. Sort and paginate
        const allSorted = Array.from(walletMap.values())
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return b.prizes.length - a.prizes.length;
            });

        const total = allSorted.length;
        const paginated = allSorted.slice(offset, offset + PAGE_SIZE);
        const hasMore = offset + PAGE_SIZE < total;

        const winners = paginated.map((entry, i) => ({
            wallet: entry.wallet,
            rank: offset + i + 1,
            score: Math.round(entry.score),
            total_ape: Math.round(entry.total_ape),
            prizes: entry.prizes.sort((a, b) => a.drop_chance - b.drop_chance),
            total_prizes: entry.prizes.length,
        }));

        return NextResponse.json({ winners, hasMore, total, page });

    } catch (err: any) {
        console.error('🔥 [Top Winners] Error:', err.message);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
