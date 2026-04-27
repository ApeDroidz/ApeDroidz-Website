'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useActiveAccount } from 'thirdweb/react'

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
 */

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
    const [state, setState] = useState<SessionState>(INITIAL)

    // Ref mirrors state for synchronous reads inside callbacks.
    const stateRef = useRef<SessionState>(INITIAL)
    useEffect(() => { stateRef.current = state }, [state])

    // Prevent concurrent /me checks and signing prompts.
    const checkingRef = useRef(false)
    const signingRef = useRef(false)
    const lastCheckedWalletRef = useRef<string | null>(null)

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
     * Ensure the current wallet has a valid session. Prompts a single signMessage
     * if needed. Concurrent calls are coalesced — only one signature prompt at a time.
     */
    const ensureLogin = useCallback(async (): Promise<boolean> => {
        const cur = account?.address
        if (!cur) {
            setSession({ error: 'Connect your wallet first' })
            return false
        }
        const lower = cur.toLowerCase()

        // Fast path — cookie already valid for this wallet.
        if (stateRef.current.authedWallet === lower) return true

        // Re-check the cookie before prompting (it may have just been set in another tab).
        const fromCookie = await refresh()
        if (fromCookie === lower) return true
        if (lastCheckedWalletRef.current !== lower) return false   // wallet changed mid-flight

        // If a sign prompt is in flight, wait for it instead of triggering another.
        if (signingRef.current) {
            for (let i = 0; i < 100; i++) {
                await new Promise(r => setTimeout(r, 200))
                if (!signingRef.current) break
            }
            return stateRef.current.authedWallet === lower
        }

        signingRef.current = true
        setSession({ loading: true, error: null })

        try {
            const nonce = genNonce()
            const message = `Glitch Games Login\nWallet: ${lower}\nNonce: ${nonce}`
            const signature = await account.signMessage({ message })

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
            const msg = err?.message?.toLowerCase().includes('reject')
                ? 'Signature rejected'
                : (err?.message || 'Login failed')
            setSession({ loading: false, error: msg })
            return false
        } finally {
            signingRef.current = false
        }
    }, [account, refresh, setSession])

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
        refresh,
        logout,
    }
}
