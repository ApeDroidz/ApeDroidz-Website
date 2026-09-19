'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useActiveAccount, useSendTransaction, ConnectButton } from 'thirdweb/react'
import { createWallet } from 'thirdweb/wallets'
import { prepareTransaction, toWei } from 'thirdweb'
import { client, apeChain } from '@/lib/thirdweb'
import { Loader2, Lock, ShieldCheck, Maximize2, Minimize2, Volume2, VolumeX, Play } from 'lucide-react'
import { Header } from '@/components/header'
import { DigitalBackground } from '@/components/digital-background'
import { ProfileModal } from '@/components/profile-modal'
import { useGlitchSession } from '@/hooks/useGlitchSession'
import { GlitchText } from '@/components/glitch/glitch-text'
import { DISCORD_URL, OPENSEA_COLLECTION_URL } from '@/lib/socials'

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

// Beta access = a droid + a ticket (owner, 18.09): the collection on OpenSea and the
// Discord, not a DM to the founder (whose handle was misspelt here anyway — @split0rm).
const GAME_SRC = '/droidz_survival/play/index.html'
// The same wallets the Header offers — the door has its own Connect button (owner, 19.09:
// «справа, где connect your wallet, добавить кнопку, чтобы не тянуться далеко»).
const WALLETS = [createWallet('io.metamask'), createWallet('com.coinbase.wallet'), createWallet('me.rainbow')]
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
    /** Access expiry from /api/survival/access: an ISO instant, null = no expiry, undefined = unknown. */
    const [until, setUntil] = useState<string | null | undefined>(undefined)
    const [now, setNow] = useState(() => Date.now())
    /** The game is up only after PLAY (owner, 19.09): with access the page still opens on the
     *  same screen as for everyone — announce, door card with «access open» and a Play button. */
    const [playing, setPlaying] = useState(false)
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
            if (data.state === 'allowed') { setUntil(typeof data.until === 'string' ? data.until : null); setGate('allowed'); return }
            if (data.state === 'denied') { setGate('denied'); return }
            setGate('verify')
        } catch {
            setGate('error')
            setMessage('Could not reach the access service')
        }
    }, [])

    // The «time left» line ticks once a minute while the game is up; when the access
    // runs out the gate re-checks itself and the door closes (the play cookie is
    // capped at the same instant server-side, so the build stops being served too).
    useEffect(() => {
        if (gate !== 'allowed') return
        const id = setInterval(() => setNow(Date.now()), 60_000)
        return () => clearInterval(id)
    }, [gate])
    useEffect(() => {
        if (gate !== 'allowed' || !until) return
        const ms = new Date(until).getTime() - Date.now()
        if (ms <= 0) { setGate('loading'); void checkAccess(); return }
        const id = setTimeout(() => { setGate('loading'); void checkAccess() }, Math.min(ms, 2 ** 31 - 1))
        return () => clearTimeout(id)
    }, [gate, until, checkAccess])

    // Re-run the whole gate whenever the connected or the verified wallet changes: switching
    // accounts in the wallet must not leave the previous account's game on screen.
    useEffect(() => {
        setPlaying(false)
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

            <main className="relative z-10 mx-auto flex min-h-[100svh] w-full flex-col justify-center px-4 pb-10 pt-24 sm:pt-28">
                {gate === 'allowed' && playing ? (
                    <div className="mx-auto w-full max-w-6xl">
                        <Heading sub={'Pixel roguelite · Survive the waves'} />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.985 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2">
                                <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-white/40" title={until ? `until ${new Date(until).toLocaleString()}` : 'no expiry'}>
                                    <ShieldCheck className="h-3.5 w-3.5 icon-dim-50" />
                                    Beta access open · {until === null ? 'forever' : until ? `${timeLeft(new Date(until).getTime() - now)} left` : ''}
                                    {authedWallet ? <span className="hidden sm:inline text-white/25">· {short(authedWallet)}</span> : null}
                                </span>
                                <button
                                    onClick={() => frameRef.current?.requestFullscreen?.()}
                                    className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-white/40 transition-colors hover:text-white"
                                >
                                    <Maximize2 className="h-3.5 w-3.5 icon-dim-50" />
                                    Fullscreen
                                </button>
                            </div>
                            {/* 16:9 — the Phaser canvas is 1280×720 and letterboxes itself inside.
                                The cover sits behind the frame so the box is the poster, not a
                                grey slab, for the second or two the build takes to arrive. */}
                            <div className="relative aspect-video w-full bg-[#0a0f1e] bg-cover bg-bottom" style={{ backgroundImage: 'url(/droidz_survival/DS_Beta_cover.jpg)' }}>
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
                    </div>
                ) : (
                    /* The beta screen, one viewport (owner, 19.09): the announce on the left,
                       the door on the right — heading, video and the wallet state all in view
                       without a scroll on a desktop; the two stack on a phone. */
                    <div className="mx-auto grid w-full max-w-7xl items-center gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-14">
                        <div className="min-w-0">
                            <Heading
                                align="left"
                                sub={`Pixel roguelite · Survive the waves${authedWallet ? ` · ${short(authedWallet)}` : ''}`}
                            />
                            <BetaAnnounce />
                        </div>
                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                            className="min-w-0 text-center lg:text-left"
                        >
                        {gate === 'loading' && (
                            <>
                                <Loader2 className="mx-auto h-7 w-7 animate-spin text-white icon-dim-50 lg:mx-0" />
                                <p className="mt-5 font-mono text-xs uppercase tracking-widest text-white/40">
                                    Checking access…
                                </p>
                            </>
                        )}

                        {gate === 'connect' && (
                            <>
                                <Lock className="mx-auto h-7 w-7 text-white icon-dim-50 lg:mx-0" />
                                <h2 className="mt-5 text-xl font-bold uppercase tracking-tight">
                                    Connect your wallet
                                </h2>
                                <p className="mt-3 text-sm leading-relaxed text-white/50">
                                    Droidz Survival is in closed beta. Connect your wallet to check
                                    whether you are on the early access list.
                                </p>
                                <div className="mt-7 flex justify-center lg:justify-start [&_button]:!w-full sm:[&_button]:!w-auto">
                                    <ConnectButton
                                        client={client}
                                        chain={apeChain}
                                        wallets={WALLETS}
                                        theme="dark"
                                        connectButton={{
                                            label: 'Connect Wallet',
                                            className: '!bg-white !text-black !font-bold !rounded-full !h-[46px] !px-8 !text-sm !border !border-transparent !transition-all !duration-300 hover:!bg-[#0069FF] hover:!text-white',
                                        }}
                                        connectModal={{ size: 'compact', title: 'ApeDroidz Access', showThirdwebBranding: false }}
                                    />
                                </div>
                            </>
                        )}

                        {gate === 'verify' && (
                            <>
                                <ShieldCheck className="mx-auto h-7 w-7 text-white icon-dim-50 lg:mx-0" />
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
                                <Lock className="mx-auto h-7 w-7 text-white icon-dim-50 lg:mx-0" />
                                <h2 className="mt-5 text-xl font-bold uppercase tracking-tight">
                                    Not on the beta list
                                </h2>
                                <p className="mt-3 text-sm leading-relaxed text-white/50">
                                    This wallet does not have early access to Droidz Survival yet.
                                    To get in: hold an ApeDroid, then open a ticket in the Discord —
                                    the beta is opening in waves.
                                </p>
                                {authedWallet && (
                                    <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-white/30">
                                        {short(authedWallet)}
                                    </p>
                                )}
                                <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:flex-col lg:items-start">
                                    <a
                                        href={OPENSEA_COLLECTION_URL}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex h-[46px] items-center justify-center rounded-full bg-white px-8 text-sm font-bold text-black transition-all duration-300 hover:bg-[#0069FF] hover:text-white"
                                    >
                                        Get an ApeDroid on OpenSea
                                    </a>
                                    <a
                                        href={DISCORD_URL}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex h-[46px] items-center justify-center rounded-full border border-white/20 px-8 text-sm font-bold text-white transition-all duration-300 hover:border-white/60"
                                    >
                                        Open a ticket in Discord
                                    </a>
                                </div>
                                <p className="mt-5 text-xs leading-relaxed text-white/30">
                                    Got access on a different wallet? Switch accounts and this page
                                    will re-check on its own.
                                </p>
                            </>
                        )}

                        {gate === 'allowed' && (
                            <>
                                <ShieldCheck className="mx-auto h-7 w-7 text-emerald-400 lg:mx-0" />
                                <h2 className="mt-5 text-xl font-bold uppercase tracking-tight">
                                    Beta access open
                                </h2>
                                <p className="mt-3 text-sm leading-relaxed text-white/50">
                                    {until === null
                                        ? 'This wallet has early access to Droidz Survival with no expiry.'
                                        : until
                                            ? `This wallet has early access to Droidz Survival for ${timeLeft(new Date(until).getTime() - now)} more.`
                                            : 'This wallet has early access to Droidz Survival.'}
                                </p>
                                <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-white/30" title={until ? `until ${new Date(until).toLocaleString()}` : 'no expiry'}>
                                    {until === null ? 'Access · forever' : until ? `Access until ${new Date(until).toLocaleString()}` : ''}
                                    {authedWallet ? ` · ${short(authedWallet)}` : ''}
                                </p>
                                <button
                                    onClick={() => setPlaying(true)}
                                    className="mt-7 inline-flex h-[46px] items-center justify-center gap-2 rounded-full bg-white px-10 text-sm font-bold text-black transition-all duration-300 hover:bg-[#0069FF] hover:text-white"
                                >
                                    <Play className="h-4 w-4" fill="currentColor" />
                                    Play
                                </button>
                            </>
                        )}

                        {gate === 'error' && (
                            <>
                                <Lock className="mx-auto h-7 w-7 text-white icon-dim-50 lg:mx-0" />
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
                    </div>
                )}
            </main>

            <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
        </div>
    )
}

/** «3 d 4 h», «5 h 12 m», «8 m» — what is left of a timed beta access, owner's wording: сколько осталось до конца. */
function timeLeft(ms: number): string {
    const m = Math.max(0, Math.floor(ms / 60_000))
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
    if (d >= 1) return `${d} d ${h} h`
    if (h >= 1) return `${h} h ${mm} m`
    return `${mm} m`
}

/** The page's own heading: the site's black uppercase with the glitch bands. */
function Heading({ sub, align = 'center' }: { sub: string; align?: 'center' | 'left' }) {
    const left = align === 'left'
    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className={`mb-5 ${left ? 'text-center lg:text-left' : 'text-center'}`}
        >
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/40">Closed Beta</p>
            <h1 className={`mt-3 max-w-4xl text-4xl font-black uppercase leading-none tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] sm:text-5xl xl:text-6xl ${left ? 'mx-auto lg:mx-0' : 'mx-auto'}`}>
                <GlitchText text="Droidz Survival" />
            </h1>
            <p className="mt-3 font-mono text-xs uppercase tracking-widest text-white/40">{sub}</p>
        </motion.div>
    )
}

/**
 * The beta announce (owner, 19.09) — on R2 next to the game's media, H.264 so every
 * browser plays it (the source is HEVC, which Chrome on Windows and Android will not).
 * Starts muted on its own, loops; one button turns the sound on. No native chrome —
 * the frame is the same glass as the rest of the page.
 */
const ANNOUNCE_SRC = 'https://assets.apedroidz.com/apedroidz/droidz-survival/media/beta-announce.mp4'
const ANNOUNCE_POSTER = 'https://assets.apedroidz.com/apedroidz/droidz-survival/media/beta-announce-poster.jpg'

function BetaAnnounce() {
    const ref = useRef<HTMLVideoElement>(null)
    const box = useRef<HTMLDivElement>(null)
    const [muted, setMuted] = useState(true)
    const [full, setFull] = useState(false)

    const toggle = () => {
        const v = ref.current
        if (!v) return
        v.muted = !v.muted
        setMuted(v.muted)
        if (!v.muted) { v.currentTime = 0; void v.play() }
    }

    // Fullscreen on the card, not on the <video>: the badge and both buttons come
    // along, and Safari keeps its own player chrome out of the way.
    const toggleFull = () => {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void box.current?.requestFullscreen?.()
    }

    // Esc and the browser's own exit change the state without going through the
    // button, so the flag follows the document rather than the click.
    useEffect(() => {
        const onChange = () => setFull(document.fullscreenElement === box.current)
        document.addEventListener('fullscreenchange', onChange)
        return () => document.removeEventListener('fullscreenchange', onChange)
    }, [])

    return (
        <motion.div
            ref={box}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
            className={`group relative overflow-hidden bg-black ${full ? 'flex h-full w-full items-center justify-center' : 'rounded-2xl border border-white/10'}`}
        >
            {/* Filling the screen the box is no longer 16:9, so the frame stops
                cropping and the whole picture fits inside it. */}
            <div className={full ? 'relative h-full w-full' : 'relative aspect-video w-full'}>
                <video
                    ref={ref}
                    src={ANNOUNCE_SRC}
                    poster={ANNOUNCE_POSTER}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    onClick={toggle}
                    className={`absolute inset-0 h-full w-full cursor-pointer ${full ? 'object-contain' : 'object-cover'}`}
                />
            </div>
            <span className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/15 bg-black/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white/70 backdrop-blur">
                Beta announce
            </span>
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
                <button
                    onClick={toggle}
                    aria-label={muted ? 'Turn the sound on' : 'Mute'}
                    className="flex h-9 items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3 font-mono text-[10px] uppercase tracking-widest text-white/80 backdrop-blur transition-colors hover:bg-white hover:text-black"
                >
                    {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    {muted ? 'Sound on' : 'Mute'}
                </button>
                <button
                    onClick={toggleFull}
                    aria-label={full ? 'Leave fullscreen' : 'Fullscreen'}
                    className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-black/50 text-white/80 backdrop-blur transition-colors hover:bg-white hover:text-black"
                >
                    {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                </button>
            </div>
        </motion.div>
    )
}
