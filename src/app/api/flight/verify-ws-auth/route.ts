import { NextRequest, NextResponse } from 'next/server'
import { createThirdwebClient, defineChain } from 'thirdweb'
import { verifySignature } from 'thirdweb/auth'
import { requireInternalSecret } from '@/lib/requireInternalSecret'

const thirdwebClient = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
})
const apeChain = defineChain(33139)

/**
 * POST /api/flight/verify-ws-auth
 * Internal — called by game-server to verify a player's WebSocket auth signature.
 * Body: { wallet, nonce, signature }
 *
 * The client must sign the message "Glitch Flight Auth: <nonce>" with their wallet.
 * This proves wallet ownership without requiring a database or session.
 */
export async function POST(req: NextRequest) {
    const denied = requireInternalSecret(req)
    if (denied) return denied

    try {
        const { wallet, nonce, signature } = await req.json()

        if (!wallet || !nonce || !signature) {
            return NextResponse.json({ valid: false, error: 'wallet, nonce, signature required' }, { status: 400 })
        }

        if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
            return NextResponse.json({ valid: false, error: 'Invalid wallet format' }, { status: 400 })
        }

        const message = `Glitch Flight Auth: ${nonce}`
        const isValid = await verifySignature({
            client: thirdwebClient,
            chain: apeChain,
            address: wallet,
            message,
            signature,
        })

        return NextResponse.json({ valid: isValid })
    } catch (err: any) {
        console.error('[verify-ws-auth]', err.message)
        return NextResponse.json({ valid: false, error: 'Verification failed' }, { status: 500 })
    }
}
