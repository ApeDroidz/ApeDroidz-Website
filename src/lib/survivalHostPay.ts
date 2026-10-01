/**
 * The host pages' side of a Droidz Survival purchase (the site, droidz_survival/page.tsx, and the
 * Otherside cabinet, droidz_survival/otherside/page.tsx): the game calls `window.DroidzPay.charge`,
 * the page makes the order, the wallet pays it, and the server books it from the chain.
 *
 * Three rules shared by both doors:
 *   1. One payment at a time. A second charge while one is in flight (Enter pressed twice, a
 *      screen rebuilt by a resize) opens no second order and no second wallet request — it
 *      answers false.
 *   2. Once the wallet has sent, the answer is yes unless the server says a definite no. The
 *      server may be slow or briefly down (5xx, HTML, a network drop) while the money is already on
 *      chain; saying «payment did not go through» then made players pay twice. The pay report is
 *      asked for about a minute; with no definite answer the transaction is taken as sent — every
 *      scene then looks for the credit itself, and the next credits read books it (settlePending).
 *   3. An order the player refused in the wallet is marked cancelled, so it neither counts toward
 *      the hourly order limit nor crowds the pending scan. Nothing else cancels an order: after a
 *      network error the transaction may have gone out.
 */

/** Answers from /api/survival/pay that no amount of asking again will change. */
const FINAL = new Set(['failed', 'mismatch', 'underpaid', 'wrong_mode', 'used', 'no_order', 'late', 'malformed'])
const POLL_MS = 3000
const POLL_FOR_MS = 60_000

export type Order = { ok: true; orderId: string; to: string; valueApe: string; data: string; description?: string }

/** A fresh order for this item, or null (the server said no, or did not answer in 15 s). */
export async function createOrder(sku: string, platform: 'site' | 'otherside'): Promise<Order | null> {
    try {
        const r = await fetch('/api/survival/order', {
            method: 'POST', credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15_000),
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sku, platform, mode: 'solo' }),
        })
        const o = await r.json().catch(() => null)
        return o?.ok ? (o as Order) : null
    } catch {
        return null
    }
}

/** The player said no in the wallet (not a network error, after which the payment may still go out). */
export function isUserRejection(e: unknown): boolean {
    const err = e as { code?: unknown; message?: unknown; shortMessage?: unknown; cause?: unknown } | null
    const code = err?.code ?? (err?.cause as { code?: unknown } | undefined)?.code
    if (code === 4001 || code === 'ACTION_REJECTED') return true
    const msg = `${String(err?.message ?? '')} ${String(err?.shortMessage ?? '')}`
    return /user (rejected|denied)|rejected by (the )?user|request rejected|user cancel|cancelled by user|canceled by user/i.test(msg)
}

/** Marks a refused order closed; fire and forget. */
export function cancelOrder(orderId: string): void {
    void fetch('/api/survival/order', {
        method: 'POST', credentials: 'include', cache: 'no-store', keepalive: true,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cancel: orderId }),
    }).catch(() => undefined)
}

/**
 * Asks the server to book a sent transaction. 'paid' — booked; a final state — refused for good
 * ('late': paid after the order's hour, below today's price — support settles it); 'sent' — no
 * definite answer within the minute: the transaction is out, the credit will follow.
 */
export async function reportPayment(txHash: string, orderId: string): Promise<'paid' | 'sent' | string> {
    const until = Date.now() + POLL_FOR_MS
    for (let attempt = 0; Date.now() < until; attempt++) {
        await new Promise((r) => setTimeout(r, attempt === 0 ? 2500 : POLL_MS))
        try {
            const res = await fetch('/api/survival/pay', {
                method: 'POST', credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15_000),
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash, orderId }),
            })
            const d = await res.json().catch(() => null) as { ok?: boolean; state?: string } | null
            if (d?.ok === true) return 'paid'
            if (d?.state && FINAL.has(d.state)) return d.state
            // not_found (not mined yet), no_server, a 5xx page, 401: ask again.
        } catch { /* the network, for a moment: ask again */ }
    }
    return 'sent'
}

/** Leaves fullscreen — the frame's or the page's — so the wallet's own dialogs on the page show. */
export async function leaveFullscreen(frame: HTMLIFrameElement | null): Promise<void> {
    try {
        const fd = frame?.contentDocument
        if (fd?.fullscreenElement) await fd.exitFullscreen()
    } catch { /* not ours to leave */ }
    try {
        if (document.fullscreenElement) await document.exitFullscreen()
    } catch { /* not ours to leave */ }
}

/** One charge at a time: a second call while one runs answers false and starts nothing. */
export function singleFlight<A extends unknown[]>(fn: (...a: A) => Promise<boolean>): (...a: A) => Promise<boolean> {
    let inflight: Promise<boolean> | null = null
    return (...a: A) => {
        if (inflight) return Promise.resolve(false)
        inflight = fn(...a).finally(() => { inflight = null })
        return inflight
    }
}
