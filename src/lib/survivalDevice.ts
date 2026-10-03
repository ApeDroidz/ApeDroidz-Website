'use client'

/**
 * What the Droidz Survival pages need to know about the device they run on. All client-only: the
 * server render knows none of it, so callers read these after mount.
 */

/** Phone or tablet (iPadOS reports itself as a Mac with a touch screen). */
export function isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent
    return /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** iPhone / iPad (iPadOS says it is a Mac with a touch screen). */
export function isIOSDevice(): boolean {
    if (typeof navigator === 'undefined') return false
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

/**
 * Inside a wallet's own browser (MetaMask, Coinbase Wallet, Rainbow…) the wallet is injected and
 * signs in place — no deep link, no WalletConnect.
 */
export function inWalletBrowser(): boolean {
    if (typeof window === 'undefined') return false
    return !!(window as Window & { ethereum?: unknown }).ethereum
}

/**
 * Opened as the home-screen app (iOS «Add to Home Screen», an installed Android web app) — or with
 * ?app=1, the manifest's start_url, which is also how the app shell is tried in a plain browser.
 * The game asks the same question of this window (game/src/systems/Mobile.ts isStandaloneApp).
 */
export function isAppMode(): boolean {
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

/**
 * The way out when the phone's browser and the wallet app will not talk: open this very page in
 * the wallet's built-in browser, where signing needs no hand-off at all.
 * MetaMask: https://metamask.app.link/dapp/<host><path> (no scheme — MetaMask adds https).
 * Coinbase Wallet: https://go.cb-w.com/dapp?cb_url=<the full URL, encoded>.
 */
export function walletBrowserLinks(loc: { host: string; pathname: string; search: string; href: string }) {
    return {
        metamask: `https://metamask.app.link/dapp/${loc.host}${loc.pathname}${loc.search}`,
        coinbase: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(loc.href)}`,
    }
}
