'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useActiveAccount, useSendTransaction } from 'thirdweb/react'
import { prepareTransaction, toWei } from 'thirdweb'
import { client, apeChain } from '@/lib/thirdweb'
import { Loader2, Lock, ShieldCheck, Maximize2 } from 'lucide-react'
import { Header } from '@/components/header'
import { DigitalBackground } from '@/components/digital-background'
import { ProfileModal } from '@/components/profile-modal'
import { useGlitchSession } from '@/hooks/useGlitchSession'
import { GlitchText } from '@/components/glitch/glitch-text'

/**
 * Droidz Survival — closed beta.
 *
 * Four states, and the page is only ever in one of them:
 *
 *   connect   no wallet                     → the Header's Connect Wallet button is the action
 *   verify    wallet, but no signature yet  → one signMessage; a connected wallet is a claim,
 *                                             a signed session is proof, and the allowlist is
 *                                             worth nothing if it can be satisfied by typing
 *                                             someone else's address
 *   denied    verified, not on the list     → say so plainly and say who to ask
 *   allowed   verified and on the list      → the game
 *
 * The gate is enforced server-side too: /api/survival/access reads the signed session, checks
 * survival_allowlist, and mints the cookie without which the middleware will not serve a single
 * file of the build under /droidz_survival/play. This page cannot let anyone in on its own.
 */

const CONTACT = 'https://x.com/splitform'
const GAME_SRC = '/droidz_survival/play/index.html'
/** Where a paid continue / run sends its APE. Server-verified against the same address (api/survival/pay). */
const TREASURY = process.env.NEXT_PUBLIC_SURVIVAL_TREASURY_WALLET ?? '0x1DcF1d22A1dbDd20AE875beDEEe3A259b1D608db'
/** Flip to true (or set NEXT_PUBLIC_SURVIVAL_PAY_FOR_REAL=1) when the contracts are in. */
const PAY_FOR_REAL = process.env.NEXT_PUBLIC_SURVIVAL_PAY_FOR_REAL === '1'


type Gate = 'loading' | 'connect' | 'verify' | 'denied' | 'allowed' | 'error'

export default function DroidzSurvivalPage() {
    const account = useActiveAccount()
    const { authedWallet, ensureLogin, error: sessionError } = useGlitchSession()

    const [gate, setGate] = useState<Gate>('loading')
    const [signing, setSigning] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const [isProfileOpen, setIsProfileOpen] = useState(false)

    const frameRef = useRef<HTMLIFrameElement>(null)
    const { mutateAsync: sendTx } = useSendTransaction()

    // The paid door. The game (an iframe on our own origin) looks for `window.DroidzPay`
    // and offers CONTINUE for 1 APE only when it is there. We install it on the frame's
    // window. FOR THE BETA IT IS A STUB (the owner, 18.09: «пока вместо реальных оплат
    // ставим заглушку — реальные смарт-контракты подставим позже»): it says yes after a
    // beat and charges nothing; the game shows the continue as free. The real door is
    // written and waiting — the thirdweb transfer to the treasury plus the on-chain
    // check in /api/survival/pay — behind PAY_FOR_REAL.
    const installPay = useCallback(() => {
        const win = frameRef.current?.contentWindow as (Window & { DroidzPay?: unknown }) | null
        if (!win) return
        win.DroidzPay = {
            stub: !PAY_FOR_REAL,
            charge: async (kind: 'continue' | 'run', amountApe: number): Promise<boolean> => {
                if (!PAY_FOR_REAL) {
                    await new Promise((r) => setTimeout(r, 500))
                    return true
                }
                try {
                    const tx = prepareTransaction({ chain: apeChain, client, to: TREASURY, value: toWei(String(amountApe)) })
                    const result = await sendTx(tx)
                    await new Promise((r) => setTimeout(r, 3000))
                    for (let attempt = 0; attempt < 4; attempt++) {
                        const res = await fetch('/api/survival/pay', {
                            method: 'POST', credentials: 'include',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ txHash: result.transactionHash, kind }),
                        })
                        const data = await res.json().catch(() => ({}))
                        if (data?.ok === true) return true
                        if (data?.state !== 'not_found') return false
                        await new Promise((r) => setTimeout(r, 2500)) // the node has not seen it yet
                    }
                    return false
                } catch {
                    return false
                }
            },
        }
    }, [sendTx])

    const checkAccess = useCallback(async () => {
        try {
            const res = await fetch('/api/survival/access', { credentials: 'include', cache: 'no-store' })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setGate('error')
                setMessage(data?.error ?? 'Access check failed')
                return
            }
            if (data.state === 'allowed') { setGate('allowed'); return }
            if (data.state === 'denied') { setGate('denied'); return }
            setGate('verify')
        } catch {
            setGate('error')
            setMessage('Could not reach the access service')
        }
    }, [])

    // Re-run the whole gate whenever the connected or the verified wallet changes: switching
    // accounts in the wallet must not leave the previous account's game on screen.
    useEffect(() => {
        if (!account?.address) { setGate('connect'); return }
        setGate('loading')
        checkAccess()
    }, [account?.address, authedWallet, checkAccess])

    const verify = useCallback(async () => {
        setSigning(true)
        setMessage(null)
        const ok = await ensureLogin()
        setSigning(false)
        if (!ok) { setMessage(sessionError ?? 'Signature required to continue'); return }
        setGate('loading')
        await checkAccess()
    }, [ensureLogin, sessionError, checkAccess])

    const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`

    return (
        <div className="relative min-h-screen bg-black text-white overflow-x-hidden">
            {/* Fixed behind everything, like the staking page: bare, the background is a
                block that fills a whole screen and pushes the gate a viewport down. */}
            <div className="fixed inset-0 z-0 opacity-40 pointer-events-none mix-blend-lighten"><DigitalBackground /></div>
            <Header onOpenProfile={() => setIsProfileOpen(true)} />

            <main className="relative z-10 mx-auto max-w-6xl px-4 pt-24 pb-16 sm:pt-28">
                {/* The heading is the site's own — the same black uppercase with the glitch bands
                    the dashboard and the staking page wear — and the gate card sits right under
                    it, so the wallet state is the first thing on screen, not a scroll away. */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="mb-6 text-center"
                >
                    <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/40">
                        Closed Beta
                    </p>
                    <h1 className="mx-auto mt-3 max-w-4xl text-4xl font-black uppercase leading-none tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] sm:text-6xl">
                        <GlitchText text="Droidz Survival" />
                    </h1>
                    <p className="mt-3 font-mono text-xs uppercase tracking-widest text-white/40">
                        Pixel roguelite · Survive the waves
                        {authedWallet && gate !== 'allowed' ? ` · ${short(authedWallet)}` : ''}
                    </p>
                </motion.div>

                {gate === 'allowed' ? (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.985 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_0_60px_rgba(0,105,255,0.12)]">
                            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2">
                                <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-white/40">
                                    <ShieldCheck className="h-3.5 w-3.5 icon-dim-50" />
                                    Beta access · {authedWallet ? short(authedWallet) : ''}
                                </span>
                                <button
                                    onClick={() => frameRef.current?.requestFullscreen?.()}
                                    className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-white/40 transition-colors hover:text-white"
                                >
                                    <Maximize2 className="h-3.5 w-3.5 icon-dim-50" />
                                    Fullscreen
                                </button>
                            </div>
                            {/* 16:9 — the Phaser canvas is 1280×720 and letterboxes itself inside. */}
                            <div className="relative aspect-video w-full bg-[#112030]">
                                <iframe
                                    ref={frameRef}
                                    onLoad={installPay}
                                    src={GAME_SRC}
                                    title="Droidz Survival"
                                    className="absolute inset-0 h-full w-full border-0"
                                    allow="fullscreen; autoplay; gamepad"
                                />
                            </div>
                        </div>
                        <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-widest text-white/30">
                            Arrows / WASD move · C attack · Space jump · Enter confirm · Esc back
                        </p>
                    </motion.div>
                ) : (
                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                        className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-sm sm:p-10"
                    >
                        {gate === 'loading' && (
                            <>
                                <Loader2 className="mx-auto h-7 w-7 animate-spin text-white icon-dim-50" />
                                <p className="mt-5 font-mono text-xs uppercase tracking-widest text-white/40">
                                    Checking access…
                                </p>
                            </>
                        )}

                        {gate === 'connect' && (
                            <>
                                <Lock className="mx-auto h-7 w-7 text-white icon-dim-50" />
                                <h2 className="mt-5 text-xl font-bold uppercase tracking-tight">
                                    Connect your wallet
                                </h2>
                                <p className="mt-3 text-sm leading-relaxed text-white/50">
                                    Droidz Survival is in closed beta. Connect your wallet to check
                                    whether you are on the early access list.
                                </p>
                                <p className="mt-6 font-mono text-[11px] uppercase tracking-widest text-white/30">
                                    Use the Connect Wallet button above
                                </p>
                            </>
                        )}

                        {gate === 'verify' && (
                            <>
                                <ShieldCheck className="mx-auto h-7 w-7 text-white icon-dim-50" />
                                <h2 className="mt-5 text-xl font-bold uppercase tracking-tight">
                                    Verify your wallet
                                </h2>
                                <p className="mt-3 text-sm leading-relaxed text-white/50">
                                    Sign a message to prove the wallet is yours. It is free, there is
                                    no transaction, and nothing leaves your wallet.
                                </p>
                                <button
                                    onClick={verify}
                                    disabled={signing}
                                    className="mt-7 inline-flex h-[46px] items-center justify-center gap-2 rounded-full bg-white px-8 text-sm font-bold text-black transition-all duration-300 hover:bg-[#0069FF] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {signing && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {signing ? 'Waiting for signature…' : 'Sign to continue'}
                                </button>
                            </>
                        )}

                        {gate === 'denied' && (
                            <>
                                <Lock className="mx-auto h-7 w-7 text-white icon-dim-50" />
                                <h2 className="mt-5 text-xl font-bold uppercase tracking-tight">
                                    Not on the beta list
                                </h2>
                                <p className="mt-3 text-sm leading-relaxed text-white/50">
                                    Sorry — this wallet does not have early access to Droidz Survival
                                    yet. The beta is opening in waves.
                                </p>
                                {authedWallet && (
                                    <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-white/30">
                                        {short(authedWallet)}
                                    </p>
                                )}
                                <a
                                    href={CONTACT}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-7 inline-flex h-[46px] items-center justify-center rounded-full bg-white px-8 text-sm font-bold text-black transition-all duration-300 hover:bg-[#0069FF] hover:text-white"
                                >
                                    Ask @splitform for access
                                </a>
                                <p className="mt-5 text-xs leading-relaxed text-white/30">
                                    Got access on a different wallet? Switch accounts and this page
                                    will re-check on its own.
                                </p>
                            </>
                        )}

                        {gate === 'error' && (
                            <>
                                <Lock className="mx-auto h-7 w-7 text-white icon-dim-50" />
                                <h2 className="mt-5 text-xl font-bold uppercase tracking-tight">
                                    Access check failed
                                </h2>
                                <p className="mt-3 text-sm leading-relaxed text-white/50">
                                    {message ?? 'Something went wrong on our side.'}
                                </p>
                                <button
                                    onClick={() => { setGate('loading'); checkAccess() }}
                                    className="mt-7 inline-flex h-[46px] items-center justify-center rounded-full bg-white px-8 text-sm font-bold text-black transition-all duration-300 hover:bg-[#0069FF] hover:text-white"
                                >
                                    Try again
                                </button>
                            </>
                        )}

                        {message && gate !== 'error' && (
                            <p className="mt-5 font-mono text-[11px] uppercase tracking-widest text-red-400/70">
                                {message}
                            </p>
                        )}
                    </motion.div>
                )}
            </main>

            <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
        </div>
    )
}
