"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { Users, Copy, Check, Loader2, ChevronDown } from "lucide-react"
import { fadeUp } from "@/lib/animations"

interface InviteBlockProps {
    wallet: string | undefined
}

interface ReferralInfo {
    refCode: string
    refUrl: string
    totalReferrals: number
    activeReferrals: number
    ticketsEarned: number
}

export function InviteBlock({ wallet }: InviteBlockProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [info, setInfo] = useState<ReferralInfo | null>(null)
    const [copied, setCopied] = useState(false)

    const fetchInfo = useCallback(async () => {
        if (!wallet) return
        setIsLoading(true)
        try {
            const res = await fetch(`/api/glitch_games/referral?wallet=${wallet}`)
            if (res.ok) setInfo(await res.json())
        } catch { /* silent */ } finally {
            setIsLoading(false)
        }
    }, [wallet])

    useEffect(() => {
        if (isOpen && !info && wallet) fetchInfo()
    }, [isOpen, info, wallet, fetchInfo])

    const handleCopy = () => {
        if (!info?.refUrl) return
        navigator.clipboard.writeText(info.refUrl).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <motion.div variants={fadeUp} className="flex flex-col gap-3">
            <button
                onClick={() => setIsOpen(v => !v)}
                className="flex items-center justify-between cursor-pointer"
            >
                <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-white/50" />
                    <span className="text-xs font-black uppercase tracking-widest text-white/70">Invite & Earn</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-white/30 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex flex-col gap-3 overflow-hidden"
                >
                    {!wallet ? (
                        <p className="text-[10px] text-white/25 text-center py-2">Connect wallet to get your invite link</p>
                    ) : isLoading ? (
                        <div className="flex justify-center py-3">
                            <Loader2 className="w-4 h-4 animate-spin text-white/30" />
                        </div>
                    ) : info ? (
                        <>
                            {/* Ref link */}
                            <div className="flex items-stretch gap-2">
                                <div className="flex-1 h-9 px-3 rounded-xl bg-white/5 border border-white/10 flex items-center overflow-hidden">
                                    <span className="text-[10px] font-mono text-white/50 truncate">{info.refUrl}</span>
                                </div>
                                <button
                                    onClick={handleCopy}
                                    className="px-3 h-9 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white/60 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer"
                                >
                                    {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    <span className="text-[9px] font-black uppercase tracking-wider">{copied ? "Copied" : "Copy"}</span>
                                </button>
                            </div>

                            {/* Stats */}
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { label: "Invited", value: info.totalReferrals },
                                    { label: "Active", value: info.activeReferrals },
                                    { label: "Tickets", value: info.ticketsEarned },
                                ].map(stat => (
                                    <div key={stat.label} className="flex flex-col gap-0.5 rounded-xl bg-white/[0.02] border border-white/5 px-2.5 py-2">
                                        <span className="text-lg font-black text-white leading-none">{stat.value}</span>
                                        <span className="text-[8px] font-bold text-white/30 uppercase tracking-widest">{stat.label}</span>
                                    </div>
                                ))}
                            </div>

                            {/* How it works */}
                            <div className="px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                                <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest mb-1.5">Rewards</p>
                                <div className="flex flex-col gap-1">
                                    <p className="text-[9px] text-white/40">+200 S2 XP when friend plays 1 Flight + 2 Cards</p>
                                    <p className="text-[9px] text-white/40">+1 Ticket (holders) when friend plays 15+ games</p>
                                </div>
                            </div>
                        </>
                    ) : (
                        <button
                            onClick={fetchInfo}
                            className="text-[10px] text-white/40 hover:text-white transition-colors font-bold underline underline-offset-2 text-center cursor-pointer"
                        >
                            Load invite link
                        </button>
                    )}
                </motion.div>
            )}
        </motion.div>
    )
}
