'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lock, Loader2, X } from 'lucide-react'

const KEY_COMBO_HINT = '~ + l' // tilde then L to open admin

export default function ComingSoonPage() {
    const [showLogin, setShowLogin] = useState(false)
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [tildePressed, setTildePressed] = useState(false)

    const openLogin = useCallback(() => {
        setError(null)
        setShowLogin(true)
    }, [])

    // Two ways to open the admin login: secret button bottom-right OR `~` then `l`.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === '`' || e.key === '~') {
                setTildePressed(true)
                window.setTimeout(() => setTildePressed(false), 1500)
                return
            }
            if (tildePressed && (e.key === 'l' || e.key === 'L')) {
                openLogin()
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [tildePressed, openLogin])

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        if (loading) return
        setError(null)
        setLoading(true)
        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data?.ok) {
                setError(data?.error || 'Login failed')
                return
            }
            // Cookie is set — bounce to root. Hard navigation so middleware re-reads cookie.
            window.location.href = '/'
        } catch (err: any) {
            setError(err?.message || 'Login failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <main className="relative min-h-screen w-full bg-black overflow-hidden text-white font-sans">
            {/* ── Subtle animated grid background ─────────────────────────── */}
            <div
                className="fixed inset-0 z-0 opacity-[0.04] pointer-events-none"
                style={{
                    backgroundImage:
                        'linear-gradient(rgba(59,130,246,0.6) 1px, transparent 1px),' +
                        'linear-gradient(90deg, rgba(59,130,246,0.6) 1px, transparent 1px)',
                    backgroundSize: '64px 64px',
                }}
            />
            <div
                className="fixed inset-0 z-0 pointer-events-none"
                style={{
                    background:
                        'radial-gradient(ellipse at center, rgba(59,130,246,0.10) 0%, transparent 60%)',
                }}
            />

            {/* ── Centerpiece ─────────────────────────────────────────────── */}
            <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="flex flex-col items-center gap-6"
                >
                    <span className="text-[10px] sm:text-xs font-bold tracking-[0.5em] uppercase text-white/30">
                        ApeDroidz
                    </span>

                    <h1 className="text-5xl sm:text-7xl md:text-8xl font-black uppercase italic tracking-tighter leading-[0.9]">
                        <span className="drop-shadow-[0_0_30px_rgba(255,255,255,0.4)]">Season</span>{' '}
                        <span className="text-[#3b82f6] drop-shadow-[0_0_24px_rgba(59,130,246,0.6)]">2</span>
                    </h1>

                    <div className="flex items-center gap-3 mt-4">
                        <span className="block w-12 h-px bg-white/20" />
                        <span className="text-[10px] sm:text-xs font-black tracking-[0.5em] uppercase text-white/40">
                            Coming Soon
                        </span>
                        <span className="block w-12 h-px bg-white/20" />
                    </div>

                    <motion.div
                        animate={{ opacity: [0.3, 0.6, 0.3] }}
                        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                        className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/30 mt-6"
                    >
                        Initializing mainframe
                    </motion.div>
                </motion.div>
            </div>

            {/* ── Hidden admin trigger (bottom-right, near-invisible) ─────── */}
            <button
                onClick={openLogin}
                aria-label="Admin access"
                title={`Admin access (or press ${KEY_COMBO_HINT})`}
                className="fixed bottom-4 right-4 w-3 h-3 rounded-full bg-white/5 hover:bg-white/40 transition-colors z-20"
            />

            {/* ── Login modal ─────────────────────────────────────────────── */}
            <AnimatePresence>
                {showLogin && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-30 flex items-center justify-center bg-black/95 backdrop-blur-md px-4"
                        onClick={() => !loading && setShowLogin(false)}
                    >
                        <motion.form
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            onClick={(e) => e.stopPropagation()}
                            onSubmit={handleLogin}
                            className="relative w-full max-w-sm bg-[#080808] border border-white/10 rounded-2xl p-6 flex flex-col gap-4 shadow-2xl"
                        >
                            <button
                                type="button"
                                onClick={() => setShowLogin(false)}
                                className="absolute top-3 right-3 text-white/30 hover:text-white transition-colors"
                                aria-label="Close"
                            >
                                <X size={18} />
                            </button>

                            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-white/40">
                                <Lock size={12} /> Admin Access
                            </div>

                            <input
                                autoFocus
                                autoComplete="username"
                                name="username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="username"
                                disabled={loading}
                                className="bg-black/40 border border-white/10 rounded-xl px-3 h-10 text-sm text-white focus:outline-none focus:border-[#3b82f6] transition-colors placeholder:text-white/20 disabled:opacity-50"
                            />

                            <input
                                type="password"
                                autoComplete="current-password"
                                name="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="password"
                                disabled={loading}
                                className="bg-black/40 border border-white/10 rounded-xl px-3 h-10 text-sm text-white focus:outline-none focus:border-[#3b82f6] transition-colors placeholder:text-white/20 disabled:opacity-50"
                            />

                            <button
                                type="submit"
                                disabled={loading || !username || !password}
                                className="bg-[#3b82f6] hover:bg-[#2c63c4] disabled:bg-white/5 disabled:text-white/30 text-white rounded-xl h-10 text-xs font-black uppercase tracking-[0.2em] transition-colors flex items-center justify-center gap-2"
                            >
                                {loading ? <><Loader2 size={14} className="animate-spin" /> Signing in</> : 'Sign in'}
                            </button>

                            {error && (
                                <p className="text-xs text-red-400 text-center">{error}</p>
                            )}

                            <p className="text-[9px] text-white/20 text-center mt-1">
                                Session lasts 30 days on this device.
                            </p>
                        </motion.form>
                    </motion.div>
                )}
            </AnimatePresence>
        </main>
    )
}
