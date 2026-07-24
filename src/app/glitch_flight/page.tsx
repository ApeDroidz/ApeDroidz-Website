'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useActiveAccount } from 'thirdweb/react'
import { Header } from '@/components/header'
import { DigitalBackground } from '@/components/digital-background'
import { ProfileModal } from '@/components/profile-modal'
import {
    MultiplierOverlay,
    RoundHistoryPills,
    RunControlPanel,
    RoundResult,
} from '@/components/glitch_run/GameUI'
import { GameScene } from '@/components/glitch_run/GameScene'
import { FlightAudioToggles, isSfxMuted, sfxVolume } from '@/components/glitch_run/FlightAudioToggles'
import { staggerContainer } from '@/lib/animations'
import { useFlightSocket } from '@/hooks/useFlightSocket'

export default function GlitchFlightPage() {
    const account = useActiveAccount()
    const [isProfileOpen, setIsProfileOpen] = useState(false)
    const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')

    const [socket, actions] = useFlightSocket(
        account?.address,
        account ? (msg: string) => account.signMessage({ message: msg }) : undefined
    )

    // ── Bet amount (local UI state only) ────────────────────────────────────────
    const [betAmount, setBetAmount] = useState(10)
    const [queueBet, setQueueBet] = useState(false)
    const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0)

    // ── Season rank ─────────────────────────────────────────────────────────────
    const [seasonRank, setSeasonRank] = useState<number | null>(null)
    const [rankLoading, setRankLoading] = useState(true)

    const refreshSeasonRank = useCallback(async () => {
        if (!account?.address) return
        try {
            const res = await fetch(`/api/leaderboard/season2?wallet=${account.address}`)
            const d = await res.json()
            setSeasonRank(d.player?.rank ?? null)
        } catch { /* silent */ } finally {
            setRankLoading(false)
        }
    }, [account?.address])

    useEffect(() => {
        if (!account?.address) { setRankLoading(false); return }
        setRankLoading(true)
        refreshSeasonRank()
    }, [account?.address, refreshSeasonRank])

    // ── Round history — SSR-safe, localStorage-persisted ────────────────────────
    const genRandomCrash = () => {
        const r = Math.random()
        if (r < 0.25) return parseFloat((1.0 + Math.random() * 0.5).toFixed(2))
        if (r < 0.55) return parseFloat((1.5 + Math.random() * 1.5).toFixed(2))
        if (r < 0.80) return parseFloat((3 + Math.random() * 4).toFixed(2))
        return parseFloat((7 + Math.random() * 13).toFixed(2))
    }

    const [roundHistory, setRoundHistory] = useState<RoundResult[]>([])

    useEffect(() => {
        try {
            const saved = localStorage.getItem('gf_round_history')
            if (saved) setRoundHistory(JSON.parse(saved))
            else setRoundHistory(Array.from({ length: 20 }, () => ({ crashPoint: genRandomCrash(), userResult: null })))
        } catch {
            setRoundHistory(Array.from({ length: 20 }, () => ({ crashPoint: genRandomCrash(), userResult: null })))
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (roundHistory.length === 0) return
        try { localStorage.setItem('gf_round_history', JSON.stringify(roundHistory.slice(0, 20))) } catch { }
    }, [roundHistory])

    // ── React to socket events ──────────────────────────────────────────────────
    const prevPhaseRef = useRef(socket.phase)
    const prevRoundRef = useRef(socket.round)

    useEffect(() => {
        const prev = prevPhaseRef.current
        const cur = socket.phase

        // New round started (crashed → waiting transition) — push to history
        if (prev === 'crashed' && cur === 'waiting' && prevRoundRef.current !== socket.round) {
            // The crashPoint was set when phase became 'crashed'
        }

        // Phase transitioned to crashed — push pill
        if (prev === 'running' && cur === 'crashed' && socket.crashPoint != null) {
            const won = socket.cashedOutAt != null
            const lost = socket.hasBet && !won
            setRoundHistory(h => [{
                crashPoint: socket.crashPoint!,
                userResult: socket.hasBet ? (won ? 'won' : 'lost') : null,
            }, ...h.slice(0, 19)])
            // Refresh season rank + history after crash
            refreshSeasonRank()
            if (socket.hasBet) setHistoryRefreshTrigger(t => t + 1)
        }

        prevPhaseRef.current = cur
        prevRoundRef.current = socket.round
    }, [socket.phase, socket.crashPoint, socket.hasBet, socket.cashedOutAt]) // eslint-disable-line react-hooks/exhaustive-deps

    // Refresh season rank after cashout
    useEffect(() => {
        if (socket.cashedOutAt) {
            refreshSeasonRank()
            setHistoryRefreshTrigger(t => t + 1)
        }
    }, [socket.cashedOutAt]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Flight sounds ───────────────────────────────────────────────────────────
    const windAudioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        // Wind & boom honour the global SFX flags. Volume = base × user's
        // chosen multiplier; muted state skips entirely.
        if (socket.phase === 'running') {
            if (isSfxMuted()) return
            if (!windAudioRef.current) {
                windAudioRef.current = new Audio('/flight/f_sounds/zvuk%20vetra.mp3')
                windAudioRef.current.loop = true
            }
            windAudioRef.current.volume = 0.35 * sfxVolume()
            windAudioRef.current.currentTime = 0
            windAudioRef.current.play().catch(() => {})
        } else if (socket.phase === 'crashed') {
            windAudioRef.current?.pause()
            if (isSfxMuted()) return
            const boom = new Audio('/flight/f_sounds/boom.mp3')
            boom.volume = 0.6 * sfxVolume()
            boom.play().catch(() => {})
        }
    }, [socket.phase])

    useEffect(() => {
        return () => { windAudioRef.current?.pause() }
    }, [])

    // ── Queue bet: auto-bet next round ──────────────────────────────────────────
    const queueBetRef = useRef(false)
    const betAmountRef = useRef(betAmount)
    useEffect(() => { queueBetRef.current = queueBet }, [queueBet])
    useEffect(() => { betAmountRef.current = betAmount }, [betAmount])

    useEffect(() => {
        if (socket.phase !== 'waiting') return
        if (!queueBetRef.current) return
        if (socket.hasBet) return
        if (!account?.address) return
        const amt = betAmountRef.current
        if ((socket.balance ?? 0) < amt) return
        // Honour the dynamic bet bounds set by the server for THIS round.
        if (amt < socket.minBet || amt > socket.maxBet) return

        queueBetRef.current = false   // prevent double-fire, but keep UI state until confirmed
        actions.bet(amt)
    }, [socket.phase]) // eslint-disable-line react-hooks/exhaustive-deps

    // Clear queue indicator only after server confirms the bet (hasBet=true)
    // This prevents the brief window where queueBet=false + hasBet=false shows wrong UI
    useEffect(() => {
        if (socket.hasBet && queueBet) {
            setQueueBet(false)
        }
    }, [socket.hasBet, queueBet])

    // ── Handlers ─────────────────────────────────────────────────────────────────
    const handleBet = useCallback(() => {
        if (socket.phase !== 'waiting') return
        if (socket.hasBet) return
        // Respect both balance and the server-set bet bounds. The hook already
        // clamps the input via setBetAmount, but we re-check here so a stale
        // value can't slip through.
        if ((socket.balance ?? 0) < betAmount) return
        if (betAmount < socket.minBet || betAmount > socket.maxBet) return
        actions.bet(betAmount)
    }, [socket.phase, socket.hasBet, socket.balance, socket.minBet, socket.maxBet, betAmount, actions])

    const handleCashout = useCallback(() => {
        if (socket.phase !== 'running' || !socket.hasBet || socket.cashedOutAt != null) return
        actions.cashout()
    }, [socket.phase, socket.hasBet, socket.cashedOutAt, actions])

    // ── Render ────────────────────────────────────────────────────────────────────
    return (
        <main className="relative min-h-screen w-full bg-black font-sans overflow-y-auto text-white selection:bg-white/20">
            <div className="fixed inset-0 z-0 opacity-20 pointer-events-none mix-blend-lighten">
                <DigitalBackground />
            </div>

            <div className="relative z-10 min-h-screen flex flex-col">
                <Header
                    onOpenProfile={() => { setProfileInitialTab('profile'); setIsProfileOpen(true) }}
                    onOpenLeaderboard={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true) }}
                />

                <motion.div
                    className="pt-16 sm:pt-20 flex-1 flex flex-col lg:flex-row"
                    initial="hidden"
                    animate="show"
                    variants={staggerContainer}
                >
                    {/* ── Left: Game area ── */}
                    <div className="flex flex-col items-center w-full relative px-3 sm:px-6 pt-1 sm:pt-2 min-w-0 lg:flex-1">

                        <div className="w-full flex items-center mb-2 sm:mb-4">
                            {/* Back button */}
                            <Link
                                href="/glitch_games/cards"
                                className="flex items-center gap-1.5 text-white/30 hover:text-white/70 transition-colors text-[10px] font-black uppercase tracking-widest flex-shrink-0 mr-4"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
                                Back
                            </Link>
                            {/* Title */}
                            <div className="flex-1 flex flex-col items-center">
                                <motion.h1
                                    className="text-2xl sm:text-4xl md:text-5xl font-black tracking-tighter text-white text-center uppercase italic leading-none"
                                    initial={{ opacity: 0, y: -15 }}
                                    animate={{ opacity: 1, y: 0 }}
                                >
                                    <span className="drop-shadow-[0_0_12px_rgba(255,255,255,0.35)]">Glitch Flight</span>{' '}
                                    <span className="text-[#3b82f6]">Season 2</span>
                                </motion.h1>
                                <motion.p
                                    className="font-bold text-[8px] sm:text-[10px] text-white/40 tracking-[0.2em] sm:tracking-[0.5em] text-center uppercase mt-1"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.15 }}
                                >
                                    Fly higher. Cash out before the crash.
                                </motion.p>
                            </div>
                            <div className="flex-shrink-0 ml-4 w-[52px]" />
                        </div>

                        <motion.div
                            className="relative w-full rounded-xl sm:rounded-2xl overflow-hidden border border-white/10 bg-[#000308]
                                        h-[52vw] min-h-[200px] max-h-[340px]
                                        sm:h-[58vw] sm:min-h-[280px] sm:max-h-[420px]
                                        lg:flex-1 lg:h-auto lg:max-h-none lg:min-h-[420px]"
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.1 }}
                        >
                            <GameScene
                                crashed={socket.phase === 'crashed'}
                                multiplier={socket.multiplier}
                                elapsed={socket.elapsed / 1000}
                                phase={socket.phase}
                                countdown={socket.countdown}
                                cashedOut={socket.cashedOutAt != null}
                            />
                            {socket.phase !== 'waiting' && (
                                <MultiplierOverlay
                                    phase={socket.phase}
                                    multiplier={socket.multiplier}
                                    countdown={socket.countdown}
                                    crashPoint={socket.crashPoint ?? undefined}
                                    cashedOutAt={socket.cashedOutAt}
                                    lastXpGained={socket.lastXpGained}
                                />
                            )}
                            <FlightAudioToggles />
                        </motion.div>

                        <motion.div
                            className="w-full mt-2 sm:mt-3 flex items-center gap-2 sm:gap-3"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.2 }}
                        >
                            <span className="text-white/30 text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.2em] shrink-0">Last</span>
                            <RoundHistoryPills history={roundHistory} />
                        </motion.div>

                        {/* Connection indicator */}
                        {!socket.connected && (
                            <div className="mt-2 text-[10px] font-mono text-yellow-400/60 tracking-widest uppercase">
                                Connecting to game server…
                            </div>
                        )}

                        <div className="pb-2 lg:pb-8" />
                    </div>

                    {/* ── Right: Control panel ── */}
                    <RunControlPanel
                        phase={socket.phase}
                        multiplier={socket.multiplier}
                        betAmount={betAmount}
                        setBetAmount={setBetAmount}
                        balance={socket.balance}
                        balanceLoading={socket.balanceLoading}
                        onBalanceChange={(b) => { /* balance managed by socket */ }}
                        onRefreshBalance={actions.refreshBalance}
                        seasonRank={seasonRank}
                        rankLoading={rankLoading}
                        roundHistory={roundHistory}
                        onBet={handleBet}
                        onCashout={handleCashout}
                        hasBet={socket.hasBet}
                        cashedOutAt={socket.cashedOutAt ?? undefined}
                        crashPoint={socket.crashPoint ?? undefined}
                        lastXpGained={socket.lastXpGained}
                        queueBet={queueBet}
                        onQueueBet={setQueueBet}
                        historyRefreshTrigger={historyRefreshTrigger}
                        socketError={socket.error}
                        minBet={socket.minBet}
                        maxBet={socket.maxBet}
                    />
                </motion.div>
            </div>

            <ProfileModal
                isOpen={isProfileOpen}
                onClose={() => setIsProfileOpen(false)}
                initialTab={profileInitialTab}
            />
        </main>
    )
}
