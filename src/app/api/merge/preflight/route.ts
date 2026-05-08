import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SHARDS_PER_BATTERY = 30
const STANDARD_BATTERY_PRIZE_TYPE_ID = 'std_battery'

/**
 * GET /api/merge/preflight?shardCount=300
 *
 * Cheap check the UI runs BEFORE asking the user to sign the on-chain
 * shard transfer. Returns the inventory the server would actually be able
 * to fulfil from. The UI must block the merge button if `ok === false`,
 * otherwise the user transfers shards on-chain and the server returns 503
 * with no way to recover them automatically.
 *
 * Response:
 *   { ok, available, needed, shortfall, shardsPerBattery }
 *   - ok          : true  iff `available >= needed`
 *   - available   : count of std_battery rows currently `available`
 *   - needed      : batteries the requested shardCount would mint
 *   - shortfall   : max(0, needed − available) — non-zero means UI must block
 *
 * Race condition note: between this check and POST /api/merge/shards another
 * user could grab the last batteries. The shards POST handler ALSO refuses
 * AND auto-refunds remaining shards on-chain to keep the player whole.
 */
export async function GET(req: NextRequest) {
    const raw = req.nextUrl.searchParams.get('shardCount')
    const shardCount = Number.parseInt(raw ?? '0', 10)

    if (!Number.isInteger(shardCount) || shardCount <= 0 || shardCount % SHARDS_PER_BATTERY !== 0) {
        return NextResponse.json(
            { error: `shardCount must be a positive multiple of ${SHARDS_PER_BATTERY}` },
            { status: 400 },
        )
    }

    const needed = shardCount / SHARDS_PER_BATTERY

    const { count, error } = await supabaseAdmin
        .from('nft_inventory')
        .select('id', { count: 'exact', head: true })
        .eq('prize_type_id', STANDARD_BATTERY_PRIZE_TYPE_ID)
        .eq('status', 'available')

    if (error) {
        return NextResponse.json({ error: `inventory query failed: ${error.message}` }, { status: 500 })
    }

    const available = count ?? 0
    const shortfall = Math.max(0, needed - available)

    return NextResponse.json(
        {
            ok: shortfall === 0,
            available,
            needed,
            shortfall,
            shardsPerBattery: SHARDS_PER_BATTERY,
        },
        { headers: { 'cache-control': 'no-store' } },
    )
}
