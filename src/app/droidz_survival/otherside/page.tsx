'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { GlyphSDK, OTHERSIDE_HUB_ORIGIN, pickHubOrigin, type GlyphReadyPayload } from '@/lib/glyph-sdk'
import { othersideLoginMessage } from '@/lib/othersideMessage'

/**
 * Droidz Survival in the Otherside arcade cabinet.
 *
 * The cabinet opens the Hub overlay (`otherside.xyz/overlays/experience?url=<this page>`), which
 * holds the player's Glyph wallet and frames us. This page:
 *   1. binds the GlyphSDK to the origin framing it — the Hub, or our stand-in on dev/preview —
 *      and refuses to run anywhere else (a phishing page embedding us gets nothing);
 *   2. waits for the Hub's `glyph:ready` (the wallet);
 *   3. reuses a session if this wallet already signed in here, otherwise asks for ONE signature
 *      in the Hub dialog (free, no transaction) and gets partitioned session + play cookies
 *      (api/otherside/login) — the same tokens the game checks on the site;
 *   4. runs the very same build as the site (/droidz_survival/play/) in a frame and hands it
 *      `window.DroidzPay`, backed by Glyph instead of thirdweb.
 * One game, one save, one season board: the Glyph wallet is the player.
 */

const DEV_HUB = process.env.NEXT_PUBLIC_OTHERSIDE_DEV_HUB === '1' || process.env.NODE_ENV !== 'production'
const PAY_FOR_REAL = process.env.NEXT_PUBLIC_SURVIVAL_PAY_FOR_REAL === '1'
const CASHIER = process.env.NEXT_PUBLIC_SURVIVAL_CASHIER ?? ''

type Phase =
    | { k: 'outside' }                                   // opened directly, not from the Hub
    | { k: 'waiting' }                                   // waiting for the Hub's wallet
    | { k: 'sign'; busy: boolean; error?: string }       // needs one signature
    | { k: 'denied'; wallet: string }
    | { k: 'playing'; wallet: string }
    | { k: 'error'; message: string }

const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`

export default function OthersideCabinet() {
    const [phase, setPhase] = useState<Phase>({ k: 'waiting' })
    const [hubUser, setHubUser] = useState<GlyphReadyPayload | null>(null)
    const [slow, setSlow] = useState(false)
    const sdkRef = useRef<GlyphSDK | null>(null)
    const frameRef = useRef<HTMLIFrameElement>(null)

    // 1–3: find the Hub, wait for the wallet, reuse or ask for a session.
    useEffect(() => {
        // Dev/preview: our own stand-in hub, on this origin or on the local twin (127.0.0.1 ↔
        // localhost) used to test the cabinet as a real third-party frame.
        const devHubs = DEV_HUB ? [window.location.origin, window.location.origin.replace('localhost', '127.0.0.1')] : []
        const allowed = [OTHERSIDE_HUB_ORIGIN, ...devHubs]
        const hub = pickHubOrigin(allowed)
        if (!hub) { setPhase({ k: 'outside' }); return }
        const sdk = new GlyphSDK(hub)
        sdkRef.current = sdk
        const env = sdk.verifyEnvironment()
        if (!env.valid) { setPhase({ k: 'error', message: `Unsafe environment: ${env.reason}` }); return }
        let alive = true
        void sdk.waitForReady().then(async (ready) => {
            if (!alive) return
            setHubUser(ready)
            const wallet = ready.walletAddress.toLowerCase()
            try {
                const r = await fetch('/api/otherside/login', { credentials: 'include', cache: 'no-store' })
                const d = await r.json().catch(() => ({}))
                if (d.wallet === wallet && d.state === 'allowed') { setPhase({ k: 'playing', wallet }); return }
                if (d.wallet === wallet && d.state === 'denied') { setPhase({ k: 'denied', wallet }); return }
            } catch { /* fall through to signing */ }
            setPhase({ k: 'sign', busy: false })
        })
        return () => { alive = false; sdk.destroy(); sdkRef.current = null }
    }, [])

    // The Hub sends the wallet once its own sign-in is done; say something if that takes a while.
    useEffect(() => {
        if (phase.k !== 'waiting') return
        const t = setTimeout(() => setSlow(true), 15_000)
        return () => clearTimeout(t)
    }, [phase.k])

    const signIn = useCallback(async () => {
        const sdk = sdkRef.current
        const wallet = sdk?.getWalletAddress()?.toLowerCase()
        if (!sdk || !wallet) return
        setPhase({ k: 'sign', busy: true })
        try {
            const nonce = `${Date.now()}.${crypto.randomUUID()}`
            const signature = await sdk.signMessage(othersideLoginMessage(wallet, nonce))
            const r = await fetch('/api/otherside/login', {
                method: 'POST', credentials: 'include', cache: 'no-store',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ wallet, nonce, signature }),
            })
            const d = await r.json().catch(() => ({}))
            if (!r.ok) { setPhase({ k: 'sign', busy: false, error: d?.error ?? `Sign-in failed (${r.status})` }); return }
            setPhase(d.state === 'allowed' ? { k: 'playing', wallet } : { k: 'denied', wallet })
        } catch (e) {
            const msg = (e as Error).message || 'Signature rejected'
            setPhase({ k: 'sign', busy: false, error: /reject/i.test(msg) ? 'You closed the signature request — sign to play.' : msg })
        }
    }, [])

    // 4: the paid door, backed by the Hub wallet. Beta: a stand-in that charges nothing, the same
    // as on the site. The real path (a cashier contract with server-checked orders) switches on
    // with PAY_FOR_REAL + NEXT_PUBLIC_SURVIVAL_CASHIER.
    const installPay = useCallback(() => {
        const win = frameRef.current?.contentWindow as (Window & { DroidzPay?: unknown; DroidzHost?: unknown }) | null
        if (!win) return
        win.DroidzHost = { platform: 'otherside', username: hubUser?.username ?? null }
        const real = PAY_FOR_REAL && !!CASHIER
        win.DroidzPay = {
            stub: !real,
            charge: async (kind: 'continue' | 'run' | 'run10'): Promise<boolean> => {
                if (!real) { await new Promise((r) => setTimeout(r, 500)); return true }
                const sdk = sdkRef.current
                if (!sdk) return false
                try {
                    const o = await fetch('/api/survival/order', {
                        method: 'POST', credentials: 'include', cache: 'no-store',
                        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sku: kind, platform: 'otherside', mode: 'solo' }),
                    }).then((r) => r.json())
                    if (!o?.ok) return false
                    const hash = await sdk.sendTransaction({ to: o.to, value: o.valueApe, data: o.data, description: o.description })
                    for (let attempt = 0; attempt < 6; attempt++) {
                        await new Promise((r) => setTimeout(r, attempt === 0 ? 3000 : 2500))
                        const d = await fetch('/api/survival/pay', {
                            method: 'POST', credentials: 'include', cache: 'no-store',
                            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: hash, orderId: o.orderId }),
                        }).then((r) => r.json()).catch(() => ({}))
                        if (d?.ok === true) return true
                        if (d?.state !== 'not_found') return false
                    }
                    return false
                } catch {
                    return false
                }
            },
        }
    }, [hubUser])

    if (phase.k === 'playing') {
        return (
            <iframe
                ref={frameRef}
                src="/droidz_survival/play/index.html"
                title="Droidz Survival"
                onLoad={installPay}
                allow="autoplay; fullscreen; gamepad; clipboard-write"
                className="fixed inset-0 w-full h-full border-0 bg-[#0a0f1e]"
            />
        )
    }

    return (
        <main className="fixed inset-0 flex items-center justify-center bg-[#0a0f1e] text-white px-4">
            <div className="w-full max-w-md text-center space-y-5">
                <div className="text-3xl font-black uppercase tracking-tighter">Droidz Survival</div>
                {phase.k === 'outside' && (
                    <p className="text-white/60 text-sm">This page is the Otherside arcade cabinet. To play in the browser, go to{' '}
                        <a className="text-[#3b82f6] underline" href="https://www.apedroidz.com/droidz_survival" target="_top">apedroidz.com/droidz_survival</a>.</p>
                )}
                {phase.k === 'waiting' && <p className="text-white/50 text-sm animate-pulse">Connecting to your Otherside wallet…</p>}
                {phase.k === 'waiting' && slow && <p className="text-white/40 text-xs">Still waiting for the wallet. Make sure you are signed in to Otherside, then close and reopen the cabinet.</p>}
                {phase.k === 'sign' && (
                    <>
                        {hubUser && <p className="text-white/50 text-xs font-mono">{hubUser.username ? `${hubUser.username} · ` : ''}{short(hubUser.walletAddress)}</p>}
                        <p className="text-white/70 text-sm">Sign in once with your Glyph wallet. It is free and sends no transaction — it only proves the wallet is yours, so your droids, progress and season score follow you here and on apedroidz.com.</p>
                        <button onClick={() => void signIn()} disabled={phase.busy}
                            className="w-full py-3 rounded-xl bg-[#3b82f6] font-black uppercase tracking-widest text-sm disabled:opacity-50">
                            {phase.busy ? 'Waiting for signature…' : 'Sign in & play'}
                        </button>
                        {phase.error && <p className="text-orange-400 text-xs">{phase.error}</p>}
                    </>
                )}
                {phase.k === 'denied' && (
                    <>
                        <p className="text-white/70 text-sm">Droidz Survival is in closed beta, and this wallet is not on the list yet.</p>
                        <p className="text-white/40 text-xs font-mono break-all">{phase.wallet}</p>
                        <p className="text-white/50 text-xs">Ask for access on X — <span className="text-[#3b82f6]">@ApeDroidz</span>.</p>
                    </>
                )}
                {phase.k === 'error' && <p className="text-red-400 text-sm">{phase.message}</p>}
            </div>
        </main>
    )
}
