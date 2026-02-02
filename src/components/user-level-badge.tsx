"use client"

import { useUserProgress } from "@/hooks/useUserProgress"
import { useActiveAccount, useActiveWallet } from "thirdweb/react"
import { motion } from "framer-motion"
import { User } from "lucide-react"

export function UserLevelBadge({ onClick, className = "" }: { onClick: () => void, className?: string }) {
    const account = useActiveAccount()
    const wallet = useActiveWallet()
    const { level, progress, isLoading } = useUserProgress()

    // Приоритет: EVM адрес если есть, иначе основной аккаунт
    const displayAddress = account?.address || "0x00..00"
    const shortAddress = displayAddress.startsWith("0x") && displayAddress.length >= 10
        ? `${displayAddress.slice(0, 6)}..${displayAddress.slice(-2)}`
        : displayAddress

    if (isLoading) return (
        <div className={`flex items-center h-[48px] w-[200px] bg-black border border-white/15 rounded-xl px-2 gap-2.5 animate-pulse ${className}`}>
            {/* Avatar skeleton */}
            <div className="flex-shrink-0 w-8 h-8 bg-white/10 rounded-lg" />
            {/* Content skeleton */}
            <div className="flex-1 flex flex-col justify-center gap-1.5 pr-1">
                <div className="flex justify-between">
                    <div className="h-3 w-16 bg-white/10 rounded" />
                    <div className="h-3 w-10 bg-white/10 rounded" />
                </div>
                <div className="h-[3px] w-full bg-white/10 rounded-full" />
            </div>
        </div>
    )

    return (
        <button
            onClick={onClick}
            className={`flex items-center h-[48px] w-[200px] bg-black border border-white/15 rounded-xl px-2 gap-2.5 select-none hover:border-white/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 group shadow-2xl cursor-pointer ${className}`}
        >
            <div className="flex-shrink-0 w-8 h-8 bg-[#1a1a1a] border border-white/10 rounded-lg flex items-center justify-center group-hover:bg-[#222] transition-colors">
                <User size={16} className="text-[#3b82f6]" />
            </div>

            <div className="flex-1 flex flex-col justify-center gap-1.5 pr-1">
                <div className="flex justify-between items-baseline leading-none">
                    <span className="text-[13px] font-mono text-white/90 tracking-tight">
                        {shortAddress}
                    </span>
                    <motion.span
                        key={level}
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-[11px] font-bold text-[#3b82f6] uppercase tracking-tight"
                    >
                        LVL {level}
                    </motion.span>
                </div>

                <div className="w-full h-[3px] bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                        className="h-full bg-[#3b82f6] shadow-[0_0_10px_rgba(59,130,246,0.4)]"
                        initial={false}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.8, ease: "circOut" }}
                    />
                </div>
            </div>
        </button>
    )
}