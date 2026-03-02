import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAGE_SIZE = 10;

// Helper: is this prize a standard battery (not super)?
function isStandardBattery(name: string): boolean {
    const n = name.toLowerCase();
    return n.includes('battery') && !n.includes('super');
}

// GET /api/glitch_game/top-winners?page=1
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const offset = (page - 1) * PAGE_SIZE;

    try {
        // 1. Fetch ALL prize_types
        const { data: allPrizeTypes, error: ptErr } = await supabaseAdmin
            .from('prize_types')
            .select('id, name, type, image_url, drop_chance')
            .eq('is_active', true);

        if (ptErr) throw ptErr;

        // Classify prize types
        const allNftTypes = (allPrizeTypes || []).filter((pt: any) => pt.type === 'nft');
        const apeTypes = (allPrizeTypes || []).filter((pt: any) =>
            pt.type === 'ape' || pt.type === 'token' ||
            ((pt.name || '').toLowerCase().includes('ape') && pt.type !== 'nft')
        );

        if (allNftTypes.length === 0) {
            return NextResponse.json({ winners: [], hasMore: false, total: 0 });
        }

        // Maps for lookup
        const nftPrizeMap = new Map<string, any>();
        for (const pt of allNftTypes) nftPrizeMap.set(pt.id, pt);

        const apePrizeIds = apeTypes.map((pt: any) => pt.id);
        const allNftPrizeIds = allNftTypes.map((pt: any) => pt.id);

        // 2. Fetch all NFT game logs (including standard batteries now)
        const { data: nftLogs, error: logsErr } = await supabaseAdmin
            .from('game_logs')
            .select('wallet_address, prize_type_id, prize_amount_or_id, created_at')
            .eq('status', 'success')
            .in('prize_type_id', allNftPrizeIds)
            .order('created_at', { ascending: false });

        if (logsErr) throw logsErr;
        if (!nftLogs || nftLogs.length === 0) {
            return NextResponse.json({ winners: [], hasMore: false, total: 0 });
        }

        // 3. Batch-fetch NFT details from nft_inventory
        // Key by 'contract_address/token_id' to avoid cross-collection collisions
        const tokenIds = nftLogs.map((l: any) => l.prize_amount_or_id).filter(Boolean);

        const nftDetailsByContractToken = new Map<string, {
            name: string; image_url: string; contract_address: string; token_id: string;
        }>();
        const nftDetailsByToken = new Map<string, {
            name: string; image_url: string; contract_address: string; token_id: string;
        }[]>();

        if (tokenIds.length > 0) {
            const { data: nftItems } = await supabaseAdmin
                .from('nft_inventory')
                .select('token_id, name, image_url, contract_address')
                .in('token_id', tokenIds);

            (nftItems || []).forEach((item: any) => {
                const tid = String(item.token_id);
                const contract = (item.contract_address || '').toLowerCase();
                const detail = {
                    name: item.name,
                    image_url: item.image_url,
                    contract_address: item.contract_address || '',
                    token_id: tid,
                };
                nftDetailsByContractToken.set(`${contract}/${tid}`, detail);
                if (!nftDetailsByToken.has(tid)) nftDetailsByToken.set(tid, []);
                nftDetailsByToken.get(tid)!.push(detail);
            });
        }

        // 4. Aggregate by wallet
        const walletMap = new Map<string, {
            wallet: string;
            prizes: Array<{
                name: string; image_url: string; drop_chance: number;
                won_at: string; contract_address: string; token_id: string;
            }>;
            standard_battery_count: number;
            standard_battery_sample: { contract_address: string; token_id: string } | null;
            score: number;
            total_ape: number;
        }>();

        for (const log of nftLogs) {
            const prizeInfo = nftPrizeMap.get(log.prize_type_id);
            if (!prizeInfo) continue;

            const tokenId = String(log.prize_amount_or_id || '');
            const dropChance = Number(prizeInfo.drop_chance) || 1;

            // Lookup NFT details from nft_inventory by token_id
            // Try to find best match, preferring non-battery candidates
            let nftDetail: { name: string; image_url: string; contract_address: string; token_id: string } | undefined;
            const candidates = nftDetailsByToken.get(tokenId) || [];
            if (candidates.length === 1) {
                nftDetail = candidates[0];
            } else if (candidates.length > 1) {
                // Prefer non-battery candidates to avoid cross-collection collision
                nftDetail = candidates.find(c => !isStandardBattery(c.name)) ?? candidates[0];
            }

            const finalName = nftDetail?.name || prizeInfo.name || '';
            const rawPrizeTypeName = prizeInfo.name || '';

            // Determine if this is a standard battery (check both prize_type name and resolved NFT name)
            const isBattery = isStandardBattery(finalName) || isStandardBattery(rawPrizeTypeName);

            if (!walletMap.has(log.wallet_address)) {
                walletMap.set(log.wallet_address, {
                    wallet: log.wallet_address,
                    prizes: [],
                    standard_battery_count: 0,
                    standard_battery_sample: null,
                    score: 0,
                    total_ape: 0,
                });
            }

            const entry = walletMap.get(log.wallet_address)!;
            // Batteries contribute to score but are stored as a count, not individual prizes
            entry.score += dropChance > 0 ? (1 / dropChance) * 1000 : 0;

            if (isBattery) {
                entry.standard_battery_count += 1;
                // Save first battery sample for OpenSea link
                if (!entry.standard_battery_sample && nftDetail?.contract_address) {
                    entry.standard_battery_sample = {
                        contract_address: nftDetail.contract_address,
                        token_id: nftDetail.token_id || tokenId,
                    };
                }
            } else {
                entry.prizes.push({
                    name: finalName,
                    image_url: nftDetail?.image_url || prizeInfo.image_url || '',
                    drop_chance: dropChance,
                    won_at: log.created_at,
                    contract_address: nftDetail?.contract_address || '',
                    token_id: nftDetail?.token_id || tokenId,
                });
            }
        }

        // Remove wallets with no qualifying prizes AND no batteries (shouldn't happen but safety check)
        for (const [wallet, entry] of walletMap.entries()) {
            if (entry.prizes.length === 0 && entry.standard_battery_count === 0) {
                walletMap.delete(wallet);
            }
        }

        // 5. Fetch APE token wins for wallets in the set
        if (apePrizeIds.length > 0 && walletMap.size > 0) {
            const walletList = Array.from(walletMap.keys());
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
                    if (entry) entry.total_ape += parseFloat(log.prize_amount_or_id) || 0;
                });
            }
        }

        // 6. Sort and paginate
        const allSorted = Array.from(walletMap.values())
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return (b.prizes.length + b.standard_battery_count) - (a.prizes.length + a.standard_battery_count);
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
            standard_battery_count: entry.standard_battery_count,
            standard_battery_sample: entry.standard_battery_sample,
        }));

        return NextResponse.json({ winners, hasMore, total, page });

    } catch (err: any) {
        console.error('🔥 [Top Winners] Error:', err.message);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
