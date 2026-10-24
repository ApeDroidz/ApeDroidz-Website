/**
 * The server's clock, as seen from the browser.
 *
 * A login nonce carries a timestamp, and the server accepts it only within a few minutes of ITS
 * clock (walletAuth.isFreshNonce). The browser used to stamp it with its own `Date.now()` — so a PC
 * whose clock ran a few minutes off (a Windows box with time sync off, a wrong manual time) could
 * never sign in: «INVALID OR EXPIRED NONCE» on every click, 24.10.2026.
 *
 * Every auth response now says what time the server has (`now` in the JSON, the `Date` header as a
 * fallback); the offset is kept here and the nonce is stamped with `serverNow()`. No request is made
 * for it: the offset arrives with the /me check the page does anyway on connect, so nothing networked
 * runs between the click and the wallet (the phone deep-link rule in useGlitchSession).
 */

let offsetMs = 0

/** Record the server's time from a response that was sent at `sentAt` (browser ms). */
export function noteServerClock(res: Response, body: unknown, sentAt: number): void {
    const receivedAt = Date.now()
    let server = NaN
    const fromBody = (body as { now?: unknown } | null)?.now
    if (typeof fromBody === 'number' && Number.isFinite(fromBody)) server = fromBody
    else {
        const h = res.headers.get('date')
        if (h) server = Date.parse(h)
    }
    if (!Number.isFinite(server)) return
    // The server read its clock somewhere in the round trip: the middle is the best guess.
    offsetMs = server - (sentAt + receivedAt) / 2
}

/** `Date.now()` corrected to the server's clock. */
export function serverNow(): number {
    return Date.now() + offsetMs
}
