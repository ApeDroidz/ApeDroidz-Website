"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { motion, AnimatePresence } from "framer-motion"
import Link from "next/link"
import { useActiveAccount } from "thirdweb/react"
import { useSearchParams } from "next/navigation"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { ProfileModal } from "@/components/profile-modal"
import { S2LeaderboardPanel } from "@/components/glitch_game/S2LeaderboardPanel"
import { QuestsPanel } from "@/components/glitch_game/QuestsPanel"
import { staggerContainer, fadeUp } from "@/lib/animations"
import { ArrowUpRight, Lock } from "lucide-react"
import { useGlitchSession } from "@/hooks/useGlitchSession"

// ── Sound helper ──────────────────────────────────────────────────────────────
function playSound(file: string, volume = 0.35) {
    const a = new Audio(file)
    a.volume = volume
    a.play().catch(() => {})
}

// ── Referral hook isolated in its own component to avoid SSR issues ───────────
function ReferralRegistrar({ wallet }: { wallet: string }) {
    const searchParams = useSearchParams()
    const { ensureLogin } = useGlitchSession()

    useEffect(() => {
        const refCode = searchParams.get('ref')
        if (!refCode) return
        const key = `ref_registered_${wallet}`
        if (sessionStorage.getItem(key)) return

        ;(async () => {
            // Referral registration now requires an authenticated invitee — the
            // server reads the wallet from the cookie, never from the body.
            const ok = await ensureLogin()
            if (!ok) return
            try {
                const res = await fetch('/api/glitch_games/referral', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ refCode }),
                })
                // Only mark this referral as registered if the server actually accepted it.
                if (res.ok) sessionStorage.setItem(key, '1')
            } catch { /* ignore */ }
        })()
    }, [wallet, searchParams, ensureLogin])

    return null
}

// ── Shared card bottom info overlay ─────────────────────────────────────────
function CardInfo({ title, subtitle, accentColor, white }: { title: string; subtitle: string; accentColor: string; white?: boolean }) {
    return (
        <>
            <div className="absolute inset-x-0 bottom-0 h-[40%] pointer-events-none"
                style={{ background: "linear-gradient(to top, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.7) 50%, transparent 100%)" }}
            />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 px-4 pb-4 pt-3">
                <div>
                    <h3 className="text-lg font-black text-white uppercase tracking-tight leading-none">{title}</h3>
                    <p className={`text-[10px] font-medium mt-1 ${white ? 'text-white/50' : 'text-white/40'}`}>{subtitle}</p>
                </div>
                <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center border transition-all duration-300 group-hover:scale-110 ${
                    white
                        ? 'border-white/30 bg-white/10 group-hover:bg-white/20'
                        : ''
                }`} style={white ? {} : { background: `${accentColor}20`, borderColor: `${accentColor}40` }}>
                    <ArrowUpRight className={`w-4 h-4 ${white ? 'text-white' : ''}`} style={white ? {} : { color: accentColor }} />
                </div>
            </div>
        </>
    )
}

// ── Glitch Flight card (video hover) ────────────────────────────────────────
const FLIGHT_SPEED_FAST = 1.68 * 1.7   // ≈ 2.856× — first half
const FLIGHT_SPEED_SLOW = 1.68          // normal — second half

function FlightCard({ title, subtitle, href }: { title: string; subtitle: string; href: string }) {
    const videoRef    = useRef<HTMLVideoElement>(null)
    const switchedRef = useRef(false)
    const [videoVisible, setVideoVisible] = useState(false)

    const handleTimeUpdate = () => {
        const v = videoRef.current
        if (!v || switchedRef.current || !v.duration) return
        if (v.currentTime >= v.duration / 2) {
            v.playbackRate = FLIGHT_SPEED_SLOW
            switchedRef.current = true
        }
    }

    const handleMouseEnter = () => {
        playSound('/sounds/fx/ui_hover.mp3', 0.3)
        const v = videoRef.current
        if (!v) return
        v.currentTime = 0
        v.playbackRate = FLIGHT_SPEED_FAST
        switchedRef.current = false
        setVideoVisible(true)
        v.play().catch(() => {})
    }

    const handleMouseLeave = () => {
        const v = videoRef.current
        if (!v) return
        v.pause()
        v.currentTime = 0
        setVideoVisible(false)
    }

    return (
        <Link
            href={href}
            className="group block h-full"
            onClick={() => playSound('/sounds/fx/crd_pick_sound.mp3', 0.5)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <motion.div
                variants={fadeUp}
                className="relative overflow-hidden rounded-2xl border border-white/10 hover:border-[#3b82f6] transition-colors duration-200 cursor-pointer h-full"
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
            >
                <img
                    src="/images/glitch-flight-banner.jpg"
                    alt="Glitch Flight"
                    className="absolute inset-0 w-full h-full object-cover object-center"
                />
                <video
                    ref={videoRef}
                    muted
                    playsInline
                    onEnded={() => setVideoVisible(false)}
                    onTimeUpdate={handleTimeUpdate}
                    className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
                    style={{ opacity: videoVisible ? 1 : 0 }}
                >
                    <source src="/flight/Meteor_crashes,_title_202604192149.mp4" type="video/mp4" />
                </video>
                <CardInfo title={title} subtitle={subtitle} accentColor="#f97316" white />
            </motion.div>
        </Link>
    )
}

// ── Glitch Cards card ────────────────────────────────────────────────────────
function CardsCard({ title, subtitle, href }: { title: string; subtitle: string; href: string }) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [videoVisible, setVideoVisible] = useState(false)

    const handleMouseEnter = () => {
        playSound('/sounds/fx/ui_hover.mp3', 0.3)
        const v = videoRef.current
        if (!v) return
        v.currentTime = 0
        v.playbackRate = 1.12
        setVideoVisible(true)
        v.play().catch(() => {})
    }

    const handleMouseLeave = () => {
        const v = videoRef.current
        if (!v) return
        v.pause()
        v.currentTime = 0
        setVideoVisible(false)
    }

    return (
        <Link
            href={href}
            className="group block h-full"
            onClick={() => playSound('/sounds/fx/crd_pick_sound.mp3', 0.5)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <motion.div
                variants={fadeUp}
                className="relative overflow-hidden rounded-2xl border border-white/10 hover:border-[#3b82f6] transition-colors duration-200 cursor-pointer h-full"
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
            >
                <img
                    src="/images/glitch-cards-banner.jpg"
                    alt="Glitch Cards"
                    className="absolute inset-0 w-full h-full object-cover object-center"
                />
                <video
                    ref={videoRef}
                    muted
                    playsInline
                    onEnded={() => setVideoVisible(false)}
                    className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
                    style={{ opacity: videoVisible ? 1 : 0 }}
                >
                    <source src="/flight/Droid_chooses_GLITCH_202604192248.mp4" type="video/mp4" />
                </video>
                <CardInfo title={title} subtitle={subtitle} accentColor="#0069FF" white />
            </motion.div>
        </Link>
    )
}

// ── Coming Soon card ─────────────────────────────────────────────────────────
function ComingSoonCard({ accentColor }: { accentColor: string }) {
    return (
        <motion.div
            variants={fadeUp}
            className="relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.015] flex flex-col h-full cursor-default"
        >
            <div
                className="absolute inset-0 opacity-[0.025]"
                style={{
                    backgroundImage: `linear-gradient(${accentColor}88 1px, transparent 1px), linear-gradient(90deg, ${accentColor}88 1px, transparent 1px)`,
                    backgroundSize: "32px 32px"
                }}
            />
            <div className="flex-1 flex items-center justify-center relative">
                <div className="flex flex-col items-center gap-3 pointer-events-none">
                    <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center border border-white/8"
                        style={{ background: `${accentColor}08` }}
                    >
                        <Lock className="w-6 h-6 text-white/15" />
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-[0.25em] px-3 py-1.5 rounded-full border border-dashed border-white/10 text-white/20">
                        Coming Soon
                    </span>
                </div>
            </div>
            <div className="relative px-4 pb-4 pt-3 border-t border-white/[0.04]">
                <div className="h-3 w-24 bg-white/5 rounded mb-1.5" />
                <div className="h-2 w-16 bg-white/[0.03] rounded" />
            </div>
        </motion.div>
    )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function GlitchGamesPage() {
    const account = useActiveAccount()

    const [isProfileOpen, setIsProfileOpen] = useState(false)
    const [profileInitialTab, setProfileInitialTab] = useState<"profile" | "leaderboard">("profile")

    const [s2Rank, setS2Rank] = useState<number | null>(null)
    const [tickets, setTickets] = useState<number | null>(null)
    const [flightApe, setFlightApe] = useState<number | null>(null)
    const [statsLoading, setStatsLoading] = useState(false)
    const [rightTab, setRightTab] = useState<'quests' | 'leaderboard'>('quests')
    const [lbRefreshKey, setLbRefreshKey] = useState(0)

    const fetchStats = useCallback(async (wallet: string) => {
        setStatsLoading(true)
        try {
            const [rankRes, dashRes, apeRes] = await Promise.all([
                fetch(`/api/leaderboard/season2?wallet=${encodeURIComponent(wallet)}&limit=1`, { cache: 'no-store' }),
                fetch(`/api/glitch_games/dashboard?wallet=${encodeURIComponent(wallet)}`, { cache: 'no-store' }),
                fetch(`/api/flight/balance?wallet=${encodeURIComponent(wallet)}`, { cache: 'no-store' }),
            ])
            if (rankRes.ok) {
                const d = await rankRes.json()
                setS2Rank(d.player?.rank ?? null)
            }
            if (dashRes.ok) {
                const d = await dashRes.json()
                setTickets(d.games_balance ?? null)
            }
            if (apeRes.ok) {
                const d = await apeRes.json()
                setFlightApe(d.balance ?? null)
            }
        } catch { /* silent */ } finally {
            setStatsLoading(false)
        }
    }, [])

    useEffect(() => {
        if (account?.address) fetchStats(account.address)
        else { setS2Rank(null); setTickets(null); setFlightApe(null) }
    }, [account?.address, fetchStats])

    return (
        <main className="relative h-[100dvh] w-full bg-black font-sans overflow-hidden text-white selection:bg-white/20">
            <div className="fixed inset-0 z-0 opacity-20 pointer-events-none mix-blend-lighten">
                <DigitalBackground />
            </div>

            <div className="relative z-10 h-full flex flex-col">
                <Header
                    onOpenProfile={() => { setProfileInitialTab("profile"); setIsProfileOpen(true) }}
                    onOpenLeaderboard={() => { setProfileInitialTab("leaderboard"); setIsProfileOpen(true) }}
                />

                <motion.div
                    className="flex-1 flex flex-col overflow-hidden pt-[72px] lg:pt-[80px]"
                    variants={staggerContainer}
                    initial="hidden"
                    animate="show"
                >
                    {/* ── Body ──────────────────────────────────────────────── */}
                    <div className="flex-1 flex flex-col overflow-hidden">

                        {/* Row 1: Title (left 70%) + Stats (right 30%) */}
                        <div className="flex-shrink-0 flex flex-col lg:flex-row lg:items-center px-5 sm:px-8 pt-4 lg:pr-5 gap-3 lg:gap-0">
                            <motion.h1
                                variants={fadeUp}
                                className="lg:w-[70%] flex-shrink-0 text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter text-white uppercase italic leading-none text-center"
                            >
                                <span className="drop-shadow-[0_0_12px_rgba(255,255,255,0.35)]">Glitch Games</span>{' '}
                                <span className="text-[#3b82f6]">Season 2</span>
                            </motion.h1>

                            {/* Stats — inline with title on desktop.
                                Order: Tickets → APE Flight → S2 Rank (with mini
                                "leaderboard" link to ProfileModal, mirroring
                                the Cards/Flight in-game UIs). */}
                            <div className="lg:flex-1 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center lg:pl-6">
                                {/* 1. Tickets */}
                                <div className="flex flex-col gap-1">
                                    {statsLoading ? (
                                        <div className="h-[22px] w-8 bg-white/10 rounded animate-pulse mb-1" />
                                    ) : (
                                        <span className="font-mono text-[20px] font-extrabold text-white leading-none tracking-tight">
                                            {tickets != null ? tickets : '--'}
                                        </span>
                                    )}
                                    <div className="flex items-center gap-1.5 leading-none">
                                        <span className="text-[9px] font-bold tracking-widest text-white/40 uppercase leading-none">Tickets</span>
                                        <Link href="/glitch_games/cards" className="text-[8px] text-white/30 hover:text-white uppercase font-bold tracking-widest transition-colors underline decoration-white/30 hover:decoration-white underline-offset-2">
                                            Get
                                        </Link>
                                    </div>
                                </div>

                                <div className="w-px h-8 bg-white/10 mx-3" />

                                {/* 2. APE Flight */}
                                <div className="flex flex-col gap-1">
                                    {statsLoading ? (
                                        <div className="h-[22px] w-14 bg-white/10 rounded animate-pulse mb-1" />
                                    ) : (
                                        <span className="font-mono text-[20px] font-extrabold text-white leading-none tracking-tight">
                                            {flightApe != null ? flightApe.toFixed(flightApe % 1 === 0 ? 0 : 2) : '--'}
                                        </span>
                                    )}
                                    <div className="flex items-center gap-1.5 leading-none">
                                        <span className="text-[9px] font-bold tracking-widest text-white/40 uppercase leading-none">APE Flight</span>
                                        <Link href="/glitch_games/flight" className="text-[8px] text-white/30 hover:text-white uppercase font-bold tracking-widest transition-colors underline decoration-white/30 hover:decoration-white underline-offset-2">
                                            Add
                                        </Link>
                                    </div>
                                </div>

                                <div className="w-px h-8 bg-white/10 mx-3" />

                                {/* 3. S2 Rank — clickable opens ProfileModal on Leaderboard tab.
                                    Mirrors the small "leaderboard" link present in /glitch_games/cards
                                    and /glitch_games/flight game UIs. */}
                                <div className="flex flex-col gap-1">
                                    {statsLoading ? (
                                        <div className="h-[22px] w-10 bg-white/10 rounded animate-pulse mb-1" />
                                    ) : (
                                        <span className="font-mono text-[20px] font-extrabold text-white leading-none tracking-tight">
                                            {s2Rank != null ? `#${s2Rank}` : '--'}
                                        </span>
                                    )}
                                    <div className="flex items-center gap-1.5 leading-none">
                                        <span className="text-[9px] font-bold tracking-widest text-white/40 uppercase leading-none">S2 Rank</span>
                                        <button
                                            onClick={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true) }}
                                            className="text-[8px] text-white/30 hover:text-white uppercase font-bold tracking-widest transition-colors underline decoration-white/30 hover:decoration-white underline-offset-2"
                                        >
                                            Leaderboard
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Row 2: Games (left 70%) + Card (right 30%) — equal height */}
                        <div className="flex-1 flex flex-col lg:flex-row pt-5 pb-4 min-h-0">

                            {/* LEFT: Games grid */}
                            <div className="w-full lg:w-[70%] flex-shrink-0 flex flex-col px-5 sm:px-8 pb-0 min-h-0">
                                <motion.div
                                    className="grid grid-cols-2 grid-rows-2 gap-3 sm:gap-4 flex-1 min-h-0"
                                    variants={{
                                        hidden: {},
                                        show: { transition: { staggerChildren: 0.12, delayChildren: 0.2 } },
                                    }}
                                >
                                    <CardsCard
                                        title="Glitch Cards"
                                        subtitle="Reveal prizes, earn XP"
                                        href="/glitch_games/cards"
                                    />
                                    <FlightCard
                                        title="Glitch Flight"
                                        subtitle="Fly higher, earn XP"
                                        href="/glitch_games/flight"
                                    />
                                    <ComingSoonCard accentColor="#8b5cf6" />
                                    <ComingSoonCard accentColor="#10b981" />
                                </motion.div>
                            </div>

                            {/* RIGHT: Tabs card — same height as grid */}
                            <div className="w-full lg:flex-1 flex-shrink-0 flex flex-col overflow-hidden p-4 sm:p-5 lg:pl-0 lg:pt-0 lg:pr-5 lg:pb-0 min-h-0">

                            <div className="flex-1 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] min-h-0">

                                {/* Flat border-b tab bar */}
                                <div className="flex-shrink-0 flex border-b border-white/10">
                                    {(['quests', 'leaderboard'] as const).map(tab => (
                                        <button
                                            key={tab}
                                            onClick={() => setRightTab(tab)}
                                            className={`flex-1 py-2.5 flex items-center justify-center text-[10px] font-black uppercase tracking-widest transition-all ${
                                                rightTab === tab
                                                    ? 'bg-white/5 text-white shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.2)]'
                                                    : 'text-white/40 hover:text-white/60'
                                            }`}
                                        >
                                            {tab === 'quests' ? 'Quests' : 'Leaderboard'}
                                        </button>
                                    ))}
                                </div>

                                {/* Tab content */}
                                <AnimatePresence mode="wait">
                                    {rightTab === 'quests' ? (
                                        <motion.div
                                            key="quests"
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: 10 }}
                                            transition={{ duration: 0.15 }}
                                            className="flex-1 flex flex-col overflow-hidden min-h-0 px-5 pt-4 pb-4"
                                        >
                                            <QuestsPanel onQuestClaimed={() => { fetchStats(account?.address ?? ''); setLbRefreshKey(k => k + 1) }} />
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="leaderboard"
                                            initial={{ opacity: 0, x: 10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -10 }}
                                            transition={{ duration: 0.15 }}
                                            className="flex-1 flex flex-col overflow-hidden min-h-0 px-5 pt-5 pb-4"
                                        >
                                            <S2LeaderboardPanel
                                                wallet={account?.address}
                                                hidePlayerBanner
                                                refreshTrigger={lbRefreshKey}
                                                onRefresh={() => { if (account?.address) fetchStats(account.address); setLbRefreshKey(k => k + 1) }}
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                            </div>
                        </div>

                    </div>

                    </div>{/* /Body */}
                </motion.div>
            </div>

            {account?.address && (
                <Suspense fallback={null}>
                    <ReferralRegistrar wallet={account.address} />
                </Suspense>
            )}

            <ProfileModal
                isOpen={isProfileOpen}
                onClose={() => setIsProfileOpen(false)}
                initialTab={profileInitialTab}
            />

            <style jsx global>{`
                .scrollbar-none::-webkit-scrollbar { display: none; }
                .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
                .custom-scrollbar-panel::-webkit-scrollbar { width: 3px; }
                .custom-scrollbar-panel::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 4px; }
            `}</style>
        </main>
    )
}
