'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { notFound } from 'next/navigation'
import { prepareTransaction, sendTransaction, toWei } from 'thirdweb'
import { privateKeyToAccount, type Account } from 'thirdweb/wallets'
import { apeChain, client } from '@/lib/thirdweb'

/**
 * A stand-in for the Otherside Hub overlay, so the cabinet (/otherside) can be played end to end
 * in an ordinary browser — no Windows, no ODK. It speaks the Partner Wallet Bridge protocol
 * exactly as the guide writes it: posts `glyph:ready` with a session nonce to the framed page's
 * origin only, drops requests from any other origin or with a wrong nonce, rejects a
 * sendTransaction without `description`, and shows a confirmation for every request.
 *
 * The wallet is a throwaway key kept in this browser's localStorage: signatures are real, so the
 * server verifies them for real. To pass the beta gate, add the address shown here to the list
 * in the panel (or run with SURVIVAL_OTHERSIDE_OPEN=1). Transactions are real ApeChain
 * transactions from that key — fund it with a little APE to test payments.
 *
 * Off unless NEXT_PUBLIC_OTHERSIDE_DEV_HUB=1 or a dev build — it must never exist on production.
 */
const ENABLED = process.env.NEXT_PUBLIC_OTHERSIDE_DEV_HUB === '1' || process.env.NODE_ENV !== 'production'
const KEY = 'droidz.devhub.key'
const FEE_BPS = 150 // the Hub's default fee
/** The live Otherside Hub FeeSplitter on ApeChain (verified source: FeeSplitter.execute). */
const FEE_SPLITTER = '0x8E756CA736Da338d78C436C47A41aC18CE72Cf63'

/** `FeeSplitter.execute(target, data, feeBps)` — how the Hub sends every paid partner call. */
function viaFeeSplitter(target: string, data: string, bps: number): string {
    const w = (h: string) => h.replace(/^0x/, '').padStart(64, '0')
    const body = (data || '0x').replace(/^0x/, '')
    const padded = body.padEnd(Math.ceil(body.length / 64) * 64, '0')
    return '0xa04a0908' + w(target) + w((96).toString(16)) + w(bps.toString(16)) + w((body.length / 2).toString(16)) + padded
}

type Req = { id: string; type: 'glyph:signMessage' | 'glyph:sendTransaction'; payload: Record<string, any> }

function randomKey(): `0x${string}` {
    const b = crypto.getRandomValues(new Uint8Array(32))
    return `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`
}

export default function DevHubPage() {
    if (!ENABLED) notFound()
    return <DevHub />
}

function DevHub() {
    const frame = useRef<HTMLIFrameElement>(null)
    const [account, setAccount] = useState<Account | null>(null)
    const [nonce] = useState(() => crypto.randomUUID())
    const [queue, setQueue] = useState<Req[]>([])
    const [log, setLog] = useState<string[]>([])
    const note = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${s}`, ...l].slice(0, 40))

    useEffect(() => {
        let k = ''
        try { k = localStorage.getItem(KEY) ?? '' } catch { /* private mode */ }
        if (!/^0x[0-9a-f]{64}$/.test(k)) { k = randomKey(); try { localStorage.setItem(KEY, k) } catch { /* */ } }
        setAccount(privateKeyToAccount({ client, privateKey: k as `0x${string}` }))
    }, [])

    // `?cabinet=http://localhost:3737/otherside` frames the cabinet from ANOTHER site than this
    // hub (open the hub on 127.0.0.1) — a true third-party frame, as inside the real Hub, so the
    // partitioned cookies are tested for real. Default: same origin.
    const [cabinet, setCabinet] = useState<string | null>(null)
    useEffect(() => {
        const c = new URLSearchParams(window.location.search).get('cabinet')
        setCabinet(c && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(c) ? c : '/otherside')
    }, [])
    const origin = cabinet ? new URL(cabinet, window.location.href).origin : ''
    const reply = useCallback((msg: object) => frame.current?.contentWindow?.postMessage(msg, origin), [origin])

    const sendReady = useCallback(() => {
        if (!account) return
        reply({ type: 'glyph:ready', payload: { walletAddress: account.address, chainId: 33139, sessionNonce: nonce, username: 'dev-hub' } })
        note(`→ glyph:ready ${account.address}`)
    }, [account, nonce, reply])

    // Like the Hub: one glyph:ready once the wallet exists AND the cabinet has loaded, whichever
    // comes last.
    const [loaded, setLoaded] = useState(false)
    useEffect(() => { if (loaded && account) sendReady() }, [loaded, account, sendReady])

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (e.origin !== origin || e.source !== frame.current?.contentWindow) return
            const { type, id, nonce: n, payload } = e.data ?? {}
            if (type !== 'glyph:signMessage' && type !== 'glyph:sendTransaction') return
            if (n !== nonce) { note(`✕ dropped ${type}: nonce mismatch`); return }
            if (type === 'glyph:sendTransaction' && !payload?.description) {
                reply({ type: 'glyph:error', id, payload: { code: 'INVALID_REQUEST', message: 'description is required' } })
                note('✕ sendTransaction without description → INVALID_REQUEST'); return
            }
            note(`← ${type}`)
            setQueue((q) => [...q, { id, type, payload }])
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
    }, [origin, nonce, reply])

    const decide = async (req: Req, approve: boolean) => {
        setQueue((q) => q.filter((r) => r.id !== req.id))
        if (!approve || !account) {
            reply({ type: 'glyph:error', id: req.id, payload: { code: 'USER_REJECTED', message: 'Transaction rejected' } })
            note('→ glyph:error USER_REJECTED'); return
        }
        try {
            if (req.type === 'glyph:signMessage') {
                const signature = await account.signMessage({ message: String(req.payload.message) })
                reply({ type: 'glyph:result', id: req.id, payload: { signature } }); note('→ glyph:result signature')
            } else {
                // Like the Hub: a call with value goes through the FeeSplitter, 1.5% off the top.
                const paid = Number(req.payload.value ?? 0) > 0
                const tx = prepareTransaction({
                    chain: apeChain, client, value: toWei(String(req.payload.value ?? '0')),
                    to: paid ? FEE_SPLITTER : req.payload.to,
                    data: (paid ? viaFeeSplitter(req.payload.to, req.payload.data ?? '0x', FEE_BPS) : req.payload.data) as `0x${string}` | undefined,
                })
                const { transactionHash } = await sendTransaction({ account, transaction: tx })
                reply({ type: 'glyph:result', id: req.id, payload: { hash: transactionHash } }); note(`→ glyph:result ${transactionHash}`)
            }
        } catch (err) {
            reply({ type: 'glyph:error', id: req.id, payload: { code: 'EXECUTION_ERROR', message: (err as Error).message } })
            note(`→ glyph:error EXECUTION_ERROR ${(err as Error).message}`)
        }
    }

    return (
        <div className="fixed inset-0 flex bg-black text-white">
            {cabinet ? <iframe ref={frame} src={cabinet} onLoad={() => setLoaded(true)} title="cabinet"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups" className="flex-1 h-full border-0" /> : <div className="flex-1" />}
            <aside className="w-80 border-l border-white/10 p-3 text-xs space-y-3 overflow-auto">
                <div className="font-black uppercase tracking-widest text-[10px] text-orange-400">Dev Hub — not Otherside</div>
                <div className="font-mono break-all text-white/70">{account?.address ?? '…'}</div>
                <button onClick={sendReady} className="px-2 py-1 rounded bg-white/10">Resend glyph:ready</button>
                {queue.map((r) => (
                    <div key={r.id} className="rounded-lg border border-[#3b82f6]/50 bg-[#3b82f6]/10 p-2 space-y-2">
                        <div className="font-black">{r.type === 'glyph:signMessage' ? 'Signature request' : 'Transaction request'}</div>
                        <div className="text-white/50">from {origin}</div>
                        {r.type === 'glyph:signMessage'
                            ? <pre className="whitespace-pre-wrap text-white/80">{r.payload.message}</pre>
                            : <div className="space-y-1">
                                <div className="text-white/90">{r.payload.description}</div>
                                <div className="font-mono text-white/50 break-all">to {r.payload.to}</div>
                                <div>You send {r.payload.value ?? '0'} APE{Number(r.payload.value) > 0 ? ` · Hub fee ${(Number(r.payload.value) * FEE_BPS / 10000).toFixed(4)} APE` : ''}</div>
                                {r.payload.data && <div className="font-mono text-white/40 break-all">data {String(r.payload.data).slice(0, 74)}…</div>}
                                <div className="text-white/40">{r.payload.sponsored ? 'Sponsored (Free)' : 'You pay gas'}{Number(r.payload.value) > 0 ? ' · routed through the Hub FeeSplitter, like the real Hub' : ''}</div>
                            </div>}
                        <div className="flex gap-2">
                            <button onClick={() => void decide(r, true)} className="flex-1 py-1 rounded bg-emerald-500/80 font-black">Approve</button>
                            <button onClick={() => void decide(r, false)} className="flex-1 py-1 rounded bg-white/10">Reject</button>
                        </div>
                    </div>
                ))}
                <div className="space-y-0.5 font-mono text-[10px] text-white/40">{log.map((l, i) => <div key={i}>{l}</div>)}</div>
            </aside>
        </div>
    )
}
