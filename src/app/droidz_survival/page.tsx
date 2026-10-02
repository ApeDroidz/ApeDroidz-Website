'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useActiveAccount, useActiveWallet, useDisconnect, useSendTransaction, AutoConnect, ConnectButton } from 'thirdweb/react'
import { createWallet, injectedProvider } from 'thirdweb/wallets'
import { prepareTransaction, toWei } from 'thirdweb'
import { client, apeChain } from '@/lib/thirdweb'
import { Loader2, Lock, ShieldCheck, Maximize2, Minimize2, Volume2, VolumeX, Play, X, ExternalLink, Share, SquarePlus, Download, LogOut } from 'lucide-react'
import { Header } from '@/components/header'
import { DigitalBackground } from '@/components/digital-background'
import { ProfileModal } from '@/components/profile-modal'
import { useGlitchSession } from '@/hooks/useGlitchSession'
import { GlitchText } from '@/components/glitch/glitch-text'
import { DISCORD_URL } from '@/lib/socials'
import { cancelOrder, createOrder, isUserRejection, leaveFullscreen, reportPayment, singleFlight } from '@/lib/survivalHostPay'

/**
 * Droidz Survival — open beta (SURVIVAL_PUBLIC=0 closes it back to the beta list; `denied` is then
 * «not on the list», in the open beta only a banned or revoked wallet).
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
/**
 * The wallet apps a phone reaches over WalletConnect (MetaMask, Rainbow): their name for the hints
 * and the bare app link. The link is the «it didn't show up» button — the request waits in the
 * relay, so simply opening the app again usually brings it up (a tap on a link is a gesture, so
 * Safari lets it through). Coinbase Wallet goes through its own SDK (a keys.coinbase.com window),
 * not a deep link, so it gets no button here — only the «open in the wallet's browser» way out.
 */
const WALLET_APPS: Record<string, { name: string; open: string }> = {
    'io.metamask': { name: 'MetaMask', open: 'metamask://' },
    'me.rainbow': { name: 'Rainbow', open: 'rainbow://' },
}

/** Phone or tablet (iPadOS reports itself as a Mac with a touch screen). Client-only. */
function isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent
    return /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/**
 * Inside a wallet's own browser (MetaMask, Coinbase Wallet, Rainbow…) the wallet is injected and
 * signs in place — no deep link, no WalletConnect. Client-only.
 */
function inWalletBrowser(): boolean {
    if (typeof window === 'undefined') return false
    return !!(window as Window & { ethereum?: unknown }).ethereum
}

/**
 * The way out when the phone's browser and the wallet app will not talk: open this very page in
 * the wallet's built-in browser, where signing needs no hand-off at all.
 * MetaMask: https://metamask.app.link/dapp/<host><path> (no scheme — MetaMask adds https).
 * Coinbase Wallet: https://go.cb-w.com/dapp?cb_url=<the full URL, encoded>.
 */
function walletBrowserLinks(loc: { host: string; pathname: string; search: string; href: string }) {
    return {
        metamask: `https://metamask.app.link/dapp/${loc.host}${loc.pathname}${loc.search}`,
        coinbase: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(loc.href)}`,
    }
}

/**
 * Opened as the home-screen app (iOS «Add to Home Screen», an installed Android web app) — or with
 * ?app=1, the manifest's start_url, which is also how the app shell is tried in a plain browser.
 * Client-only. The game asks the same question of this window (game/src/systems/Mobile.ts
 * isStandaloneApp) and then starts without its TAP TO PLAY gate.
 */
function isAppMode(): boolean {
    if (typeof window === 'undefined') return false
    try {
        if (new URLSearchParams(window.location.search).get('app') === '1') return true
        if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true
        return window.matchMedia?.('(display-mode: standalone)').matches === true
            || window.matchMedia?.('(display-mode: fullscreen)').matches === true
    } catch {
        return false
    }
}

/** iPhone / iPad (iPadOS says it is a Mac with a touch screen). Client-only. */
function isIOSDevice(): boolean {
    if (typeof navigator === 'undefined') return false
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

/** Flip to true (or set NEXT_PUBLIC_SURVIVAL_PAY_FOR_REAL=1) when the contracts are in. */
const PAY_FOR_REAL = process.env.NEXT_PUBLIC_SURVIVAL_PAY_FOR_REAL === '1'


type Gate = 'loading' | 'connect' | 'verify' | 'denied' | 'allowed' | 'error'

export default function DroidzSurvivalPage() {
    const account = useActiveAccount()
    const wallet = useActiveWallet()
    const { authedWallet, ensureLogin, cancelLogin, lastError } = useGlitchSession()

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
    /** Phone facts, read after mount (the server render knows neither). */
    const [phone, setPhone] = useState<{ mobile: boolean; ios: boolean; inWallet: boolean; links: ReturnType<typeof walletBrowserLinks> } | null>(null)
    /**
     * The home-screen app (layout.tsx): only the door and then the game, on the whole screen, no
     * header, announce or background. Known after mount; until then the CSS in layout.tsx keeps the
     * site's chrome (.ds-site-only) hidden in a real home-screen app, so it never flashes.
     */
    const [appMode, setAppMode] = useState(false)
    useEffect(() => {
        // The wallet's own browser gets the page as it was opened (?app=1 dropped: it is a page there, not the app).
        const url = new URL(window.location.href)
        url.searchParams.delete('app')
        setPhone({ mobile: isMobileDevice(), ios: isIOSDevice(), inWallet: inWalletBrowser(), links: walletBrowserLinks(url) })
        setAppMode(isAppMode())
    }, [])
    /** The app's own QUIT (the game's pause menu): back to the app's door, not straight into a new game. */
    const appQuitRef = useRef(false)
    const { disconnect } = useDisconnect()
    /**
     * The connected wallet signs through its phone app (WalletConnect deep link) rather than in
     * place: a phone, a wallet with an app link, and nothing injected for it on this page.
     */
    const walletApp = wallet && phone?.mobile && !injectedProvider(wallet.id) ? WALLET_APPS[wallet.id] ?? null : null

    const frameRef = useRef<HTMLIFrameElement>(null)
    // The Buy / Deposit window thirdweb shows when the wallet is short of APE stays on (it is how a
    // newcomer tops up) — with our name on it; the page leaves fullscreen first so it can be seen.
    const { mutateAsync: sendTx } = useSendTransaction({ payModal: { metadata: { name: 'Droidz Survival' } } })
    /** A line over the game about a payment the game itself cannot explain (a late one). */
    const [payNote, setPayNote] = useState<string | null>(null)
    /**
     * The frame on the whole screen without the Fullscreen API — iPhone Safari (and wallet in-app
     * browsers) have none for an iframe, so the button did nothing and the game stayed a 16:9
     * stamp. Also asked for by the game itself (postMessage 'ds:fullscreen', systems/Mobile.ts).
     */
    const [pseudoFs, setPseudoFs] = useState(false)
    /** The connected address, for checks that run after an await (no stale closure). */
    const addrRef = useRef<string | null>(null)
    addrRef.current = account?.address?.toLowerCase() ?? null

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
            // One payment at a time: Enter pressed twice, or a screen rebuilt mid-payment, opens no
            // second order and no second wallet request (lib/survivalHostPay.ts singleFlight).
            charge: singleFlight(async (kind: string): Promise<boolean> => {
                if (!PAY_FOR_REAL) {
                    await new Promise((r) => setTimeout(r, 500))
                    return true
                }
                // An order first (the server's price, the cashier's calldata), then the player's
                // wallet pays it, then the server books it from the Paid event — the same path as
                // the Otherside cabinet (api/survival/order, /pay).
                const o = await createOrder(kind, 'site')
                if (!o) return false
                let hash: string
                try {
                    // A fullscreen frame hides the wallet's and thirdweb's windows on this page.
                    await leaveFullscreen(frameRef.current)
                    const tx = prepareTransaction({ chain: apeChain, client, to: o.to as `0x${string}`, value: toWei(o.valueApe), data: o.data as `0x${string}` })
                    hash = (await sendTx(tx)).transactionHash
                } catch (e) {
                    if (isUserRejection(e)) cancelOrder(o.orderId)
                    return false
                }
                // Sent: yes, unless the server says a definite no (a slow server is not a no).
                const state = await reportPayment(hash, o.orderId)
                if (state === 'late') setPayNote('Your payment arrived more than an hour after the order was made. Support will settle it — open a ticket in Discord.')
                return state === 'paid' || state === 'sent'
            }),
        }
    }, [sendTx])

    /** Real fullscreen where the browser has it for the frame; the whole-window frame otherwise. */
    const goFullscreen = useCallback(() => {
        const f = frameRef.current
        if (f && document.fullscreenEnabled && typeof f.requestFullscreen === 'function') {
            f.requestFullscreen().catch(() => setPseudoFs(true))
        } else {
            setPseudoFs(true)
        }
    }, [])

    // The game asks for the screen itself (PLAY on a phone, its «tap to play fullscreen» panel) when
    // it cannot go fullscreen on its own — only from our own frame.
    useEffect(() => {
        const onMsg = (e: MessageEvent) => {
            if (e.source !== frameRef.current?.contentWindow || e.origin !== window.location.origin) return
            const t = (e.data as { type?: unknown } | null)?.type
            // In the home-screen app the frame already IS the whole screen: nothing to lay over or leave.
            if (t === 'ds:fullscreen') { if (!appMode) setPseudoFs(true) }
            // The game's own pause menu (scenes/PauseScene.ts): EXIT FULLSCREEN and QUIT TO SITE.
            else if (t === 'ds:exitfullscreen') { if (!appMode) setPseudoFs(false) }
            else if (t === 'ds:quit') { if (appMode) appQuitRef.current = true; setPseudoFs(false); setPlaying(false) }
        }
        window.addEventListener('message', onMsg)
        return () => window.removeEventListener('message', onMsg)
    }, [appMode])

    // The app goes straight into the game once the door is open (there is no announce to read
    // first) — unless the player has just quit to the app's door from the game's pause menu.
    useEffect(() => {
        if (appMode && gate === 'allowed' && !appQuitRef.current) setPlaying(true)
    }, [appMode, gate])

    // The app's screen is the window: no rubber-band scroll of the page behind the game or the door.
    useEffect(() => {
        if (!appMode) return
        const html = document.documentElement, body = document.body
        const prev = [html.style.overscrollBehavior, body.style.overscrollBehavior, body.style.overflow]
        html.style.overscrollBehavior = 'none'
        body.style.overscrollBehavior = 'none'
        body.style.overflow = 'hidden'
        return () => { [html.style.overscrollBehavior, body.style.overscrollBehavior, body.style.overflow] = prev }
    }, [appMode])

    // While the frame covers the window the page under it must not scroll; Esc gives the page back.
    useEffect(() => {
        if (!pseudoFs) return
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPseudoFs(false) }
        window.addEventListener('keydown', onKey)
        return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
    }, [pseudoFs])
    useEffect(() => { if (!playing) setPseudoFs(false) }, [playing])

    const checkAccess = useCallback(async () => {
        try {
            const res = await fetch('/api/survival/access', { credentials: 'include', cache: 'no-store' })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setGate('error')
                setMessage(data?.error ?? 'Access check failed')
                return
            }
            // The answer is about the SIGNED wallet. With a session of another wallet still in the
            // browser (the connected one was switched), it is not an answer for this one: sign in
            // again — or the game loads, and every call it makes fails silently for this wallet.
            const same = String(data.wallet ?? '').toLowerCase() === addrRef.current
            if (data.state === 'allowed' && same) { setUntil(typeof data.until === 'string' ? data.until : null); setGate('allowed'); return }
            if (data.state === 'denied' && same) { setGate('denied'); return }
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

    // The play cookie lives six hours (lib/survivalAccess.ts PLAY_TTL) and was minted only on the
    // page's first check, so a long session outlived it: every run call answered 401 and the run
    // played on unrecorded (29.09). While the door is open it is renewed quietly — every 30 minutes
    // and whenever the tab comes back. A wallet banned or taken off the list meanwhile gets
    // `denied` and the door closes, as on a reload; a failed request just waits for the next one.
    useEffect(() => {
        if (gate !== 'allowed') return
        let alive = true
        const renew = async () => {
            try {
                const res = await fetch('/api/survival/access', { credentials: 'include', cache: 'no-store' })
                const data = await res.json().catch(() => ({}))
                if (!alive || !res.ok) return
                const same = String(data.wallet ?? '').toLowerCase() === addrRef.current
                if (data.state === 'denied' && same) setGate('denied')
                else if (data.state === 'allowed' && same) setUntil(typeof data.until === 'string' ? data.until : null)
                // The session is gone or is another wallet's: the game would play on unrecorded.
                else { setPlaying(false); setGate('verify') }
            } catch { /* offline for a moment — the next tick asks again */ }
        }
        const id = setInterval(renew, 30 * 60_000)
        const onVisible = () => { if (document.visibilityState === 'visible') void renew() }
        document.addEventListener('visibilitychange', onVisible)
        return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
    }, [gate])

    // Re-run the whole gate whenever the connected or the verified wallet changes: switching
    // accounts in the wallet must not leave the previous account's game on screen.
    useEffect(() => {
        setPlaying(false)
        if (!account?.address) { setGate('connect'); return }
        setGate('loading')
        checkAccess()
    }, [account?.address, authedWallet, checkAccess])

    /** Bumped by «Cancel»: the abandoned attempt must not flip the UI when it finally settles. */
    const verifyRunRef = useRef(0)
    const verify = useCallback(async () => {
        // Nothing may run before ensureLogin() reaches the wallet: on a phone the wallet app is
        // opened by a deep link, and Safari allows that only inside this tap (the setState calls
        // are batched by React and render after the handler, so they cost the gesture nothing).
        const run = ++verifyRunRef.current
        setSigning(true)
        setMessage(null)
        const ok = await ensureLogin()
        if (verifyRunRef.current !== run) return
        setSigning(false)
        // The hook's error is read from its ref: the `error` of this render would be the
        // previous attempt's (it used to show «Signature required» instead of the real reason).
        if (!ok) { setMessage(lastError() ?? 'Signature required to continue'); return }
        setGate('loading')
        await checkAccess()
    }, [ensureLogin, lastError, checkAccess])

    /** «The request never showed up»: release the lock so the next tap asks the wallet afresh. */
    const cancelVerify = useCallback(() => {
        verifyRunRef.current++
        cancelLogin()
        setSigning(false)
        setMessage(null)
    }, [cancelLogin])

    /**
     * The wallet app does not know ApeChain (owner, 24.09.2026, MetaMask on an iPhone:
     * «Missing or invalid. request() chainId: eip155:33139»). Over WalletConnect a phone wallet
     * approves only the chains it already has, and every request — the signature here, the
     * payments later — is addressed to ApeChain, so it is refused before the wallet ever sees it.
     * One tap asks the wallet to add ApeChain (thirdweb routes it through a chain the session
     * does have); after that signing and paying both work. Called straight from the tap: the
     * wallet app is opened by a deep link, which the browser allows only inside the gesture.
     */
    const noApeChain = !!message && /chainId:?\s*eip155:33139|missing or invalid\. request\(\) chainid/i.test(message)
    const [addingChain, setAddingChain] = useState(false)
    const addApeChain = useCallback(() => {
        if (!wallet) return
        const switching = wallet.switchChain(apeChain)
        setAddingChain(true)
        switching
            .then(() => setMessage('ApeChain added — now tap Sign to continue'))
            .catch((e: unknown) => setMessage(`Could not add ApeChain: ${e instanceof Error ? e.message : String(e)}`))
            .finally(() => setAddingChain(false))
    }, [wallet])

    /**
     * Back from the wallet app while the signature is still pending: on a phone the answer comes
     * over the WalletConnect relay, whose socket the phone froze while this page was in the
     * background — it reconnects and the answer arrives a few seconds later, or (the page was
     * reloaded meanwhile, a home-screen app's wallet hand-off was lost) never. Say which is which.
     */
    const [backFromWallet, setBackFromWallet] = useState(false)
    useEffect(() => {
        setBackFromWallet(false)
        if (!signing) return
        const onVisible = () => { if (document.visibilityState === 'visible') setBackFromWallet(true) }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    }, [signing])

    /** «Switch wallet» in the app, which has no header and so no wallet menu of its own. */
    const switchWallet = useCallback(() => {
        cancelVerify()
        if (wallet) disconnect(wallet)
    }, [cancelVerify, disconnect, wallet])

    const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`
    /** Where a phone user comes back to after the wallet app: this tab, or the home-screen app. */
    const backTo = appMode ? 'Droidz Survival' : 'this tab'
    /** The app's door is a small card on a phone held either way, so its steps are tighter. */
    const gapL = appMode ? 'mt-4' : 'mt-7'
    const gapM = appMode ? 'mt-3' : 'mt-5'
    /** A phone on its side is ~400 px tall: the app's door gets smaller type there so a step fits without a scroll. */
    const tight = appMode ? ' [@media(max-height:520px)]:mt-2 [@media(max-height:520px)]:text-xs' : ''
    const showGame = gate === 'allowed' && playing

    const gameFrame = (
        <iframe
            ref={frameRef}
            onLoad={installPay}
            src={GAME_SRC}
            title="Droidz Survival"
            className="absolute inset-0 h-full w-full border-0"
            allow="fullscreen; autoplay; gamepad"
        />
    )

    /** The door: the one step this wallet is at. The same in the page and in the app. */
    const door = (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className={appMode ? 'min-w-0 text-center' : 'min-w-0 text-center lg:text-left'}
        >
        {gate === 'loading' && (
            <>
                <Loader2 className="mx-auto h-7 w-7 animate-spin text-white icon-dim-50 lg:mx-0" />
                <p className={`${gapM} font-mono text-xs uppercase tracking-widest text-white/40`}>
                    Checking access…
                </p>
            </>
        )}

        {gate === 'connect' && (
            <>
                {!appMode && <Lock className="mx-auto h-7 w-7 text-white icon-dim-50 lg:mx-0" />}
                <h2 className={`${appMode ? '' : 'mt-5 '}text-xl font-bold uppercase tracking-tight`}>
                    Connect your wallet
                </h2>
                <p className={`mt-3 text-sm leading-relaxed text-white/50${tight}`}>
                    Open beta — connect a wallet and sign once (free, no transaction)
                    to play. Your first run is a free 3-wave trial.
                </p>
                <div className={`${gapL} flex justify-center ${appMode ? '' : 'lg:justify-start '}[&_button]:!w-full sm:[&_button]:!w-auto`}>
                    <ConnectButton
                        client={client}
                        chain={apeChain}
                        wallets={WALLETS}
                        theme="dark"
                        // The app mounts <AutoConnect> itself (it has no header to do it).
                        autoConnect={!appMode}
                        connectButton={{
                            label: 'Connect Wallet',
                            className: '!bg-white !text-black !font-bold !rounded-full !h-[46px] !px-8 !text-sm !border !border-transparent !transition-all !duration-300 hover:!bg-[#0069FF] hover:!text-white',
                        }}
                        connectModal={{ size: 'compact', title: 'ApeDroidz Access', showThirdwebBranding: false }}
                    />
                </div>
                {phone?.mobile && !phone.inWallet && (
                    <p className={`mt-4 text-xs leading-relaxed text-white/35${appMode ? ' [@media(max-height:520px)]:mt-2' : ''}`}>
                        On a phone: pick your wallet, approve the connection in its app,
                        then come back to {backTo} — the next step is one signature.
                    </p>
                )}
            </>
        )}

        {gate === 'verify' && (
            <>
                {!appMode && <ShieldCheck className="mx-auto h-7 w-7 text-white icon-dim-50 lg:mx-0" />}
                <h2 className={`${appMode ? '' : 'mt-5 '}text-xl font-bold uppercase tracking-tight`}>
                    Verify your wallet
                </h2>
                <p className={`mt-3 text-sm leading-relaxed text-white/50${tight}`}>
                    Sign a message to prove the wallet is yours. It is free, there is
                    no transaction, and nothing leaves your wallet.
                </p>
                {walletApp && !signing && (
                    <p data-testid="sign-hint" className="mt-3 text-sm leading-relaxed text-white/50">
                        Tapping Sign opens {walletApp.name} with the request. Approve it
                        there, then switch back to {backTo}.
                    </p>
                )}
                <button
                    onClick={verify}
                    disabled={signing}
                    className={`${gapL} inline-flex h-[46px] items-center justify-center gap-2 rounded-full bg-white px-8 text-sm font-bold text-black transition-all duration-300 hover:bg-[#0069FF] hover:text-white disabled:cursor-not-allowed disabled:opacity-50`}
                >
                    {signing && <Loader2 className="h-4 w-4 animate-spin" />}
                    {signing ? 'Waiting for signature…' : walletApp ? `Sign in ${walletApp.name}` : 'Sign to continue'}
                </button>
                {signing && (
                    <div data-testid="sign-waiting" className={`${gapM} space-y-3 text-sm leading-relaxed text-white/50`}>
                        <p>
                            {backFromWallet
                                ? `Approved it in ${walletApp?.name ?? 'your wallet'}? It finishes here in a few seconds. Nothing after that — tap Cancel and try again, then Sign once more.`
                                : walletApp
                                    ? `Approve the request in ${walletApp.name}, then come back to ${backTo}. No request in ${walletApp.name}? Open it again — the request may arrive a moment later.`
                                    : 'Approve the request in your wallet.'}
                        </p>
                        <div className={`flex flex-wrap items-center justify-center gap-3 ${appMode ? '' : 'lg:justify-start'}`}>
                            {walletApp && (
                                <a
                                    data-testid="open-wallet-app"
                                    href={walletApp.open}
                                    className="inline-flex h-[42px] items-center justify-center gap-2 rounded-full border border-white/20 px-6 text-sm font-bold text-white transition-all duration-300 hover:border-white/60"
                                >
                                    Open {walletApp.name}
                                </a>
                            )}
                            <button
                                data-testid="sign-cancel"
                                onClick={cancelVerify}
                                className="inline-flex h-[42px] items-center justify-center rounded-full px-4 text-sm font-bold text-white/50 transition-colors hover:text-white"
                            >
                                Cancel and try again
                            </button>
                        </div>
                    </div>
                )}
            </>
        )}

        {gate === 'denied' && (
            <>
                {!appMode && <Lock className="mx-auto h-7 w-7 text-white icon-dim-50 lg:mx-0" />}
                <h2 className={`${appMode ? '' : 'mt-5 '}text-xl font-bold uppercase tracking-tight`}>
                    Can&apos;t play on this wallet
                </h2>
                <p className={`mt-3 text-sm leading-relaxed text-white/50${tight}`}>
                    This wallet can&apos;t play right now. If you think that&apos;s a
                    mistake, open a ticket in Discord.
                </p>
                {authedWallet && !appMode && (
                    <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-white/30">
                        {short(authedWallet)}
                    </p>
                )}
                <div className={`${gapL} flex flex-col items-center gap-3 sm:flex-row sm:justify-center ${appMode ? '' : 'lg:flex-col lg:items-start'}`}>
                    <a
                        href={DISCORD_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-[46px] items-center justify-center rounded-full border border-white/20 px-8 text-sm font-bold text-white transition-all duration-300 hover:border-white/60"
                    >
                        Open a ticket in Discord
                    </a>
                </div>
                {!appMode && (
                    <p className="mt-5 text-xs leading-relaxed text-white/30">
                        Got access on a different wallet? Switch accounts and this page
                        will re-check on its own.
                    </p>
                )}
            </>
        )}

        {gate === 'allowed' && (
            <>
                {!appMode && <ShieldCheck className="mx-auto h-7 w-7 text-emerald-400 lg:mx-0" />}
                <h2 className={`${appMode ? '' : 'mt-5 '}text-xl font-bold uppercase tracking-tight`}>
                    You&apos;re in
                </h2>
                <p className={`mt-3 text-sm leading-relaxed text-white/50${tight}`}>
                    {until
                        ? `This wallet is ready to play — access for ${timeLeft(new Date(until).getTime() - now)} more.`
                        : 'This wallet is ready to play.'}
                </p>
                {!appMode && (
                    <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-white/30" title={until ? `until ${new Date(until).toLocaleString()}` : 'open beta'}>
                        {typeof until === 'string' ? `Access until ${new Date(until).toLocaleString()}` : 'Open beta'}
                        {authedWallet ? ` · ${short(authedWallet)}` : ''}
                    </p>
                )}
                <button
                    onClick={() => { appQuitRef.current = false; setPlaying(true) }}
                    className={`${gapL} inline-flex h-[46px] items-center justify-center gap-2 rounded-full bg-white px-10 text-sm font-bold text-black transition-all duration-300 hover:bg-[#0069FF] hover:text-white`}
                >
                    <Play className="h-4 w-4" fill="currentColor" />
                    Play
                </button>
            </>
        )}

        {gate === 'error' && (
            <>
                {!appMode && <Lock className="mx-auto h-7 w-7 text-white icon-dim-50 lg:mx-0" />}
                <h2 className={`${appMode ? '' : 'mt-5 '}text-xl font-bold uppercase tracking-tight`}>
                    Access check failed
                </h2>
                <p className={`mt-3 text-sm leading-relaxed text-white/50${tight}`}>
                    {message ?? 'Something went wrong on our side.'}
                </p>
                <button
                    onClick={() => { setGate('loading'); checkAccess() }}
                    className={`${gapL} inline-flex h-[46px] items-center justify-center rounded-full bg-white px-8 text-sm font-bold text-black transition-all duration-300 hover:bg-[#0069FF] hover:text-white`}
                >
                    Try again
                </button>
            </>
        )}

        {gate === 'verify' && noApeChain ? (
            <div className={`${gapM} space-y-3`}>
                <p className="text-sm leading-relaxed text-white/60">
                    Your wallet app does not have ApeChain yet. Add it with one tap, then sign.
                </p>
                <button
                    onClick={addApeChain}
                    disabled={addingChain}
                    className="inline-flex h-[42px] items-center justify-center gap-2 rounded-full border border-white/20 px-6 text-sm font-bold text-white transition-all duration-300 hover:bg-[#0069FF] disabled:opacity-50"
                >
                    {addingChain && <Loader2 className="h-4 w-4 animate-spin" />}
                    Add ApeChain to your wallet
                </button>
            </div>
        ) : message && gate !== 'error' && (
            <p className={`${gapM} font-mono text-[11px] uppercase tracking-widest ${message.startsWith('ApeChain added') ? 'text-emerald-400/80' : 'text-red-400/70'}`}>
                {message}
            </p>
        )}

        {/* The app has no header and so no wallet menu: the connected wallet and a way to change it. */}
        {appMode && account?.address && gate !== 'loading' && (
            <div className={`${gapL} flex items-center justify-center gap-3 font-mono text-[11px] uppercase tracking-widest text-white/35`}>
                <span>{short(account.address)}</span>
                <button
                    data-testid="app-switch-wallet"
                    onClick={switchWallet}
                    className="inline-flex items-center gap-1.5 text-white opacity-50 transition-opacity hover:opacity-100"
                >
                    <LogOut className="h-3.5 w-3.5" />
                    Switch wallet
                </button>
            </div>
        )}

        {/* The way out on a phone (owner, 01.10.2026: a signature that never reached
            MetaMask from Safari): the same page inside the wallet's own browser,
            where it signs in place. Not shown inside a wallet browser already. */}
        {(gate === 'connect' || gate === 'verify') && phone?.mobile && !phone.inWallet && (
            <div data-testid="wallet-browser-links" className={`${appMode ? 'mt-5 pt-4 [@media(max-height:520px)]:mt-3 [@media(max-height:520px)]:pt-3' : 'mt-8 pt-5'} border-t border-white/10`}>
                <p className="text-xs leading-relaxed text-white/35">
                    {appMode
                        ? 'Still stuck? Play in your wallet’s own browser instead and connect there:'
                        : <>Still stuck? Open this page in your wallet&apos;s own browser and connect there:</>}
                </p>
                <div className={`mt-3 flex flex-wrap items-center justify-center gap-2 ${appMode ? '' : 'lg:justify-start'}`}>
                    <a
                        data-testid="open-in-metamask"
                        href={phone.links.metamask}
                        className="inline-flex h-[36px] items-center gap-1.5 rounded-full border border-white/15 px-4 text-xs font-bold text-white/80 transition-colors hover:border-white/50 hover:text-white"
                    >
                        <ExternalLink className="h-3.5 w-3.5 icon-dim-50" />
                        MetaMask browser
                    </a>
                    <a
                        data-testid="open-in-coinbase"
                        href={phone.links.coinbase}
                        className="inline-flex h-[36px] items-center gap-1.5 rounded-full border border-white/15 px-4 text-xs font-bold text-white/80 transition-colors hover:border-white/50 hover:text-white"
                    >
                        <ExternalLink className="h-3.5 w-3.5 icon-dim-50" />
                        Coinbase Wallet browser
                    </a>
                </div>
            </div>
        )}

        {/* Play it as an app (owner, 02.10.2026): a phone's browser, not a wallet's, not the app already. */}
        {!appMode && phone?.mobile && !phone.inWallet && <InstallHint ios={phone.ios} />}
        </motion.div>
    )

    // ── The home-screen app: the door, then the game on the whole screen, nothing of the site ──
    if (appMode) {
        return (
            <div data-testid="ds-app" className="fixed inset-0 overflow-hidden bg-black text-white">
                {/* No header here to restore the wallet after a relaunch — this does it. */}
                <AutoConnect client={client} wallets={WALLETS} />
                {showGame ? (
                    // Inside the notch and above the home indicator; the game letterboxes its 16:9 itself.
                    <div
                        data-testid="ds-app-game"
                        className="absolute inset-0 bg-black"
                        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
                    >
                        <div className="relative h-full w-full">{gameFrame}</div>
                        {payNote && (
                            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-orange-500/90 px-4 py-2 text-xs text-black" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
                                <span>{payNote}</span>
                                <button onClick={() => setPayNote(null)} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div
                        data-testid="ds-app-door"
                        className="absolute inset-0 overflow-y-auto overscroll-none"
                        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', paddingLeft: 'max(16px, env(safe-area-inset-left))', paddingRight: 'max(16px, env(safe-area-inset-right))' }}
                    >
                        {/* The cover, dimmed — the game's own first picture, behind the step. */}
                        <div aria-hidden className="pointer-events-none fixed inset-0 bg-[#0a0f1e] bg-cover bg-center opacity-50" style={{ backgroundImage: 'url(/droidz_survival/DS_Beta_cover.jpg)' }} />
                        <div aria-hidden className="pointer-events-none fixed inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/80" />
                        <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-4 py-2 landscape:max-w-4xl landscape:flex-row landscape:gap-8">
                            <div className="shrink-0 text-center landscape:w-[38%]">
                                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/45">Open Beta</p>
                                <h1 className="mt-2 text-3xl font-black uppercase leading-none tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                                    <GlitchText text="Droidz Survival" />
                                </h1>
                                <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-white/40">Pixel roguelite · ApeChain</p>
                            </div>
                            <div className="w-full rounded-2xl border border-white/10 bg-black/60 p-5 backdrop-blur-md landscape:max-w-md [@media(max-height:520px)]:p-4">
                                {door}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="relative min-h-screen bg-black text-white overflow-x-hidden">
            {/* Fixed behind everything, like the staking page: bare, the background is a
                block that fills a whole screen and pushes the gate a viewport down.
                Not on a phone while the game runs: a full-window canvas redrawn ten times a second
                under the game (and under the header's blur) is memory and battery the game needs —
                iOS kills a tab that holds too much. */}
            {!(showGame && phone?.mobile) && (
                <div className="ds-site-only fixed inset-0 z-0 opacity-40 pointer-events-none mix-blend-lighten"><DigitalBackground /></div>
            )}
            <div className="ds-site-only"><Header onOpenProfile={() => setIsProfileOpen(true)} /></div>

            <main className={`ds-site-only relative z-10 mx-auto flex min-h-[100svh] w-full flex-col justify-center px-4 ${showGame ? 'pb-4 pt-20 sm:pt-24' : 'pb-10 pt-24 sm:pt-28'}`}>
                {showGame ? (
                    // As big as the screen allows (owner, 25.09.2026: «окно больше, чем сейчас»): the
                    // 16:9 frame takes the viewport's height under the header, up to the full width.
                    <div
                        className={pseudoFs ? 'fixed inset-0 z-[9999] h-[100dvh] w-screen bg-black' : 'mx-auto w-full'}
                        style={pseudoFs
                            ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }
                            : { maxWidth: 'min(100%, calc((100svh - 150px) * 16 / 9))' }}
                    >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.985 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        className={pseudoFs ? 'relative h-full w-full' : undefined}
                    >
                        {pseudoFs && (
                            <button
                                onClick={() => setPseudoFs(false)}
                                aria-label="Exit full screen"
                                className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white/60 hover:text-white"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                        <div className={pseudoFs ? 'h-full w-full bg-black' : 'overflow-hidden rounded-2xl border border-white/10 bg-black'}>
                            <div className={pseudoFs ? 'hidden' : 'flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2'}>
                                <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-white/40" title={until ? `until ${new Date(until).toLocaleString()}` : 'open beta'}>
                                    <ShieldCheck className="h-3.5 w-3.5 icon-dim-50" />
                                    {until ? `Access · ${timeLeft(new Date(until).getTime() - now)} left` : 'Open beta'}
                                    {authedWallet ? <span className="hidden sm:inline text-white/25">· {short(authedWallet)}</span> : null}
                                </span>
                                <button
                                    onClick={goFullscreen}
                                    className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-white/40 transition-colors hover:text-white"
                                >
                                    <Maximize2 className="h-3.5 w-3.5 icon-dim-50" />
                                    Fullscreen
                                </button>
                            </div>
                            {payNote && !pseudoFs && (
                                <div className="flex items-center justify-between gap-3 border-b border-orange-400/30 bg-orange-500/10 px-4 py-2 text-xs text-orange-200">
                                    <span>{payNote}</span>
                                    <button onClick={() => setPayNote(null)} aria-label="Dismiss" className="text-orange-200/60 hover:text-white"><X className="h-3.5 w-3.5" /></button>
                                </div>
                            )}
                            {/* 16:9 — the Phaser canvas is 1280×720 and letterboxes itself inside.
                                The cover sits behind the frame so the box is the poster, not a
                                grey slab, for the second or two the build takes to arrive. */}
                            <div className={pseudoFs ? 'relative h-full w-full bg-[#0a0f1e] bg-cover bg-bottom' : 'relative aspect-video w-full bg-[#0a0f1e] bg-cover bg-bottom'} style={{ backgroundImage: 'url(/droidz_survival/DS_Beta_cover.jpg)' }}>
                                {gameFrame}
                            </div>
                        </div>
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
                        {door}
                    </div>
                )}
            </main>

            <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
        </div>
    )
}

/**
 * «Play it like an app» (owner, 02.10.2026: «важно сделать mobile native»): on a phone's browser,
 * how to put the game on the Home Screen, where it opens without the browser's bars.
 *  - iPhone: there is no prompt to call — Share → Add to Home Screen is the only way, so say it.
 *  - Android (Chrome): the browser's own install prompt, kept by layout.tsx's early script when it
 *    fires; without one (another browser, or not offered yet) — the menu's «Add to Home screen».
 * Dismissed once, it stays dismissed on this phone.
 */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const INSTALL_HINT_KEY = 'ds_install_hint_dismissed_v1'

function InstallHint({ ios }: { ios: boolean }) {
    const [hidden, setHidden] = useState(true)
    const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
    const [steps, setSteps] = useState(false)

    useEffect(() => {
        let dismissed = false
        try { dismissed = localStorage.getItem(INSTALL_HINT_KEY) === '1' } catch { /* private mode */ }
        const w = window as Window & { __dsInstallPrompt?: InstallPromptEvent | null; __dsInstalled?: boolean }
        const sync = () => {
            setPrompt(w.__dsInstallPrompt ?? null)
            if (w.__dsInstalled) setHidden(true)
        }
        // The early script may not have run (a client-side navigation to this page): listen here too.
        const onPrompt = (e: Event) => { e.preventDefault(); w.__dsInstallPrompt = e as InstallPromptEvent; sync() }
        const onInstalled = () => { w.__dsInstallPrompt = null; w.__dsInstalled = true; sync() }
        setHidden(dismissed || !!w.__dsInstalled)
        sync()
        window.addEventListener('ds:installable', sync)
        window.addEventListener('beforeinstallprompt', onPrompt)
        window.addEventListener('appinstalled', onInstalled)
        return () => {
            window.removeEventListener('ds:installable', sync)
            window.removeEventListener('beforeinstallprompt', onPrompt)
            window.removeEventListener('appinstalled', onInstalled)
        }
    }, [])

    if (hidden) return null

    const dismiss = () => {
        setHidden(true)
        try { localStorage.setItem(INSTALL_HINT_KEY, '1') } catch { /* private mode */ }
    }
    const install = async () => {
        if (!prompt) return
        try {
            await prompt.prompt()
            const { outcome } = await prompt.userChoice
            if (outcome === 'accepted') setHidden(true)
        } catch { setSteps(true) }
        // A prompt is good for one call only.
        ;(window as Window & { __dsInstallPrompt?: unknown }).__dsInstallPrompt = null
        setPrompt(null)
    }

    return (
        <div data-testid="install-hint" className="relative mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left">
            <button onClick={dismiss} aria-label="Hide" className="absolute right-3 top-3 text-white opacity-40 transition-opacity hover:opacity-100">
                <X className="h-3.5 w-3.5" />
            </button>
            <p className="pr-6 font-mono text-[11px] uppercase tracking-widest text-white/60">Play it like an app</p>
            <p className="mt-2 text-xs leading-relaxed text-white/45">
                Add Droidz Survival to your Home Screen: it opens full screen, without the browser&apos;s bars.
            </p>
            {ios ? (
                <ol data-testid="install-steps-ios" className="mt-3 space-y-2 text-xs leading-relaxed text-white/70">
                    <li className="flex items-center gap-2">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/20 font-mono text-[10px]">1</span>
                        <span>In Safari tap Share <Share className="inline h-3.5 w-3.5 -translate-y-px text-white" /> (on newer iOS it is under ••• )</span>
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/20 font-mono text-[10px]">2</span>
                        <span>Add to Home Screen <SquarePlus className="inline h-3.5 w-3.5 -translate-y-px text-white" /> → Add</span>
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/20 font-mono text-[10px]">3</span>
                        <span>Open Droidz Survival from the Home Screen and sign in once there</span>
                    </li>
                </ol>
            ) : (
                <>
                    {/* Chrome's own prompt when it has offered one; the menu's way otherwise. */}
                    {prompt && (
                        <button
                            data-testid="install-app"
                            onClick={install}
                            className="mt-3 inline-flex h-[40px] items-center justify-center gap-2 rounded-full bg-white px-6 text-xs font-bold text-black transition-all duration-300 hover:bg-[#0069FF] hover:text-white"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Install app
                        </button>
                    )}
                    {(steps || !prompt) && (
                        <p data-testid="install-steps-android" className="mt-3 text-xs leading-relaxed text-white/45">
                            Browser menu ⋮ → Install app (or Add to Home screen), then open Droidz Survival
                            from the Home Screen and sign in once there.
                        </p>
                    )}
                </>
            )}
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
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/40">Open Beta</p>
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

    // PLAY takes this card off the page; the decoder and the buffered video go with it at once,
    // not whenever the browser gets round to collecting the element — a phone needs that memory
    // for the game (iOS kills a tab that holds too much).
    useEffect(() => {
        const v = ref.current
        return () => {
            if (!v) return
            try { v.pause(); v.removeAttribute('src'); v.load() } catch { /* already gone */ }
        }
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
