"use client"

import React, { useEffect, useState, useMemo, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, User, LogOut, Loader2, Pencil, Check, ChevronLeft, Download, Copy, Zap } from "lucide-react"
import { useDisconnect, useActiveAccount, useActiveWallet } from "thirdweb/react"
import { useGlitchSession } from "@/hooks/useGlitchSession"
import { getContract } from "thirdweb/contract"
import { getOwnedNFTs } from "thirdweb/extensions/erc721"
import { client, apeChain } from "@/lib/thirdweb"
import { supabase } from "@/lib/supabase"
import { useUserProgress } from "@/hooks/useUserProgress"
import { resolveImageUrl } from "@/lib/utils"
import { toPng, toBlob } from "html-to-image"
import { AlertModal } from "@/components/alert-modal"

const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""

// ── Shared leaderboard atoms (mirrors S2LeaderboardPanel) ────────────────────

function RankBadge({ rank }: { rank: number }) {
    if (rank === 1) return <span className="font-black text-yellow-400 text-lg w-10 shrink-0">#{rank}</span>
    if (rank === 2) return <span className="font-black text-slate-300 text-lg w-10 shrink-0">#{rank}</span>
    if (rank === 3) return (
        <span className="font-black text-lg w-10 shrink-0"
            style={{ background: 'linear-gradient(135deg,#D9A051,#9F602D)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            #{rank}
        </span>
    )
    return <span className="font-black text-white/40 text-lg w-10 shrink-0">#{rank}</span>
}

function RankXp({ rank, value }: { rank: number; value: number }) {
    const cls = rank === 1 ? 'text-yellow-400'
        : rank === 2 ? 'text-slate-300'
            : rank === 3 ? '' : 'text-white/40'
    const style: React.CSSProperties | undefined = rank === 3
        ? { background: 'linear-gradient(135deg,#D9A051,#9F602D)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }
        : undefined
    return (
        <div className={`text-base font-black ${cls}`} style={style}>
            {new Intl.NumberFormat('en-US').format(value)}
        </div>
    )
}

export function ProfileModal({ isOpen, onClose, initialTab = 'profile' }: { isOpen: boolean; onClose: () => void; initialTab?: 'profile' | 'leaderboard' }) {
    const account = useActiveAccount()
    const wallet = useActiveWallet()
    const { disconnect } = useDisconnect()
    const { level, xp, rank, progress, stats, username: currentUsername, refetch } = useUserProgress()
    const { ensureLogin } = useGlitchSession()

    // Normalize wallet address
    const normalizedAddress = account?.address

    const [activeTab, setActiveTab] = useState<'profile' | 'leaderboard'>('profile')
    // Two leaderboards now: Season 2 (default) and Global (combined NFT+S1+S2 XP).
    // S1 was removed — most users have minimal data there.
    const [leaderboardSeason, setLeaderboardSeason] = useState<'s2' | 'global'>('s2')
    const [leaderboardGlobal, setLeaderboardGlobal] = useState<any[]>([])
    const [leaderboardS2, setLeaderboardS2] = useState<any[]>([])
    const [playerS2Rank, setPlayerS2Rank] = useState<number | null>(null)
    const [myGlobalRank, setMyGlobalRank] = useState<number | null>(null)
    const [loadingLeaderboardGlobal, setLoadingLeaderboardGlobal] = useState(false)
    const [loadingLeaderboardS2, setLoadingLeaderboardS2] = useState(false)
    const [isEditingName, setIsEditingName] = useState(false)
    const [newName, setNewName] = useState("")
    const [xHandle, setXHandle] = useState("")
    const [isEditingX, setIsEditingX] = useState(false)
    const [isLoadingX, setIsLoadingX] = useState(true)

    const [userPfpUrl, setUserPfpUrl] = useState<string | null>(null)
    const [isAvatarLoading, setIsAvatarLoading] = useState(false)
    const [isSelectingPfp, setIsSelectingPfp] = useState(false)
    const [ownedDroids, setOwnedDroids] = useState<any[]>([])
    const [loadingDroids, setLoadingDroids] = useState(false)

    const [showExpGuide, setShowExpGuide] = useState(false)
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

    const [toast, setToast] = useState({ isOpen: false, title: "", message: "", type: "success" as any })

    const profileRef = useRef<HTMLDivElement>(null)
    const wasOpenRef = useRef(false)
    const shortAddress = normalizedAddress ? `${normalizedAddress.slice(0, 6)}...${normalizedAddress.slice(-4)}` : ""

    const handleDisconnect = () => { if (wallet) { disconnect(wallet); onClose(); } }
    const myRank = useMemo(() => myGlobalRank ?? 0, [myGlobalRank])

    // Set active tab when modal opens (not on every render)
    useEffect(() => {
        if (isOpen && !wasOpenRef.current) {
            // Modal just opened - set initial tab and fetch data
            setActiveTab(initialTab)
            if (normalizedAddress) {
                fetchUserProfile()
                refetch()
            }
            fetchLeaderboardGlobal()
            fetchLeaderboardS2(normalizedAddress)
        }
        wasOpenRef.current = isOpen
    }, [isOpen]) // Only depend on isOpen, not initialTab

    // Update tab when initialTab prop changes while modal is already open
    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab)
        }
    }, [initialTab])

    const fetchUserProfile = async () => {
        setIsAvatarLoading(true)
        // Fetch standard profile
        const { data } = await supabase.from('users').select('username, PFP').ilike('wallet_address', normalizedAddress || "").maybeSingle()
        if (data) {
            setNewName(data.username || "")
            if (data.PFP) {
                try {
                    const res = await fetch(`/api/metadata/droidz/${data.PFP}`)
                    const meta = await res.json()
                    setUserPfpUrl(resolveImageUrl(meta.image))
                } catch (e) {
                    console.error(e)
                    setIsAvatarLoading(false)
                }
            } else { setIsAvatarLoading(false) }
        } else { setIsAvatarLoading(false) }

        // Fetch Glitch Profile (X Handle)
        setIsLoadingX(true)
        const { data: glitchData } = await supabase.from('glitch_users').select('x_handle').ilike('wallet_address', normalizedAddress || "").maybeSingle()
        if (glitchData?.x_handle) {
            setXHandle(glitchData.x_handle)
        }
        setIsLoadingX(false)
    }

    const fetchLeaderboardS2 = async (walletAddr?: string) => {
        setLoadingLeaderboardS2(true)
        try {
            const url = walletAddr
                ? `/api/leaderboard/season2?limit=50&wallet=${walletAddr}`
                : '/api/leaderboard/season2?limit=50'
            const res = await fetch(url)
            const data = await res.json()
            setLeaderboardS2(data.leaderboard ?? [])
            if (data.player?.rank) setPlayerS2Rank(data.player.rank)
        } catch { setLeaderboardS2([]) }
        setLoadingLeaderboardS2(false)
    }

    const fetchLeaderboardGlobal = async () => {
        setLoadingLeaderboardGlobal(true)
        try {
            const url = normalizedAddress
                ? `/api/leaderboard/global?limit=50&wallet=${normalizedAddress}`
                : '/api/leaderboard/global?limit=50'
            const res = await fetch(url)
            const json = await res.json()
            const data = json.leaderboard ?? []
            data.forEach((u: any) => { u.xp = u.total_xp })
            setLeaderboardGlobal(data)
            if (json.player?.rank) setMyGlobalRank(json.player.rank)
        } catch {
            setLeaderboardGlobal([])
        }
        setLoadingLeaderboardGlobal(false)
    }

    const fetchDroidsForPfp = async () => {
        if (!account?.address) return
        setLoadingDroids(true)
        try {
            const contract = getContract({ client, chain: apeChain, address: DROID_CONTRACT_ADDRESS })
            const nfts = await getOwnedNFTs({ contract, owner: account.address })
            const loaded = await Promise.all(nfts.map(async (nft) => {
                const res = await fetch(`/api/metadata/droidz/${nft.id}`)
                const meta = await res.json()
                return { id: nft.id.toString(), image: resolveImageUrl(meta.image) }
            }))
            setOwnedDroids(loaded)
        } catch (e) { console.error(e) }
        setLoadingDroids(false)
    }

    const selectPfp = async (tokenId: string, url: string) => {
        setIsAvatarLoading(true)
        const idInt = parseInt(tokenId)
        await supabase.from('users').update({ PFP: idInt }).ilike('wallet_address', normalizedAddress || "")
        setUserPfpUrl(url)
        setIsSelectingPfp(false)
    }

    const handleDownloadImg = async () => {
        if (!profileRef.current) return
        const dataUrl = await toPng(profileRef.current, {
            cacheBust: true,
            backgroundColor: '#0a0a0a',
            style: { borderRadius: '32px' }
        })
        const link = document.createElement('a')
        link.download = `apedroidz-profile.png`
        link.href = dataUrl
        link.click()
    }

    const handleCopyImg = async () => {
        if (!profileRef.current) return
        const blob = await toBlob(profileRef.current, {
            backgroundColor: '#0a0a0a',
            style: { borderRadius: '32px' }
        })
        if (blob) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            setToast({ isOpen: true, title: "Copied!", message: "Profile image saved to clipboard.", type: "success" })
        }
    }

    const saveUsername = async () => {
        await supabase.from('users').update({ username: newName }).ilike('wallet_address', normalizedAddress || "")
        setIsEditingName(false); refetch();
    }

    const saveXHandle = async () => {
        let clean = xHandle.trim()
        if (!clean) return setIsEditingX(false)
        if (!clean.startsWith('@')) clean = '@' + clean

        const ok = await ensureLogin()
        if (!ok) {
            setToast({ isOpen: true, title: "Sign in required", message: "Please sign the login message.", type: "error" })
            return
        }

        // Cookie-authenticated. Wallet comes from session, not body.
        try {
            const res = await fetch('/api/user/update-x', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ xHandle: clean })
            })
            const data = await res.json()

            if (res.ok) {
                setXHandle(clean)
                setIsEditingX(false)
                setToast({ isOpen: true, title: "Saved", message: "X Handle updated!", type: "success" })
                // Trigger refetch of parent data if needed? ProfileModal usually fetches its own data or relies on props. 
                // It seems ProfileModal uses `account` prop and minimal local state? 
                // But we should probably invalidate queries if we used React Query. 
                // Here we just update local state `setXHandle`.
            } else {
                throw new Error(data.error || "Failed to save")
            }
        } catch (e: any) {
            console.error(e)
            setToast({ isOpen: true, title: "Error", message: e.message || "Failed to save X Handle.", type: "error" })
        }
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        setMousePos({ x: e.clientX, y: e.clientY })
    }

    // Scroll Lock
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = 'auto'
        }
        return () => { document.body.style.overflow = 'auto' }
    }, [isOpen])

    if (!isOpen) return null

    // Shared rank color helper (gold/silver/bronze/gray)
    const rankColor = (rank: number): { cls?: string; style?: React.CSSProperties } => {
        if (rank === 1) return { cls: 'text-yellow-400' }
        if (rank === 2) return { cls: 'text-slate-300' }
        if (rank === 3) return { style: { background: 'linear-gradient(135deg,#D9A051,#9F602D)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' } }
        return { cls: 'text-white/40' }
    }

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-0 sm:px-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} className="absolute inset-0 bg-black/95 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, y: 0, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} onClick={(e) => e.stopPropagation()} className="relative w-full h-full sm:h-auto sm:w-full sm:max-w-[720px] bg-[#0a0a0a] border-0 sm:border border-white/10 rounded-none sm:rounded-[40px] overflow-hidden flex flex-col sm:max-h-[90vh] shadow-2xl">

                {/* HEADER TABS - blue-600 */}
                <div className="p-4 sm:p-6 border-b border-white/5 flex items-center justify-between shrink-0 no-capture">
                    <div className="flex bg-white/5 p-1 rounded-xl sm:rounded-2xl">
                        <button onClick={() => setActiveTab('profile')} className={`cursor-pointer px-4 sm:px-6 py-2 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'profile' ? 'bg-[#3b82f6] text-white shadow-lg shadow-blue-500/20' : 'text-white/40'}`}>Profile</button>
                        <button onClick={() => setActiveTab('leaderboard')} className={`cursor-pointer px-4 sm:px-6 py-2 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'leaderboard' ? 'bg-[#3b82f6] text-white shadow-lg shadow-blue-500/20' : 'text-white/40'}`}>Leaderboard</button>
                    </div>
                    <button onClick={onClose} className="cursor-pointer w-11 h-11 sm:w-10 sm:h-10 flex items-center justify-center rounded-full bg-white/5 text-[#666666] hover:text-white hover:bg-white/10 transition-all"><X size={22} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 scrollbar-hide">
                    <AnimatePresence mode="wait">
                        {isSelectingPfp ? (
                            <motion.div key="pfp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4 no-capture">
                                <button onClick={() => setIsSelectingPfp(false)} className="cursor-pointer flex items-center gap-2 text-white/40 text-[10px] uppercase font-bold"><ChevronLeft size={14} /> Back</button>
                                <div className="grid grid-cols-4 gap-4">
                                    {loadingDroids ? Array.from({ length: 8 }).map((_, i) => (<div key={i} className="aspect-square rounded-[24px] bg-white/5 animate-pulse border border-white/10" />)) :
                                        ownedDroids.map((d, i) => (
                                            <button key={i} onClick={() => selectPfp(d.id, d.image)} className="cursor-pointer aspect-square rounded-[24px] overflow-hidden border-2 border-transparent hover:border-[#3b82f6] transition-all bg-white/5">
                                                <img src={d.image} className="w-full h-full object-cover" alt="" />
                                            </button>
                                        ))
                                    }
                                </div>
                            </motion.div>
                        ) : activeTab === 'profile' ? (
                            // ... existing profile code ...
                            <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
                                {!account?.address ? (
                                    <div className="flex flex-col items-center justify-center py-20 gap-6">
                                        <p className="text-white/40 font-mono text-sm uppercase tracking-widest">Wallet Disconnected</p>
                                        <button onClick={onClose} className="px-8 py-4 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:bg-[#3b82f6] hover:text-white transition-all">
                                            Close & Connect Wallet
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <>
                                            <div ref={profileRef} className="flex flex-col gap-4 bg-[#0a0a0a] p-2">

                                                {/* --- MOBILE LAYOUT (Flex) --- */}
                                                <div className="flex flex-col gap-4 sm:hidden">
                                                    {/* PFP Row */}
                                                    <div className="flex flex-row items-center gap-4 w-full">
                                                        {/* PFP */}
                                                        <div className="relative shrink-0 w-[100px] aspect-square rounded-[20px] border border-white/10 bg-white/5 overflow-hidden group">
                                                            {isAvatarLoading && <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10"><Loader2 className="w-6 h-6 text-[#3b82f6] animate-spin" /></div>}
                                                            {userPfpUrl ? (
                                                                <img src={userPfpUrl} className="w-full h-full object-cover" onLoad={() => setIsAvatarLoading(false)} onError={() => setIsAvatarLoading(false)} />
                                                            ) : <User size={40} className="m-auto text-white/10 h-full w-full p-8" />}
                                                            <button onClick={() => { setIsSelectingPfp(true); fetchDroidsForPfp() }} className="cursor-pointer absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all no-capture z-20"><Pencil size={20} className="text-white" /></button>
                                                        </div>

                                                        {/* Name Input/Display */}
                                                        <div className="flex-1 min-w-0">
                                                            {isEditingName ? (
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="bg-white/10 border border-white/20 rounded-lg px-3 py-1 text-white font-black text-lg uppercase tracking-tighter w-full focus:outline-none focus:border-[#3b82f6]" placeholder="ENTER NAME" onKeyDown={(e) => { if (e.key === 'Enter') saveUsername(); if (e.key === 'Escape') setIsEditingName(false) }} />
                                                                    <div className="flex gap-1">
                                                                        <button onClick={saveUsername} className="p-1.5 rounded bg-[#3b82f6] text-white hover:bg-blue-500 transition-colors"><Check size={14} /></button>
                                                                        <button onClick={() => setIsEditingName(false)} className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20 transition-colors"><X size={14} /></button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="flex flex-col">
                                                                    <div className="mb-1 flex items-center gap-2 min-h-[16px]">
                                                                        {isLoadingX ? (
                                                                            <div className="h-3 w-24 bg-white/10 animate-pulse rounded"></div>
                                                                        ) : isEditingX ? (
                                                                            <div className="flex items-center gap-1 w-full">
                                                                                <input type="text" value={xHandle} onChange={(e) => setXHandle(e.target.value)} className="bg-white/10 border border-white/20 rounded px-2 py-0.5 text-[10px] text-white font-bold w-full focus:outline-none focus:border-[#3b82f6]" placeholder="@username" onKeyDown={(e) => { if (e.key === 'Enter') saveXHandle(); }} />
                                                                                <button onClick={saveXHandle} className="p-1 rounded bg-[#3b82f6] text-white"><Check size={10} /></button>
                                                                            </div>
                                                                        ) : (
                                                                            <button onClick={() => setIsEditingX(true)} className="flex items-center gap-1 text-[10px] text-white/40 hover:text-white transition-colors cursor-pointer">
                                                                                <span className={xHandle ? "text-[#1DA1F2]" : ""}>{xHandle || "Link X Account"}</span>
                                                                                <Pencil size={10} className="opacity-50" />
                                                                            </button>
                                                                        )}
                                                                    </div>

                                                                    <div className="flex items-center gap-2">
                                                                        <h2 className="text-xl font-black text-white uppercase tracking-tighter leading-none truncate">{currentUsername || shortAddress}</h2>
                                                                        <button onClick={() => { setNewName(currentUsername || ""); setIsEditingName(true) }} className="no-capture cursor-pointer p-1 hover:bg-white/5 rounded-full transition-colors shrink-0"><Pencil size={12} className="text-white/20 hover:text-[#3b82f6]" /></button>
                                                                    </div>
                                                                    <p className="text-[9px] font-mono text-white/20 mt-1 uppercase tracking-[0.2em] leading-none truncate">{shortAddress}</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Progress Mobile */}
                                                    <div className="w-full bg-white/5 rounded-[20px] p-4 border border-white/5 relative cursor-help" onMouseEnter={() => setShowExpGuide(true)} onMouseLeave={() => setShowExpGuide(false)} onMouseMove={handleMouseMove}>
                                                        <div className="flex justify-between items-end mb-2">
                                                            <span className="text-sm font-black text-white uppercase tracking-tight leading-none">{rank}</span>
                                                            <span className="text-lg font-black text-[#3b82f6]">{new Intl.NumberFormat().format(xp)} XP</span>
                                                        </div>
                                                        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-2">
                                                            <div className="h-full bg-[#3b82f6] shadow-[0_0_15px_rgba(59,130,246,0.4)]" style={{ width: `${progress}%` }} />
                                                        </div>
                                                        <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
                                                            <span className="text-[#3b82f6] font-bold">LVL {level}</span>
                                                            <span className="text-white/20">LVL {level + 1}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* --- DESKTOP LAYOUT (Grid) --- */}
                                                <div className="hidden sm:grid grid-cols-3 gap-5 w-full">
                                                    {/* Row 1: PFP (Col 1) + Name/Progress (Col 2-3) */}

                                                    {/* PFP */}
                                                    <div className="col-span-1 flex flex-col justify-end">
                                                        <div className="relative w-full aspect-square rounded-[24px] lg:rounded-[32px] border border-white/10 bg-white/5 overflow-hidden group">
                                                            {isAvatarLoading && <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10"><Loader2 className="w-6 h-6 text-[#3b82f6] animate-spin" /></div>}
                                                            {userPfpUrl ? (
                                                                <img src={userPfpUrl} className="w-full h-full object-cover" onLoad={() => setIsAvatarLoading(false)} onError={() => setIsAvatarLoading(false)} />
                                                            ) : <User size={40} className="m-auto text-white/10 h-full w-full p-8" />}
                                                            <button onClick={() => { setIsSelectingPfp(true); fetchDroidsForPfp() }} className="cursor-pointer absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all no-capture z-20"><Pencil size={20} className="text-white" /></button>
                                                        </div>
                                                    </div>

                                                    {/* Info Column (Name + Progress) */}
                                                    <div className="col-span-2 flex flex-col justify-between h-full py-1">
                                                        {/* Name/Address */}
                                                        <div className="flex flex-col gap-1">
                                                            {/* X Handle (Desktop) - MOVED TO TOP */}
                                                            <div className="mb-0.5 pl-1 min-h-[24px] flex items-center">
                                                                {isLoadingX ? (
                                                                    <div className="h-4 w-28 bg-white/10 animate-pulse rounded ml-1"></div>
                                                                ) : isEditingX ? (
                                                                    <div className="flex items-center gap-2">
                                                                        <input type="text" value={xHandle} onChange={(e) => setXHandle(e.target.value)} className="bg-white/10 border border-white/20 rounded-lg px-3 py-1 text-white font-bold text-sm w-[200px] focus:outline-none focus:border-[#3b82f6]" placeholder="@username" onKeyDown={(e) => { if (e.key === 'Enter') saveXHandle(); }} />
                                                                        <button onClick={saveXHandle} className="p-1.5 rounded bg-[#3b82f6] text-white hover:bg-blue-500 transition-colors"><Check size={14} /></button>
                                                                        <button onClick={() => setIsEditingX(false)} className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20 transition-colors"><X size={14} /></button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-2">
                                                                        {/* X Icon */}
                                                                        <svg viewBox="0 0 24 24" className="w-3 h-3 text-white/40 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>

                                                                        <button onClick={() => setIsEditingX(true)} className="flex items-center gap-2 group/x cursor-pointer transition-all">
                                                                            <span className={`text-sm font-bold ${xHandle ? "text-white/40 group-hover/x:text-white" : "text-white/30 group-hover/x:text-white"}`}>
                                                                                {xHandle || "Link Account"}
                                                                            </span>
                                                                            <Pencil size={12} className="text-white/10 group-hover/x:text-white transition-colors" />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {isEditingName ? (
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="bg-white/10 border border-white/20 rounded-lg px-3 py-1 text-white font-black text-2xl uppercase tracking-tighter w-full max-w-[300px] focus:outline-none focus:border-[#3b82f6]" placeholder="ENTER NAME" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') saveUsername(); if (e.key === 'Escape') setIsEditingName(false) }} />
                                                                    <div className="flex gap-1">
                                                                        <button onClick={saveUsername} className="p-1.5 rounded bg-[#3b82f6] text-white hover:bg-blue-500 transition-colors"><Check size={14} /></button>
                                                                        <button onClick={() => setIsEditingName(false)} className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20 transition-colors"><X size={14} /></button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <div className="flex items-center flex-wrap gap-2 lg:gap-3">
                                                                        <h2 className="text-2xl lg:text-3xl font-black text-white uppercase tracking-tighter leading-none truncate">{currentUsername || shortAddress}</h2>
                                                                        <button onClick={() => { setNewName(currentUsername || ""); setIsEditingName(true) }} className="no-capture cursor-pointer p-1.5 hover:bg-white/5 rounded-full transition-colors shrink-0"><Pencil size={14} className="text-white/20 hover:text-[#3b82f6]" /></button>
                                                                        <span className="text-[11px] font-mono text-white/30 uppercase tracking-[0.2em] leading-none truncate ml-2">{shortAddress}</span>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>

                                                        {/* Desktop Progress */}
                                                        <div className="w-full bg-white/5 rounded-[20px] lg:rounded-[24px] p-4 lg:p-6 border border-white/5 relative cursor-help" onMouseEnter={() => setShowExpGuide(true)} onMouseLeave={() => setShowExpGuide(false)} onMouseMove={handleMouseMove}>
                                                            <div className="flex justify-between items-end mb-2">
                                                                <span className="text-lg font-black text-white uppercase tracking-tight leading-none">{rank}</span>
                                                                <span className="text-xl font-black text-[#3b82f6]">{new Intl.NumberFormat().format(xp)} XP</span>
                                                            </div>
                                                            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-2">
                                                                <div className="h-full bg-[#3b82f6] shadow-[0_0_15px_rgba(59,130,246,0.4)]" style={{ width: `${progress}%` }} />
                                                            </div>
                                                            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                                                                <span className="text-[#3b82f6] font-bold">LVL {level}</span>
                                                                <span className="text-white/20">LVL {level + 1}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Shared Stats Grid (Row 2 on Desktop, Row 3 on Mobile effectively) */}
                                                <div className="grid grid-cols-3 gap-2 sm:gap-4 w-full">
                                                    {[{ l: 'Droids', v: stats.droids }, { l: 'Batteries', v: stats.batteries }, { l: 'Global Rank', v: myRank > 0 ? `#${myRank}` : '--' }].map((s, i) => (
                                                        <div key={i} className="bg-white/5 rounded-[20px] sm:rounded-[32px] p-4 sm:p-6 border border-white/5 flex flex-col items-center justify-center text-center">
                                                            <span className="text-xl sm:text-3xl font-black text-white mb-1 leading-none">{s.v}</span>
                                                            <span className="text-[8px] sm:text-[10px] uppercase text-white/30 font-black tracking-widest">{s.l}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="w-full flex flex-col gap-2 lg:gap-3 mt-2 no-capture">
                                                <div className="grid grid-cols-2 gap-2 lg:gap-3">
                                                    <button onClick={handleCopyImg} className="cursor-pointer flex items-center justify-center gap-2 py-3 lg:py-4 bg-white text-black font-black uppercase tracking-[0.15em] rounded-[20px] lg:rounded-[24px] hover:bg-[#3b82f6] hover:text-white transition-all text-[10px] sm:text-xs shadow-xl"><Copy size={16} /> Copy IMG</button>
                                                    <button onClick={handleDownloadImg} className="cursor-pointer flex items-center justify-center gap-2 py-3 lg:py-4 bg-white/5 text-white/50 border border-white/10 font-black uppercase tracking-[0.15em] rounded-[20px] lg:rounded-[24px] hover:bg-white/10 hover:text-white transition-all text-[10px] sm:text-xs"><Download size={16} /> Download</button>
                                                </div>
                                                <button onClick={handleDisconnect} className="cursor-pointer flex items-center justify-center gap-2 text-red-500/40 hover:text-red-500 transition-all text-[10px] sm:text-[11px] font-black uppercase tracking-[0.3em] mt-2 lg:mt-3"><LogOut size={14} /> Disconnect Wallet</button>
                                            </div>
                                        </>
                                    </>
                                )}
                            </motion.div>
                        ) : (
                            /* LEADERBOARD — unified compact S2-style design, 2 tabs only */
                            <motion.div key="leaderboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-3">

                                {/* Tab switcher — Season 2 first (default), Global second */}
                                <div className="flex bg-white/5 p-1 rounded-2xl self-start mb-1">
                                    <button
                                        onClick={() => setLeaderboardSeason('s2')}
                                        className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${leaderboardSeason === 's2' ? 'bg-[#3b82f6] text-white shadow-lg shadow-blue-500/20' : 'text-white/40 hover:text-white/60'}`}
                                    >
                                        Season 2
                                    </button>
                                    <button
                                        onClick={() => setLeaderboardSeason('global')}
                                        className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${leaderboardSeason === 'global' ? 'bg-white text-black shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                                    >
                                        Global
                                    </button>
                                </div>

                                <AnimatePresence mode="wait">
                                    {leaderboardSeason === 's2' ? (
                                        <motion.div key="s2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
                                            {/* Player's own rank banner */}
                                            {normalizedAddress && playerS2Rank && (
                                                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10">
                                                    <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">Your Position</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-black text-[#3b82f6] text-sm">#{playerS2Rank}</span>
                                                        <span className="text-white/15 text-[9px]">·</span>
                                                        <span className="text-[9px] font-black text-white/30 uppercase tracking-widest">Cards + Flight</span>
                                                    </div>
                                                </div>
                                            )}
                                            {loadingLeaderboardS2 ? (
                                                Array.from({ length: 8 }).map((_, i) => (
                                                    <div key={i} className="flex items-center px-3 py-3 rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse">
                                                        <div className="w-10 h-5 bg-white/10 rounded mr-2 shrink-0" />
                                                        <div className="flex-1 flex flex-col gap-1.5">
                                                            <div className="h-4 w-28 bg-white/10 rounded" />
                                                            <div className="h-2.5 w-20 bg-white/5 rounded" />
                                                        </div>
                                                        <div className="h-5 w-14 bg-white/10 rounded" />
                                                    </div>
                                                ))
                                            ) : leaderboardS2.length === 0 ? (
                                                <div className="py-12 text-center text-white/20 text-xs font-mono">No data yet</div>
                                            ) : (
                                                leaderboardS2.map((user: any) => {
                                                    const isMe = user.wallet?.toLowerCase() === normalizedAddress?.toLowerCase()
                                                    const displayName = isMe
                                                        ? (currentUsername || `${user.wallet.slice(0, 6)}…${user.wallet.slice(-4)}`)
                                                        : (user.username || `${user.wallet.slice(0, 6)}…${user.wallet.slice(-4)}`)
                                                    return (
                                                        <div key={user.wallet} className={`flex items-center px-3 py-2.5 rounded-2xl border transition-all ${isMe ? 'bg-[#3b82f6]/10 border-[#3b82f6]/40 shadow-[0_0_16px_rgba(59,130,246,0.12)]' : 'bg-white/[0.025] border-transparent hover:border-white/10 hover:bg-white/[0.05]'}`}>
                                                            <RankBadge rank={user.rank} />
                                                            <div className="flex-1 min-w-0 pr-2">
                                                                <div className={`text-sm font-black uppercase tracking-tight flex items-center gap-1.5 min-w-0 ${isMe ? 'text-[#3b82f6]' : 'text-white'}`}>
                                                                    <span className="truncate">{isMe ? 'You' : displayName}</span>
                                                                    {user.x_handle && (
                                                                        <a href={`https://x.com/${user.x_handle.replace('@', '')}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0" title={user.x_handle}>
                                                                            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                                                                        </a>
                                                                    )}
                                                                </div>
                                                                <div className="text-[9px] text-white/30 uppercase font-black tracking-widest flex items-center gap-1.5 mt-0.5">
                                                                    <span>{user.games_played} cards</span>
                                                                    <span className="opacity-40">·</span>
                                                                    <span>{user.flights_played} flights</span>
                                                                    <span className="opacity-40">·</span>
                                                                    <span>{user.quests_finished ?? 0} quests</span>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <RankXp rank={user.rank} value={user.season_xp} />
                                                                <div className="text-[8px] font-black uppercase text-white/30 tracking-widest">XP</div>
                                                            </div>
                                                        </div>
                                                    )
                                                })
                                            )}
                                        </motion.div>
                                    ) : (
                                        <motion.div key="global" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
                                            {myGlobalRank && normalizedAddress && (
                                                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10">
                                                    <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">Your Position</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-black text-white/60 text-sm">#{myGlobalRank}</span>
                                                        <span className="text-white/15 text-[9px]">·</span>
                                                        <span className="text-[9px] font-black text-white/30 uppercase tracking-widest">NFT + S1 + S2</span>
                                                    </div>
                                                </div>
                                            )}
                                            {loadingLeaderboardGlobal ? (
                                                Array.from({ length: 8 }).map((_, i) => (
                                                    <div key={i} className="flex items-center px-3 py-3 rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse">
                                                        <div className="w-10 h-5 bg-white/10 rounded mr-2 shrink-0" />
                                                        <div className="flex-1 flex flex-col gap-1.5">
                                                            <div className="h-4 w-28 bg-white/10 rounded" />
                                                            <div className="h-2.5 w-24 bg-white/5 rounded" />
                                                        </div>
                                                        <div className="h-5 w-14 bg-white/10 rounded" />
                                                    </div>
                                                ))
                                            ) : leaderboardGlobal.length === 0 ? (
                                                <div className="py-12 text-center text-white/20 text-xs font-mono">No data yet</div>
                                            ) : (
                                                leaderboardGlobal.map((user, idx) => {
                                                    const rank = idx + 1
                                                    const isMe = user.wallet_address?.toLowerCase() === normalizedAddress?.toLowerCase()
                                                    const displayName = isMe
                                                        ? (currentUsername || `${user.wallet_address.slice(0, 6)}…${user.wallet_address.slice(-4)}`)
                                                        : (user.username || `${user.wallet_address.slice(0, 6)}…${user.wallet_address.slice(-4)}`)
                                                    return (
                                                        <div key={user.wallet_address} className={`flex items-center px-3 py-2.5 rounded-2xl border transition-all ${isMe ? 'bg-[#3b82f6]/10 border-[#3b82f6]/40 shadow-[0_0_16px_rgba(59,130,246,0.12)]' : 'bg-white/[0.025] border-transparent hover:border-white/10 hover:bg-white/[0.05]'}`}>
                                                            <RankBadge rank={rank} />
                                                            <div className="flex-1 min-w-0 pr-2">
                                                                <div className={`text-sm font-black uppercase tracking-tight flex items-center gap-1.5 min-w-0 ${isMe ? 'text-[#3b82f6]' : 'text-white'}`}>
                                                                    <span className="truncate">{isMe ? 'You' : displayName}</span>
                                                                    {user.x_handle && (
                                                                        <a href={`https://x.com/${user.x_handle.replace('@', '')}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0" title={user.x_handle}>
                                                                            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                                                                        </a>
                                                                    )}
                                                                </div>
                                                                <div className="text-[9px] text-white/30 uppercase font-black tracking-widest mt-0.5">
                                                                    <span>{user.rank_title || 'Baby Droid'}</span>
                                                                    <span className="opacity-40 mx-1.5">·</span>
                                                                    <span>LVL {user.level || 1}</span>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <RankXp rank={rank} value={user.total_xp ?? user.xp ?? 0} />
                                                                <div className="text-[8px] font-black uppercase text-white/30 tracking-widest">XP</div>
                                                            </div>
                                                        </div>
                                                    )
                                                })
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>

            {/* XP GUIDE TOOLTIP - Final Tokenomics */}
            <AnimatePresence>
                {showExpGuide && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        style={{ position: 'fixed', left: mousePos.x + 15, top: mousePos.y + 15, pointerEvents: 'none', zIndex: 300 }}
                        className="w-60 bg-black/90 backdrop-blur-xl border border-[#3b82f6]/30 p-4 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.8)]"
                    >
                        <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
                            <Zap size={14} className="text-[#3b82f6]" />
                            <span className="text-[10px] font-black uppercase text-white tracking-widest">XP Guide</span>
                        </div>
                        <div className="space-y-3 font-mono">
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="text-white/40 uppercase">Super Fusion</span>
                                <span className="font-black text-[#3b82f6]">+2,000</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="text-white/40 uppercase">Fusion (Lvl 2)</span>
                                <span className="font-black text-[#3b82f6]">+1,500</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="text-white/40 uppercase">Base Droid Hold</span>
                                <span className="font-black text-[#3b82f6]">+1,000</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] pt-1 border-t border-white/5">
                                <span className="text-white/40 uppercase">Super Battery</span>
                                <span className="font-black text-[#3b82f6]">+250</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="text-white/40 uppercase">Standard Battery</span>
                                <span className="font-black text-[#3b82f6]">+100</span>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AlertModal isOpen={toast.isOpen} title={toast.title} message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, isOpen: false })} autoClose={3000} />
        </div>
    )
}