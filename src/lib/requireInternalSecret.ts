import { timingSafeEqual } from 'crypto'

/**
 * Guards internal API endpoints that should only be callable by the game-server,
 * not by end-users or external parties.
 *
 * Usage:
 *   const denied = requireInternalSecret(req)
 *   if (denied) return denied
 *
 * The caller must supply the header:
 *   X-Internal-Secret: <GAME_SERVER_SECRET env var>
 *
 * Optionally, GAME_SERVER_IP can be set to the game-server's egress IP.
 * When set, requests from any other IP are rejected regardless of the secret.
 * This adds a second factor: attacker needs BOTH the secret AND the server IP.
 */
export function requireInternalSecret(req: Request): Response | null {
    const secret = process.env.GAME_SERVER_SECRET

    // Fail closed: if the env var is not set or is the placeholder, deny all requests
    if (!secret || secret.startsWith('change_me')) {
        console.error('[security] GAME_SERVER_SECRET is not configured — blocking internal endpoint')
        return Response.json({ error: 'Service misconfigured' }, { status: 503 })
    }

    // Optional IP whitelist — set GAME_SERVER_IP in env to the game-server's egress IP
    // Example: GAME_SERVER_IP=1.2.3.4  or  GAME_SERVER_IP=1.2.3.4,5.6.7.8 (comma-separated)
    const allowedIps = process.env.GAME_SERVER_IP
    if (allowedIps) {
        const callerIp = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
        const whitelist = allowedIps.split(',').map(s => s.trim())
        if (!callerIp || !whitelist.includes(callerIp)) {
            console.warn('[security] Rejected internal endpoint call — IP not whitelisted', { callerIp })
            return Response.json({ error: 'Forbidden' }, { status: 403 })
        }
    }

    const provided = req.headers.get('x-internal-secret')

    if (!provided) {
        console.warn('[security] Rejected internal endpoint call — missing X-Internal-Secret')
        return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Timing-safe comparison to prevent timing-based secret extraction
    let match = false
    try {
        const secretBuf   = Buffer.from(secret,   'utf8')
        const providedBuf = Buffer.from(provided, 'utf8')
        // timingSafeEqual requires equal-length buffers; length mismatch is itself a mismatch
        if (secretBuf.length === providedBuf.length) {
            match = timingSafeEqual(secretBuf, providedBuf)
        }
    } catch {
        match = false
    }

    if (!match) {
        console.warn('[security] Rejected internal endpoint call — bad X-Internal-Secret')
        return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    return null // allowed
}
