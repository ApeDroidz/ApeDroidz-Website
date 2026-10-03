'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useActiveAccount, useActiveWallet, useDisconnect, useSendTransaction, AutoConnect, ConnectButton } from 'thirdweb/react'
import { createWallet, injectedProvider } from 'thirdweb/wallets'
import { prepareTransaction, toWei } from 'thirdweb'
import { client, apeChain } from '@/lib/thirdweb'
import { ArrowLeft, ExternalLink, Loader2, LogOut, Play, X } from 'lucide-react'
import { useGlitchSession } from '@/hooks/useGlitchSession'
import { GlitchText } from '@/components/glitch/glitch-text'
import { InstallHint } from '@/components/survival/install-hint'
import { DISCORD_URL } from '@/lib/socials'
import { cancelOrder, createOrder, isUserRejection, leaveFullscreen, reportPayment, singleFlight } from '@/lib/survivalHostPay'
import { inWalletBrowser, isAppMode, isIOSDevice, isMobileDevice, walletBrowserLinks } from '@/lib/survivalDevice'
import { trackFunnel } from '@/lib/survivalFunnel'

/**
 * /droidz_survival/play — the sign-in and the game, on the whole screen, nothing of the site
 * (owner, 03.10.2026: «/play — только вход и игра на весь экран (как режим приложения)»). The
 * landing (/droidz_survival) sends PLAY here; the home-screen app opens here (manifest start_url).
 *
 * Not to be confused with the BUILD, which lives under /droidz_survival/play/index.html and
 * /droidz_survival/play/assets/… (public/droidz_survival/play/) behind the beta gate. This route is
 * the bare /droidz_survival/play only — the middleware lets exactly that path through without the
 * play cookie (it is where the cookie is earned) and keeps everything under it gated.
 *
 * The gate, as before — one state at a time:
 *
 *   connect   no wallet                     → Connect Wallet (this page mounts AutoConnect itself)
 *   verify    wallet, but no signature yet  → one signMessage; a connected wallet is a claim, a
 *                                             signed session is proof. On a desktop it is asked for
 *                                             on its own right after connecting (owner, 03.10)
 *   denied    banned / access revoked       → say so plainly and say who to ask
 *   allowed   verified                      → the game, at once
 *
 * The gate is enforced server-side too: /api/survival/access reads the signed session, checks the
 * wallet, and mints the cookie without which the middleware will not serve a single file of the
 * build. This page cannot let anyone in on its own.
 */

const GAME_SRC = '/droidz_survival/play/index.html'
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

/** Flip to true (or set NEXT_PUBLIC_SURVIVAL_PAY_FOR_REAL=1) when the contracts are in. */
const PAY_FOR_REAL = process.env.NEXT_PUBLIC_SURVIVAL_PAY_FOR_REAL === '1'

type Gate = 'loading' | 'connect' | 'verify' | 'denied' | 'allowed' | 'error'

export default function DroidzSurvivalPlayPage() {
    const account = useActiveAccount()
    const wallet = useActiveWallet()
    const { authedWallet, ensureLogin, canAutoSign, cancelLogin, lastError } = useGlitchSession()

    const [gate, setGate] = useState<Gate>('loading')
    const [signing, setSigning] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    /** Access expiry from /api/survival/access: an ISO instant, null = no expiry, undefined = unknown. */
    const [until, setUntil] = useState<string | null | undefined>(undefined)
    const [playing, setPlaying] = useState(false)
    /** Phone facts, read after mount (the server render knows neither). */
    const [phone, setPhone] = useState<{ mobile: boolean; ios: boolean; inWallet: boolean; links: ReturnType<typeof walletBrowserLinks> } | null>(null)
    /** The home-screen app (or ?app=1): no way back to the site's pages, no install hint. */
    const [appMode, setAppMode] = useState(false)
    useEffect(() => {
        // The wallet's own browser gets the page as it was opened (?app=1 dropped: it is a page there, not the app).
        const url = new URL(window.location.href)
        url.searchParams.delete('app')
        setPhone({ mobile: isMobileDevice(), ios: isIOSDevice(), inWallet: inWalletBrowser(), links: walletBrowserLinks(url) })
        setAppMode(isAppMode())
    }, [])
    /** QUIT TO SITE (the game's pause menu): back to this page's door, not straight into a new game. */
    const quitRef = useRef(false)
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
    /** The connected address, for checks that run after an await (no stale closure). */
    const addrRef = useRef<string | null>(null)
    addrRef.current = account?.address?.toLowerCase() ?? null

    // The paid door. The game (an iframe on our own origin) looks for `window.DroidzPay` and offers
    // its paid buttons only when it is there. We install it on the frame's window. Behind
    // PAY_FOR_REAL it is the real thing (an order, the player's wallet pays the cashier, the server
    // books it from the Paid event); without it, a stub that says yes and charges nothing.
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

    // The game's messages, only from our own frame. The frame already IS the whole window here, so
    // 'ds:fullscreen' / 'ds:exitfullscreen' have nothing to lay over or leave; QUIT TO SITE comes
    // back to this page's door.
    useEffect(() => {
        const onMsg = (e: MessageEvent) => {
            if (e.source !== frameRef.current?.contentWindow || e.origin !== window.location.origin) return
            const t = (e.data as { type?: unknown } | null)?.type
            if (t === 'ds:quit') { quitRef.current = true; setPlaying(false) }
        }
        window.addEventListener('message', onMsg)
        return () => window.removeEventListener('message', onMsg)
    }, [])

    // Straight into the game once the door is open — unless the player has just quit to the door.
    useEffect(() => {
        if (gate === 'allowed' && !quitRef.current) setPlaying(true)
    }, [gate])

    // The screen is the window: no rubber-band scroll of the page behind the game or the door.
    useEffect(() => {
        const html = document.documentElement, body = document.body
        const prev = [html.style.overscrollBehavior, body.style.overscrollBehavior, body.style.overflow, body.style.background]
        html.style.overscrollBehavior = 'none'
        body.style.overscrollBehavior = 'none'
        body.style.overflow = 'hidden'
        body.style.background = '#000'
        return () => { [html.style.overscrollBehavior, body.style.overscrollBehavior, body.style.overflow, body.style.background] = prev }
    }, [])

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

    // A timed access runs out: the gate re-checks itself and the door closes (the play cookie is
    // capped at the same instant server-side, so the build stops being served too).
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

    // The funnel (lib/survivalFunnel.ts): a wallet on this page, then a signed-in, open door.
    useEffect(() => { if (account?.address) trackFunnel('wallet_connected') }, [account?.address])
    useEffect(() => { if (gate === 'allowed') trackFunnel('signed_in') }, [gate])

    /** Bumped by «Cancel»: the abandoned attempt must not flip the UI when it finally settles. */
    const verifyRunRef = useRef(0)
    const verify = useCallback(async (auto = false) => {
        // Nothing may run before ensureLogin() reaches the wallet: on a phone the wallet app is
        // opened by a deep link, and Safari allows that only inside this tap (the setState calls
        // are batched by React and render after the handler, so they cost the gesture nothing).
        const run = ++verifyRunRef.current
        setSigning(true)
        setMessage(null)
        const ok = await ensureLogin(auto ? { auto: true } : undefined)
        if (verifyRunRef.current !== run) return
        setSigning(false)
        // The hook's error is read from its ref: the `error` of this render would be the
        // previous attempt's (it used to show «Signature required» instead of the real reason).
        // An automatic ask that did not happen (the hook declined it) is not an error: the button stays.
        if (!ok) { setMessage(auto ? lastError() : lastError() ?? 'Signature required to continue'); return }
        setGate('loading')
        await checkAccess()
    }, [ensureLogin, lastError, checkAccess])

    /**
     * The signature asks for itself on a desktop, right after the wallet connects (owner, 03.10.2026:
     * «на десктопе запрашивается сама сразу после подключения»). Once per wallet on this page: a
     * rejected or cancelled prompt is not asked again on its own — the Sign button stays.
     * Only where the wallet signs in the page itself — an injected extension, a wallet's own browser,
     * an in-app wallet (useGlitchSession canAutoSign / ensureLogin({ auto: true })): a phone's wallet
     * app over WalletConnect is opened by a deep link, which only a tap may do, so there the Sign
     * button stays. The hook also asks each wallet at most once per page load.
     */
    const autoSignedRef = useRef<string | null>(null)
    useEffect(() => {
        const addr = account?.address?.toLowerCase()
        if (gate !== 'verify' || !addr || signing) return
        if (autoSignedRef.current === addr) return
        autoSignedRef.current = addr
        if (!canAutoSign()) return
        void verify(true)
    }, [gate, account?.address, signing, verify, canAutoSign])

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
     * One tap asks the wallet to add ApeChain; after that signing and paying both work. Called
     * straight from the tap: the wallet app is opened by a deep link, allowed only inside the gesture.
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

    /** «Switch wallet» — the page has no header and so no wallet menu of its own. */
    const switchWallet = useCallback(() => {
        cancelVerify()
        if (wallet) disconnect(wallet)
    }, [cancelVerify, disconnect, wallet])

    const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`
    /** Where a phone user comes back to after the wallet app: this tab, or the home-screen app. */
    const backTo = appMode ? 'Droidz Survival' : 'this tab'
    /** A phone on its side is ~400 px tall: smaller type there so a step fits without a scroll. */
    const tight = ' [@media(max-height:520px)]:mt-2 [@media(max-height:520px)]:text-xs'
    const showGame = gate === 'allowed' && playing

    const btnPrimary = 'inline-flex h-[46px] items-center justify-center gap-2 rounded-full bg-white px-8 text-sm font-bold text-black transition-all duration-300 hover:bg-[#0069FF] hover:text-white disabled:cursor-not-allowed disabled:opacity-50'

    /** The door: the one step this wallet is at. */
    const door = (
        <div className="ds-door-in min-w-0 text-center">
            {gate === 'loading' && (
                <>
                    <Loader2 className="mx-auto h-7 w-7 animate-spin text-white icon-dim-50" />
                    <p className="mt-3 font-mono text-xs uppercase tracking-widest text-white/40">Checking access…</p>
                </>
            )}

            {gate === 'connect' && (
                <>
                    <h2 className="text-xl font-bold uppercase tracking-tight">Connect your wallet</h2>
                    <p className={`mt-3 text-sm leading-relaxed text-white/50${tight}`}>
                        Connect a wallet and sign once (free, no transaction) to play.
                        Your first run is a free 3-wave trial.
                    </p>
                    <div className="mt-4 flex justify-center [&_button]:!w-full sm:[&_button]:!w-auto">
                        <ConnectButton
                            client={client}
                            chain={apeChain}
                            wallets={WALLETS}
                            theme="dark"
                            // <AutoConnect> below restores the wallet (there is no header to do it).
                            autoConnect={false}
                            connectButton={{
                                label: 'Connect Wallet',
                                className: '!bg-white !text-black !font-bold !rounded-full !h-[46px] !px-8 !text-sm !border !border-transparent !transition-all !duration-300 hover:!bg-[#0069FF] hover:!text-white',
                            }}
                            connectModal={{ size: 'compact', title: 'ApeDroidz Access', showThirdwebBranding: false }}
                        />
                    </div>
                    {phone?.mobile && !phone.inWallet && (
                        <p className="mt-4 text-xs leading-relaxed text-white/35 [@media(max-height:520px)]:mt-2">
                            On a phone: pick your wallet, approve the connection in its app,
                            then come back to {backTo} — the next step is one signature.
                        </p>
                    )}
                </>
            )}

            {gate === 'verify' && (
                <>
                    <h2 className="text-xl font-bold uppercase tracking-tight">Verify your wallet</h2>
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
                    <button onClick={() => verify()} disabled={signing} className={`mt-4 ${btnPrimary}`}>
                        {signing && <Loader2 className="h-4 w-4 animate-spin" />}
                        {signing ? 'Waiting for signature…' : walletApp ? `Sign in ${walletApp.name}` : 'Sign to continue'}
                    </button>
                    {signing && (
                        <div data-testid="sign-waiting" className="mt-3 space-y-3 text-sm leading-relaxed text-white/50">
                            <p>
                                {backFromWallet
                                    ? `Approved it in ${walletApp?.name ?? 'your wallet'}? It finishes here in a few seconds. Nothing after that — tap Cancel and try again, then Sign once more.`
                                    : walletApp
                                        ? `Approve the request in ${walletApp.name}, then come back to ${backTo}. No request in ${walletApp.name}? Open it again — the request may arrive a moment later.`
                                        : 'Approve the request in your wallet.'}
                            </p>
                            <div className="flex flex-wrap items-center justify-center gap-3">
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
                    <h2 className="text-xl font-bold uppercase tracking-tight">Can&apos;t play on this wallet</h2>
                    <p className={`mt-3 text-sm leading-relaxed text-white/50${tight}`}>
                        This wallet can&apos;t play right now. If you think that&apos;s a
                        mistake, open a ticket in Discord.
                    </p>
                    <div className="mt-4 flex justify-center">
                        <a
                            href={DISCORD_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-[46px] items-center justify-center rounded-full border border-white/20 px-8 text-sm font-bold text-white transition-all duration-300 hover:border-white/60"
                        >
                            Open a ticket in Discord
                        </a>
                    </div>
                </>
            )}

            {gate === 'allowed' && (
                <>
                    <h2 className="text-xl font-bold uppercase tracking-tight">You&apos;re in</h2>
                    <p className={`mt-3 text-sm leading-relaxed text-white/50${tight}`}>This wallet is ready to play.</p>
                    <button onClick={() => { quitRef.current = false; setPlaying(true) }} className={`mt-4 ${btnPrimary} px-10`}>
                        <Play className="h-4 w-4" fill="currentColor" />
                        Play
                    </button>
                </>
            )}

            {gate === 'error' && (
                <>
                    <h2 className="text-xl font-bold uppercase tracking-tight">Access check failed</h2>
                    <p className={`mt-3 text-sm leading-relaxed text-white/50${tight}`}>{message ?? 'Something went wrong on our side.'}</p>
                    <button onClick={() => { setGate('loading'); checkAccess() }} className={`mt-4 ${btnPrimary}`}>
                        Try again
                    </button>
                </>
            )}

            {gate === 'verify' && noApeChain ? (
                <div className="mt-3 space-y-3">
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
                <p className={`mt-3 font-mono text-[11px] uppercase tracking-widest ${message.startsWith('ApeChain added') ? 'text-emerald-400/80' : 'text-red-400/70'}`}>
                    {message}
                </p>
            )}

            {/* No header here, so no wallet menu: the connected wallet and a way to change it. */}
            {account?.address && gate !== 'loading' && (
                <div className="mt-4 flex items-center justify-center gap-3 font-mono text-[11px] uppercase tracking-widest text-white/35">
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

            {/* The way out on a phone (owner, 01.10.2026: a signature that never reached MetaMask
                from Safari): the same page inside the wallet's own browser, where it signs in place. */}
            {(gate === 'connect' || gate === 'verify') && phone?.mobile && !phone.inWallet && (
                <div data-testid="wallet-browser-links" className="mt-5 border-t border-white/10 pt-4 [@media(max-height:520px)]:mt-3 [@media(max-height:520px)]:pt-3">
                    <p className="text-xs leading-relaxed text-white/35">
                        Still stuck? Play in your wallet&apos;s own browser instead and connect there:
                    </p>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
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

            {/* Play it as an app: a phone's browser, not a wallet's, not the app already. */}
            {!appMode && phone?.mobile && !phone.inWallet && <InstallHint ios={phone.ios} className="mt-5" />}
        </div>
    )

    return (
        <div data-testid="ds-play" className="fixed inset-0 overflow-hidden bg-black text-white">
            {/* There is no header here to restore the wallet after a reload — this does it. */}
            <AutoConnect client={client} wallets={WALLETS} />
            {/* Mount-in for the door without framer-motion: nothing to load under the game. */}
            <style>{'@keyframes dsDoorIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}.ds-door-in{animation:dsDoorIn .45s cubic-bezier(.16,1,.3,1) both}@media (prefers-reduced-motion:reduce){.ds-door-in{animation:none}}'}</style>
            {showGame ? (
                // Inside the notch and above the home indicator; the game letterboxes its 16:9 itself.
                <div
                    data-testid="ds-play-game"
                    className="absolute inset-0 bg-black"
                    style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
                >
                    <div className="relative h-full w-full">
                        <iframe
                            ref={frameRef}
                            onLoad={installPay}
                            src={GAME_SRC}
                            title="Droidz Survival"
                            className="absolute inset-0 h-full w-full border-0"
                            allow="fullscreen; autoplay; gamepad"
                        />
                    </div>
                    {payNote && (
                        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-orange-500/90 px-4 py-2 text-xs text-black" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
                            <span>{payNote}</span>
                            <button onClick={() => setPayNote(null)} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
                        </div>
                    )}
                </div>
            ) : (
                <div
                    data-testid="ds-play-door"
                    className="absolute inset-0 overflow-y-auto overscroll-none"
                    style={{ paddingTop: 'max(12px, env(safe-area-inset-top))', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', paddingLeft: 'max(16px, env(safe-area-inset-left))', paddingRight: 'max(16px, env(safe-area-inset-right))' }}
                >
                    {/* The cover, dimmed — the game's own first picture, behind the step. */}
                    <div aria-hidden className="pointer-events-none fixed inset-0 bg-[#0a0f1e] bg-cover bg-center opacity-50" style={{ backgroundImage: 'url(/droidz_survival/DS_Beta_cover.jpg)' }} />
                    <div aria-hidden className="pointer-events-none fixed inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/80" />
                    {/* Back to the landing — not in the home-screen app, which is only the game. */}
                    {!appMode && (
                        <a
                            href="/droidz_survival"
                            data-testid="play-back"
                            className="relative z-10 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-white/60 backdrop-blur transition-colors hover:text-white"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Droidz Survival
                        </a>
                    )}
                    <div className={`relative mx-auto flex w-full max-w-md flex-col items-center justify-center gap-4 py-2 landscape:max-w-4xl landscape:flex-row landscape:gap-8 ${appMode ? 'min-h-full' : 'min-h-[calc(100%-2.5rem)]'}`}>
                        <div className="shrink-0 text-center landscape:w-[38%]">
                            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/45">Open Beta</p>
                            <h1 className="mt-2 text-3xl font-black uppercase leading-none tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] lg:text-5xl">
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
