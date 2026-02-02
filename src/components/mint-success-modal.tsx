"use client"

import { motion, AnimatePresence } from "framer-motion"
import { X, Check } from "lucide-react"
import Link from "next/link"

interface MintSuccessModalProps {
    isOpen: boolean
    onClose: () => void
    mintedAmount: number
    xpEarned: number
    currentLevel: number
    currentProgress: number
    previousProgress: number
}

export function MintSuccessModal({
    isOpen,
    onClose,
    mintedAmount,
    xpEarned,
    currentLevel,
    currentProgress,
    previousProgress
}: MintSuccessModalProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center px-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/90 backdrop-blur-md"
                    />

                    {/* Modal Content */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="relative w-full max-w-sm bg-[#0a0a0a] border border-white/15 rounded-3xl p-8 flex flex-col gap-6 text-center shadow-[0_0_50px_rgba(0,0,0,0.8)]"
                    >
                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 text-white/30 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>

                        {/* Success Icon */}
                        <div className="flex justify-center">
                            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                                <Check size={32} className="text-green-500" />
                            </div>
                        </div>

                        {/* Title */}
                        <div>
                            <h2 className="text-2xl font-black text-white uppercase tracking-widest mb-2">
                                Mint Successful!
                            </h2>
                            <p className="text-white/50 text-sm">
                                You minted <span className="text-white font-bold">{mintedAmount}</span> {mintedAmount === 1 ? 'Battery' : 'Batteries'}
                            </p>
                        </div>

                        {/* XP Progress Section */}
                        <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-white/50 text-sm">XP Earned</span>
                                <span className="text-[#3b82f6] font-bold">+{xpEarned} XP</span>
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-white/50 text-xs uppercase tracking-widest">Level {currentLevel}</span>
                                    <span className="text-white/50 text-xs">{Math.round(currentProgress)}%</span>
                                </div>

                                {/* Progress Bar with Animation */}
                                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                                    <motion.div
                                        className="h-full bg-[#3b82f6] rounded-full"
                                        initial={{ width: `${previousProgress}%` }}
                                        animate={{ width: `${currentProgress}%` }}
                                        transition={{ duration: 1.5, ease: "easeOut", delay: 0.5 }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Close Button */}
                        <div className="flex flex-col gap-3 w-full">

                            <Link
                                href="/dashboard"
                                className="w-full h-10 flex items-center justify-center bg-white text-black font-black uppercase tracking-wider rounded-lg hover:bg-blue-600 hover:text-white transition-all text-sm shadow-lg"
                            >
                                Go to Dashboard
                            </Link>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}