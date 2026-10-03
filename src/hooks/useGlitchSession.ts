'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useActiveAccount, useActiveWallet } from 'thirdweb/react'
import { injectedProvider } from 'thirdweb/wallets'

/**
 * Stateful session hook for Glitch Games.
 *
 * Flow:
 *  - On wallet connect, GET /api/auth/me. If the cookie is valid for the
 *    current wallet, we are authed.
 *  - Otherwise `ensureLogin()` prompts a single signMessage and POSTs to
 *    /api/auth/login. The endpoint sets an httpOnly cookie.
 *  - All mutating endpoints just need `credentials: 'include'`.
 *
 * Wallet switch / disconnect → server cookie cleared via /api/auth/logout.
 *
 * Auto sign-in (owner, 03.10.2026: «на десктопе подпись запрашивается сама сразу после
 * подключения»): `ensureLogin({ auto: true })` asks for the signature without a click — but only
 * where no click is needed for the wallet to show it (`canAutoSign()`), and only once per wallet per
 * page load, so a refused prompt is not shown again by itself. Everywhere else (a phone talking to
 * its wallet app over WalletConnect, Coinbase's popup) it returns false at once, touching nothing,
 * and the page keeps its SIGN IN button: those wallets open from a user gesture or not at all.
 */

/** Wallets that sign inside the page with no hand-off to another app or window. */
const SILENT_WALLETS = new Set(['inApp', 'embedded', 'smart'])

interface SessionState {
    authedWallet: string | null
    loading: boolean
    error: string | null
}

const INITIAL: SessionState = { authedWallet: null, loading: true, error: null }

function genNonce(): string {
    const arr = new Uint8Array(16)
    crypto.getRandomValues(arr)
    const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
    return `${Date.now()}.${hex}`
}

export function useGlitchSession() {
    const account = useActiveAccount()
    const wallet = useActiveWallet()
    const [state, setState] = useState<SessionState>(INITIAL)

    // Ref mirrors state for synchronous reads inside callbacks.
    const stateRef = useRef<SessionState>(INITIAL)
    useEffect(() => { stateRef.current = state }, [state])

    // Prevent concurrent /me checks and signing prompts.
    const checkingRef = useRef(false)
    const signingRef = useRef(false)
    /** Bumped by cancelLogin(): a prompt the person gave up on no longer holds the next one back. */
    const attemptRef = useRef(0)
    const lastCheckedWalletRef = useRef<string | null>(null)
    /** Wallets (lowercase) the automatic prompt has already been shown to on this page. */
    const autoTriedRef = useRef<Set<string>>(new Set())

    const setSession = useCallback((next: Partial<SessionState>) => {
        setState(prev => {
            const merged = { ...prev, ...next }
            stateRef.current = merged
            return merged
        })
    }, [])

    /** GET /api/auth/me and update state. Returns the cookie wallet (lowercase) if any. */
    const refresh = useCallback(async (): Promise<string | null> => {
        if (checkingRef.current) {
            // Wait briefly for the in-flight check to complete.
            for (let i = 0; i < 50; i++) {
                await new Promise(r => setTimeout(r, 50))
                if (!checkingRef.current) break
            }
            return stateRef.current.authedWallet
        }
        checkingRef.current = true
        try {
            const res = await fetch('/api/auth/me', {
                credentials: 'include',
                cache: 'no-store',
            })
            const data = await res.json().catch(() => ({}))
            const cookieWallet = data?.authenticated
                ? String(data.wallet ?? '').toLowerCase()
                : null
            const cur = account?.address?.toLowerCase() ?? null

            if (cookieWallet && (!cur || cookieWallet === cur)) {
                setSession({ authedWallet: cookieWallet, loading: false, error: null })
                return cookieWallet
            }

            // Cookie exists but for a different wallet — clear it server-side.
            if (cookieWallet && cur && cookieWallet !== cur) {
                fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
            }
            setSession({ authedWallet: null, loading: false })
            return null
        } catch {
            setSession({ authedWallet: null, loading: false })
            return null
        } finally {
            checkingRef.current = false
        }
    }, [account?.address, setSession])

    // Initial check + re-check on wallet change.
    useEffect(() => {
        const cur = account?.address?.toLowerCase() ?? null
        if (lastCheckedWalletRef.current === cur) return
        lastCheckedWalletRef.current = cur
        if (!cur) {
            // Disconnected — clear server cookie too.
            fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
            setSession({ authedWallet: null, loading: false, error: null })
            return
        }
        setSession({ loading: true })
        refresh()
    }, [account?.address, refresh, setSession])

    /**
     * Can the signature be asked for WITHOUT a click, right after the wallet connects?
     *
     * Yes when the wallet signs in this page: an injected wallet (a desktop extension, or the page
     * opened inside the wallet app's own browser) or thirdweb's in-app / smart wallet. No for
     * WalletConnect (the request travels to a phone app by deep link — a phone browser lets that
     * happen only inside a user gesture, so without one it is dropped silently) and for Coinbase's
     * SDK popup (a popup without a gesture is blocked). Mobile Safari without an injected wallet is
     * always one of those two. Client-only; false during the server render.
     */
    const canAutoSign = useCallback((): boolean => {
        if (typeof window === 'undefined' || !wallet) return false
        const id = String(wallet.id)
        if (id === 'walletConnect') return false
        if (SILENT_WALLETS.has(id)) return true
        try {
            return !!injectedProvider(wallet.id as Parameters<typeof injectedProvider>[0])
        } catch {
            return false
        }
    }, [wallet])

    /**
     * Ensure the current wallet has a valid session. Prompts a single signMessage
     * if needed. Concurrent calls are coalesced — only one signature prompt at a time.
     *
     * `{ auto: true }` — the call made by the page itself after the wallet connected, not by a
     * click: it does nothing (false, no error) unless canAutoSign(), and asks each wallet at most
     * once per page load. A click on SIGN IN calls it without options, as before.
     */
    const ensureLogin = useCallback(async (opts?: { auto?: boolean }): Promise<boolean> => {
        // `opts` may be a click event when the function is passed straight to onClick.
        const auto = !!(opts && typeof opts === 'object' && (opts as { auto?: unknown }).auto === true)
        const cur = account?.address
        if (!cur) {
            if (!auto) setSession({ error: 'Connect your wallet first' })
            return false
        }
        const lower = cur.toLowerCase()

        // Fast path — cookie already valid for this wallet.
        if (stateRef.current.authedWallet === lower) return true

        if (auto) {
            if (!canAutoSign() || autoTriedRef.current.has(lower)) return false
            autoTriedRef.current.add(lower)
            // No gesture to keep alive here: wait for the cookie check, so a returning player with a
            // valid session (30 days) is never asked to sign again.
            const fromCookie = stateRef.current.loading ? await refresh() : stateRef.current.authedWallet
            if (fromCookie === lower) return true
            if (lastCheckedWalletRef.current !== lower) return false
            if (signingRef.current) return false
        }

        /**
         * ДО ПОДПИСИ НЕ ДОЛЖНО БЫТЬ НИ ОДНОГО `await` С СЕТЬЮ.
         *
         * Владелец, 22.09: «на мобилке верификация — я нажимал, у меня так и не
         * открылось окно MetaMask». Причина не в кошельке. Мобильный кошелёк
         * открывается deep-link'ом, а его браузер пускает только внутри
         * пользовательского жеста. Здесь же перед `signMessage` стоял
         * безусловный `await refresh()` — поход на /api/auth/me. Пока он шёл
         * (~0.65 с тёплый, до 2 с холодный), контекст жеста истекал, и переход
         * в приложение кошелька блокировался МОЛЧА: ни ошибки, ни окна.
         *
         * Та же ловушка была в шеринге (systems/Share.ts): всё, что открывает
         * внешнее приложение или вкладку, обязано случиться синхронно после
         * нажатия.
         *
         * Поэтому проверка куки здесь осталась ровно для случая, когда её
         * состояние ещё НЕИЗВЕСТНО. В обычном сценарии оно уже известно:
         * эффект выше сходил на /api/auth/me сразу после подключения кошелька,
         * задолго до того, как человек дотянулся до кнопки. Цена отказа от
         * безусловной пере-проверки — лишний запрос подписи в редком случае,
         * когда куку выдали в другой вкладке; цена самой пере-проверки была
         * полностью неработающая мобилка.
         */
        if (stateRef.current.loading) {
            const fromCookie = await refresh()
            if (fromCookie === lower) return true
            if (lastCheckedWalletRef.current !== lower) return false   // wallet changed mid-flight
        }

        // If a sign prompt is in flight, wait for it instead of triggering another.
        if (signingRef.current) {
            for (let i = 0; i < 100; i++) {
                await new Promise(r => setTimeout(r, 200))
                if (!signingRef.current) break
            }
            return stateRef.current.authedWallet === lower
        }

        signingRef.current = true
        const attempt = ++attemptRef.current

        try {
            const nonce = genNonce()
            const message = `Glitch Games Login\nWallet: ${lower}\nNonce: ${nonce}`
            // Первое обращение к кошельку — и ничего сетевого перед ним.
            const signing = account.signMessage({ message })
            // Спиннер ставим ПОСЛЕ вызова: setState — это перерисовка React, а
            // она в некоторых браузерах успевает съесть жест до deep-link'а.
            setSession({ loading: true, error: null })
            const signature = await signing

            const res = await fetch('/api/auth/login', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet: cur, nonce, signature }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data?.ok) {
                setSession({ loading: false, error: data?.error || 'Login failed' })
                return false
            }
            setSession({ authedWallet: lower, loading: false, error: null })
            return true
        } catch (err: any) {
            // Given up on (cancelLogin) and maybe already retried: this late failure is not news.
            if (attemptRef.current !== attempt) return false
            const msg = err?.message?.toLowerCase().includes('reject')
                ? 'Signature rejected'
                : (err?.message || 'Login failed')
            setSession({ loading: false, error: msg })
            return false
        } finally {
            // A cancelled attempt has already released the lock; never release a newer one's.
            if (attemptRef.current === attempt) signingRef.current = false
        }
    }, [account, canAutoSign, refresh, setSession])

    /**
     * Give up on a signature prompt that never reached the wallet (phone: the wallet app opened
     * without the request). The pending promise is left to settle on its own — if the signature
     * does arrive later it still logs in — but the lock is released so a fresh tap asks again
     * at once instead of waiting 20 s behind the lost one.
     */
    const cancelLogin = useCallback(() => {
        attemptRef.current++
        signingRef.current = false
        setSession({ loading: false, error: null })
    }, [setSession])

    /** The error of the last attempt, read synchronously (state from a closure would be one render behind). */
    const lastError = useCallback(() => stateRef.current.error, [])

    /** Programmatic logout (clears server cookie too). */
    const logout = useCallback(async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
        } catch { /* ignore */ }
        setSession({ authedWallet: null, loading: false, error: null })
    }, [setSession])

    return {
        authedWallet: state.authedWallet,
        loading: state.loading,
        error: state.error,
        ensureLogin,
        canAutoSign,
        cancelLogin,
        lastError,
        refresh,
        logout,
    }
}
