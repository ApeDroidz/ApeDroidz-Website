/**
 * Otherside Hub ↔ partner iframe wallet bridge — the GlyphSDK from the Otherside partner guide
 * (gist by James Hall, «Partner Wallet Bridge», 2026). The protocol is theirs and is kept as
 * written: wait for `glyph:ready`, echo its `sessionNonce` on every request, accept replies only
 * from the Hub's origin, post only to it. Every transaction and signature is confirmed by the
 * player in a Hub dialog we cannot skip or pre-approve.
 *
 * Our one addition is `pickHubOrigin`: the page may be framed by the real Hub or, on a dev/preview
 * build, by our own stand-in (/droidz_survival/otherside/dev-hub). The SDK is still bound to exactly one origin —
 * the one actually framing us, and only if it is on the allowed list.
 */

export type GlyphReadyPayload = {
    walletAddress: string
    chainId: number
    sessionNonce?: string
    username?: string
    profileImageUrl?: string
}

type GlyphResultPayload = { hash?: string; signature?: string }
type GlyphErrorPayload = { code: string; message: string }
type PendingRequest = { resolve: (value: GlyphResultPayload) => void; reject: (error: GlyphErrorPayload) => void }

export type SendTransactionParams = {
    to: string
    /** Shown to the player in the Hub's confirmation dialog — required, and must be honest. */
    description: string
    /** Decimal APE, e.g. "1". A 1.5% Hub fee is taken from native value. */
    value?: string
    data?: string
    sponsored?: boolean
    paymaster?: { bundlerUrl: string; policyId: string }
}

export const OTHERSIDE_HUB_ORIGIN = 'https://www.otherside.xyz'

/** The origin framing this page, if it is one we accept; null otherwise. */
export function pickHubOrigin(allowed: string[]): string | null {
    if (typeof window === 'undefined' || window.parent === window) return null
    const candidates: string[] = []
    const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins
    if (ancestors && ancestors.length > 0) candidates.push(ancestors[0])
    if (document.referrer) {
        try { candidates.push(new URL(document.referrer).origin) } catch { /* ignore */ }
    }
    return candidates.find((o) => allowed.includes(o)) ?? null
}

export class GlyphSDK {
    private hubOrigin: string
    private readyPromise: Promise<GlyphReadyPayload>
    private resolveReady!: (value: GlyphReadyPayload) => void
    private pendingRequests = new Map<string, PendingRequest>()
    private walletAddress: string | null = null
    private chainId: number | null = null
    private sessionNonce: string | null = null

    constructor(hubOrigin: string) {
        this.hubOrigin = hubOrigin
        this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve })
        window.addEventListener('message', this.handleMessage)
        // A `glyph:ready` that came before we were listening (app/droidz_survival/otherside/layout.tsx keeps them).
        const early = (window as Window & { __glyphEarly?: Array<{ origin: string; data: unknown }> }).__glyphEarly ?? []
        for (const e of early) if (e.origin === hubOrigin) this.handleMessage({ origin: e.origin, data: e.data } as MessageEvent)
    }

    private handleMessage = (event: MessageEvent) => {
        if (event.origin !== this.hubOrigin) return
        const { type, id, payload } = event.data ?? {}
        if (type === 'glyph:ready' && payload) {
            this.walletAddress = payload.walletAddress
            this.chainId = payload.chainId
            this.sessionNonce = payload.sessionNonce ?? null
            this.resolveReady(payload)
            return
        }
        if (type === 'glyph:result' && id) {
            const pending = this.pendingRequests.get(id)
            if (pending) { pending.resolve(payload); this.pendingRequests.delete(id) }
            return
        }
        if (type === 'glyph:error' && id) {
            const pending = this.pendingRequests.get(id)
            if (pending) { pending.reject(payload); this.pendingRequests.delete(id) }
        }
    }

    private sendToHub(message: object) {
        if (window.parent === window) throw new Error('GlyphSDK must be used inside an iframe')
        window.parent.postMessage(message, this.hubOrigin)
    }

    verifyEnvironment(): { valid: boolean; reason?: string } {
        if (window.parent === window) return { valid: false, reason: 'Not running inside an iframe' }
        if (document.referrer) {
            try {
                if (new URL(document.referrer).origin !== this.hubOrigin) return { valid: false, reason: 'Referrer origin does not match expected Hub origin' }
            } catch {
                return { valid: false, reason: 'Could not parse referrer URL' }
            }
        }
        return { valid: true }
    }

    waitForReady(): Promise<GlyphReadyPayload> { return this.readyPromise }
    getWalletAddress(): string | null { return this.walletAddress }
    getChainId(): number | null { return this.chainId }

    async sendTransaction(params: SendTransactionParams): Promise<string> {
        await this.readyPromise
        const id = crypto.randomUUID()
        return new Promise<string>((resolve, reject) => {
            this.pendingRequests.set(id, {
                resolve: (p) => resolve(p.hash!),
                reject: (e) => reject(Object.assign(new Error(e.message), { code: e.code })),
            })
            this.sendToHub({ type: 'glyph:sendTransaction', id, nonce: this.sessionNonce, payload: params })
        })
    }

    async signMessage(message: string): Promise<string> {
        await this.readyPromise
        const id = crypto.randomUUID()
        return new Promise<string>((resolve, reject) => {
            this.pendingRequests.set(id, {
                resolve: (p) => resolve(p.signature!),
                reject: (e) => reject(Object.assign(new Error(e.message), { code: e.code })),
            })
            this.sendToHub({ type: 'glyph:signMessage', id, nonce: this.sessionNonce, payload: { message } })
        })
    }

    destroy() {
        window.removeEventListener('message', this.handleMessage)
        this.pendingRequests.clear()
    }
}
