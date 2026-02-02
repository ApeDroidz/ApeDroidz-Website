"use client"

import { useEffect, useState, useMemo, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, User, LogOut, Loader2, Pencil, Check, ChevronLeft, Download, Copy, Zap } from "lucide-react"
import { useDisconnect, useActiveAccount, useActiveWallet } from "thirdweb/react"
import { getContract } from "thirdweb/contract"
import { getOwnedNFTs } from "thirdweb/extensions/erc721"
import { client, apeChain } from "@/lib/thirdweb"
import { supabase } from "@/lib/supabase"
import { useUserProgress } from "@/hooks/useUserProgress"
import { resolveImageUrl } from "@/lib/utils"
import { toPng, toBlob } from "html-to-image"
import { AlertModal } from "@/components/alert-modal"

const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""

export function ProfileModal({ isOpen, onClose, initialTab = 'profile' }: { isOpen: boolean; onClose: () => void; initialTab?: 'profile' | 'leaderboard' }) {
    const account = useActiveAccount()
    const wallet = useActiveWallet()
    const { disconnect } = useDisconnect()
    const { level, xp, rank, progress, stats, username: currentUsername, refetch } = useUserProgress()

    const [activeTab, setActiveTab] = useState<'profile' | 'leaderboard'>('profile')
    const [leaderboard, setLeaderboard] = useState<any[]>([])
    const [loadingLeaderboard, setLoadingLeaderboard] = useState(false)
    const [isEditingName, setIsEditingName] = useState(false)
    const [newName, setNewName] = useState("")

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
    const shortAddress = account?.address ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}` : ""

    const handleDisconnect = () => { if (wallet) { disconnect(wallet); onClose(); } }
    const myRank = useMemo(() => leaderboard.findIndex(u => u.wallet_address === account?.address) + 1, [leaderboard, account?.address])

    // Set active tab when modal opens (not on every render)
    useEffect(() => {
        if (isOpen && !wasOpenRef.current) {
            // Modal just opened - set initial tab and fetch data
            setActiveTab(initialTab)
            if (account?.address) {
                fetchUserProfile()
                refetch()
            }
            fetchLeaderboard()
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
        const { data } = await supabase.from('users').select('username, PFP').eq('wallet_address', account?.address).single()
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
    }

    const fetchLeaderboard = async () => {
        setLoadingLeaderboard(true)
        const { data } = await supabase.from('users').select('*').order('xp', { ascending: false }).limit(50)
        if (data) setLeaderboard(data)
        setLoadingLeaderboard(false)
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
        await supabase.from('users').update({ PFP: idInt }).eq('wallet_address', account?.address)
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
        await supabase.from('users').update({ username: newName }).eq('wallet_address', account?.address)
        setIsEditingName(false); refetch();
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        setMousePos({ x: e.clientX, y: e.clientY })
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:px-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} className="absolute inset-0 bg-black/95 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, y: 100, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="relative w-full sm:max-w-[720px] bg-[#0a0a0a] border-t sm:border border-white/10 rounded-t-[32px] sm:rounded-[40px] overflow-hidden flex flex-col h-[90vh] sm:h-auto sm:max-h-[90vh] shadow-2xl">

                {/* HEADER TABS - blue-600 */}
                <div className="p-4 sm:p-6 border-b border-white/5 flex items-center justify-between shrink-0 no-capture">
                    <div className="flex bg-white/5 p-1 rounded-xl sm:rounded-2xl">
                        <button onClick={() => setActiveTab('profile')} className={`cursor-pointer px-4 sm:px-6 py-2 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'profile' ? 'bg-[#3b82f6] text-white shadow-lg shadow-blue-500/20' : 'text-white/40'}`}>Profile</button>
                        <button onClick={() => setActiveTab('leaderboard')} className={`cursor-pointer px-4 sm:px-6 py-2 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'leaderboard' ? 'bg-[#3b82f6] text-white shadow-lg shadow-blue-500/20' : 'text-white/40'}`}>Leaderboard</button>
                    </div>
                    <button onClick={onClose} className="cursor-pointer w-11 h-11 sm:w-10 sm:h-10 flex items-center justify-center rounded-full bg-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-all"><X size={22} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-10 scrollbar-hide">
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
                                        <div ref={profileRef} className="flex flex-col gap-4 bg-[#0a0a0a] p-2">
                                            {/* PFP + Name Row - horizontal on all screens */}
                                            <div className="flex flex-row items-start gap-4 w-full">
                                                {/* PFP - left aligned */}
                                                <div className="relative shrink-0 w-[100px] sm:w-[140px] aspect-square rounded-[20px] sm:rounded-[24px] border border-white/10 bg-white/5 overflow-hidden group">
                                                    {isAvatarLoading && <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10"><Loader2 className="w-6 h-6 text-[#3b82f6] animate-spin" /></div>}
                                                    {userPfpUrl ? (
                                                        <img
                                                            src={userPfpUrl}
                                                            className="w-full h-full object-cover"
                                                            onLoad={() => setIsAvatarLoading(false)}
                                                            onError={() => setIsAvatarLoading(false)}
                                                        />
                                                    ) : <User size={40} className="m-auto text-white/10 h-full w-full p-8" />}
                                                    <button onClick={() => { setIsSelectingPfp(true); fetchDroidsForPfp() }} className="cursor-pointer absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all no-capture z-20"><Pencil size={20} className="text-white" /></button>
                                                </div>

                                                {/* Name & Wallet - right of PFP */}
                                                <div className="flex-1 flex flex-col justify-center py-1 min-w-0">
                                                    {isEditingName ? (
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <input
                                                                type="text"
                                                                value={newName}
                                                                onChange={(e) => setNewName(e.target.value)}
                                                                className="bg-white/10 border border-white/20 rounded-lg px-3 py-1 text-white font-black text-lg uppercase tracking-tighter w-full sm:w-48 focus:outline-none focus:border-[#3b82f6]"
                                                                placeholder="ENTER NAME"
                                                                autoFocus
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') saveUsername()
                                                                    if (e.key === 'Escape') setIsEditingName(false)
                                                                }}
                                                            />
                                                            <div className="flex gap-1">
                                                                <button onClick={saveUsername} className="p-1.5 rounded bg-[#3b82f6] text-white hover:bg-blue-500 transition-colors"><Check size={14} /></button>
                                                                <button onClick={() => setIsEditingName(false)} className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20 transition-colors"><X size={14} /></button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div className="flex items-center gap-2">
                                                                <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tighter leading-none truncate">{currentUsername || shortAddress}</h2>
                                                                <button onClick={() => { setNewName(currentUsername || ""); setIsEditingName(true) }} className="no-capture cursor-pointer p-1 hover:bg-white/5 rounded-full transition-colors shrink-0"><Pencil size={12} className="text-white/20 hover:text-[#3b82f6]" /></button>
                                                            </div>
                                                            <p className="text-[9px] sm:text-[10px] font-mono text-white/20 mt-2 uppercase tracking-[0.2em] leading-none truncate">{shortAddress}</p>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            {/* PROGRESS BOX - Full Width */}
                                            <div
                                                onMouseEnter={() => setShowExpGuide(true)}
                                                onMouseLeave={() => setShowExpGuide(false)}
                                                onMouseMove={handleMouseMove}
                                                className="w-full bg-white/5 rounded-[20px] sm:rounded-[24px] p-4 sm:p-5 border border-white/5 relative cursor-help"
                                            >
                                                <div className="flex justify-between items-end mb-2">
                                                    <span className="text-sm sm:text-base font-black text-white uppercase tracking-tight leading-none">{rank}</span>
                                                    <span className="text-lg sm:text-xl font-black text-[#3b82f6]">{new Intl.NumberFormat().format(xp)} XP</span>
                                                </div>
                                                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-2">
                                                    <div className="h-full bg-[#3b82f6] shadow-[0_0_15px_rgba(59,130,246,0.4)]" style={{ width: `${progress}%` }} />
                                                </div>
                                                <div className="flex justify-between text-[9px] sm:text-[10px] font-black uppercase tracking-widest">
                                                    <span className="text-[#3b82f6] font-bold">LVL {level}</span>
                                                    <span className="text-white/20">LVL {level + 1}</span>
                                                </div>
                                            </div>

                                            {/* Stats Grid - centered text */}
                                            <div className="grid grid-cols-3 gap-2 sm:gap-4 w-full">
                                                {[{ l: 'Droids', v: stats.droids }, { l: 'Batteries', v: stats.batteries }, { l: 'Global Rank', v: myRank > 0 ? `#${myRank}` : '--' }].map((s, i) => (
                                                    <div key={i} className="bg-white/5 rounded-[20px] sm:rounded-[24px] p-4 sm:p-5 border border-white/5 flex flex-col items-center justify-center text-center">
                                                        <span className="text-xl sm:text-2xl font-black text-white mb-1 leading-none">{s.v}</span>
                                                        <span className="text-[8px] sm:text-[9px] uppercase text-white/30 font-black tracking-widest">{s.l}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="w-full flex flex-col gap-3 mt-2 no-capture">
                                            <div className="grid grid-cols-2 gap-3">
                                                <button onClick={handleCopyImg} className="cursor-pointer flex items-center justify-center gap-2 py-3 sm:py-4 bg-white text-black font-black uppercase tracking-[0.15em] rounded-xl hover:bg-[#3b82f6] hover:text-white transition-all text-[10px] sm:text-xs shadow-xl"><Copy size={14} /> Copy IMG</button>
                                                <button onClick={handleDownloadImg} className="cursor-pointer flex items-center justify-center gap-2 py-3 sm:py-4 bg-white/5 text-white/50 border border-white/10 font-black uppercase tracking-[0.15em] rounded-xl hover:bg-white/10 hover:text-white transition-all text-[10px] sm:text-xs"><Download size={14} /> Download</button>
                                            </div>
                                            <button onClick={handleDisconnect} className="cursor-pointer flex items-center justify-center gap-2 text-red-500/40 hover:text-red-500 transition-all text-[10px] sm:text-[11px] font-black uppercase tracking-[0.3em] mt-3"><LogOut size={14} /> Disconnect Wallet</button>
                                        </div>
                                    </>
                                )}
                            </motion.div>
                        ) : (
                            /* LEADERBOARD - blue-600 */
                            <motion.div key="leaderboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-3">
                                {loadingLeaderboard ? <Loader2 className="animate-spin text-[#3b82f6] mx-auto py-20" /> : (
                                    leaderboard.map((user, idx) => (
                                        <div key={user.wallet_address} className={`flex items-center p-5 rounded-[24px] border transition-all ${user.wallet_address === account?.address ? 'bg-[#3b82f6]/10 border-[#3b82f6]/40' : 'bg-white/5 border-transparent'}`}>
                                            <div className="w-12 font-black text-[#3b82f6] text-xl">#{idx + 1}</div>
                                            <div className="flex-1">
                                                <div className="text-base font-black text-white uppercase tracking-tight">{user.username || `${user.wallet_address.slice(0, 6)}...${user.wallet_address.slice(-4)}`}</div>
                                                <div className="text-[10px] text-white/30 uppercase font-black tracking-widest">{user.rank_title || "Baby Droid"} (LVL {user.level || 1})</div>
                                            </div>
                                            <div className="text-right text-xl font-black text-[#3b82f6]">{new Intl.NumberFormat('en-US').format(user.xp)}</div>
                                        </div>
                                    ))
                                )}
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
                                <span className="text-white/40 uppercase">Std Battery</span>
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