'use client'

/**
 * The Droidz Survival funnel (owner, 03.10.2026: «простая воронка: лендинг → PLAY → кошелёк →
 * подпись → первый забег → покупка»). The site's half of it: the landing view, the PLAY click, the
 * wallet connected and the signature, each sent once per page load to POST /api/survival/funnel
 * with an anonymous id kept in this browser — no wallet, no cookie, nothing that names a person.
 *
 * Fire-and-forget: a failed or missing endpoint never shows up for the player (keepalive lets the
 * PLAY click be sent while the browser is already leaving for /play).
 */
export type FunnelStep = 'landing_view' | 'play_click' | 'wallet_connected' | 'signed_in'

const KEY = 'ds_anon_id'
let memoId: string | null = null
const sent = new Set<FunnelStep>()

/** A random id for this browser, kept in localStorage; a fresh one per page when storage is closed. */
export function anonId(): string {
    if (memoId) return memoId
    let id: string | null = null
    try { id = localStorage.getItem(KEY) } catch { /* private mode, blocked storage */ }
    if (!id || !/^[a-z0-9-]{8,64}$/i.test(id)) {
        try {
            id = crypto.randomUUID()
        } catch {
            id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
        }
        try { localStorage.setItem(KEY, id) } catch { /* kept for this page only */ }
    }
    memoId = id
    return id
}

/** Sends a step once per page load. `again` sends it even if it went already (each PLAY click). */
export function trackFunnel(step: FunnelStep, opts: { again?: boolean } = {}): void {
    if (typeof window === 'undefined') return
    if (sent.has(step) && !opts.again) return
    sent.add(step)
    try {
        void fetch('/api/survival/funnel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step, anonId: anonId() }),
            credentials: 'include',
            keepalive: true,
        }).catch(() => {})
    } catch { /* never in the player's way */ }
}
