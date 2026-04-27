import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createThirdwebClient, defineChain, getContract } from 'thirdweb'
import { balanceOf } from 'thirdweb/extensions/erc721'
import { isValidWallet } from '@/lib/walletAuth'

export const dynamic = 'force-dynamic'

const thirdwebClient = createThirdwebClient({ clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID! })
const apeChain = defineChain(33139)
const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ''

export async function GET(req: NextRequest) {
    const wallet = req.nextUrl.searchParams.get('wallet')

    if (!wallet || !isValidWallet(wallet)) {
        return NextResponse.json({ error: 'Wallet required' }, { status: 400 })
    }

    try {
        // Check holder status (NFT balance) — wallet is already regex-validated
        let isHolder = false
        try {
            const droidContract = getContract({ client: thirdwebClient, chain: apeChain, address: DROID_CONTRACT_ADDRESS })
            const bal = await balanceOf({ contract: droidContract, owner: wallet })
            isHolder = bal > BigInt(0)
        } catch {
            // Fallback to DB
            const { data } = await supabaseAdmin
                .from('users')
                .select('droids_count')
                .eq('wallet_address', wallet.toLowerCase())
                .maybeSingle()
            isHolder = (data?.droids_count ?? 0) > 0
        }

        // Fetch all dashboard data via RPC
        const { data, error } = await supabaseAdmin
            .rpc('get_glitch_dashboard', {
                p_wallet: wallet.toLowerCase(),
                p_is_holder: isHolder,
            })

        if (error) {
            console.error('[GlitchDashboard] RPC error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        if (!data) {
            console.error('[GlitchDashboard] RPC returned null for wallet:', wallet)
            return NextResponse.json({ error: 'No data returned from RPC' }, { status: 500 })
        }

        // data is already a parsed JSON object when RETURNS JSON
        const payload = typeof data === 'string' ? JSON.parse(data) : data

        return NextResponse.json({ ...payload, isHolder })

    } catch (err: any) {
        console.error('[GlitchDashboard] Error:', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
