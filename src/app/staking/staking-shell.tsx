"use client"

import { ReactNode, useState } from "react"
import { motion } from "framer-motion"
import { Loader2 } from "lucide-react"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { ProfileModal } from "@/components/profile-modal"
import { GlitchText } from "@/components/glitch/glitch-text"

export type CollectionStats = {
    supply: number
    locked: number
    lockedPct: number
    wallets: number
    freemintsIssued: number
    breakdown: { lvl1: number; lvl2: number; lvl2super: number }
}

export type PersonalStats = {
    droidsLocked: number
    freemints: number
    remainderX100: number
    lockableLeft: number
}

/**
 * Collection numbers beside the title, captioned so it is obvious whose numbers these are.
 *
 * The progress bar is back but sized like punctuation rather than a panel — a 128px rule under the
 * figures it belongs to. The earlier version gave it a full card and it dominated a page that is
 * not about watching a bar fill.
 */
function CollectionLine({ collection }: { collection: CollectionStats | null }) {
    if (!collection) {
        return (
            <div className="flex items-center gap-2 lg:justify-end text-[10px] font-mono text-white/25">
                <Loader2 size={12} className="animate-spin text-white icon-dim-40" />
                Loading collection stats…
            </div>
        )
    }

    return (
        <div className="min-w-0">
            <div className="text-[8px] font-black uppercase tracking-[0.25em] text-white/30 mb-1">
                Collection
            </div>

            {/* Just the one thing worth watching: how much of the supply is gone for good. Wallet
                counts and issued freemints were noise beside it — and read as zeroes until the
                first lock lands, which said nothing at all. */}
            <div className="flex items-center gap-3 lg:justify-end">
                <div className="text-[10px] md:text-[11px] font-mono text-white/40 tabular-nums whitespace-nowrap">
                    <span className="text-white/75">{collection.locked}</span>
                    <span className="text-white/25">/{collection.supply}</span> locked
                </div>

                <div className="h-1 w-28 rounded-full bg-white/[0.08] overflow-hidden flex-shrink-0">
                    <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-[#3b82f6] to-yellow-300"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(Math.min(100, collection.lockedPct), collection.locked > 0 ? 1.5 : 0)}%` }}
                        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    />
                </div>

                <span className="text-[9px] font-mono text-white/35 tabular-nums flex-shrink-0">
                    {collection.lockedPct.toFixed(2)}%
                </span>
            </div>
        </div>
    )
}

/**
 * Your position, unframed.
 *
 * These were pill-shaped plates, which made them look like buttons someone should press. They are
 * readouts, so they get the treatment readouts get: a caption, a figure, and a hairline between
 * them — nothing that invites a click.
 */
function PersonalChips({ personal, connected }: { personal: PersonalStats; connected: boolean }) {
    if (!connected) {
        return (
            <span className="text-[10px] font-mono text-white/25 whitespace-nowrap">
                Connect wallet for your position
            </span>
        )
    }

    return (
        <div className="flex items-stretch divide-x divide-white/[0.08]">
            <div className="pr-5">
                <div className="text-[8px] font-black uppercase tracking-[0.25em] text-white/30 whitespace-nowrap">
                    Locked
                </div>
                <div className="mt-1 flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="text-xl font-black tabular-nums leading-none">{personal.droidsLocked}</span>
                    <span className="text-[10px] font-mono text-gray-400 leading-none">
                        / {personal.lockableLeft} left
                    </span>
                </div>
            </div>

            {/* "Freemints" on its own left people wondering whether these were owed, pending or
                already theirs. Naming the state removes the question. */}
            <div className="pl-5">
                <div className="text-[8px] font-black uppercase tracking-[0.25em] text-white/30 whitespace-nowrap">
                    Freemints Claimed
                </div>
                <div className="mt-1 flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="text-xl font-black tabular-nums leading-none text-yellow-300">
                        {personal.freemints}
                    </span>
                    {personal.remainderX100 > 0 && (
                        <span className="text-[10px] font-mono text-gray-400 leading-none tabular-nums">
                            +{(personal.remainderX100 / 100).toFixed(2)} toward next
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}

/**
 * Shared chrome for both staking tabs.
 *
 * The title carries the same weight and glitch treatment as every other page heading, and the
 * collection numbers ride on its line rather than claiming a band of their own — context reads
 * fastest when it sits beside the thing it describes.
 */
export function StakingShell({
    title,
    collection,
    personal,
    connected,
    children,
}: {
    title: string
    collection: CollectionStats | null
    personal: PersonalStats
    connected: boolean
    children: ReactNode
}) {
    const [isProfileOpen, setIsProfileOpen] = useState(false)
    const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')

    return (
        <main className="relative min-h-screen w-full bg-black font-sans overflow-y-auto lg:overflow-hidden lg:h-screen text-white selection:bg-white/20">
            <div className="fixed inset-0 z-0 opacity-40 pointer-events-none mix-blend-lighten"><DigitalBackground /></div>

            <div className="relative z-10 min-h-screen lg:h-full flex flex-col">
                <Header
                    onOpenProfile={() => { setProfileInitialTab('profile'); setIsProfileOpen(true) }}
                    onOpenLeaderboard={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true) }}
                />

                <motion.div
                    className="pt-24 pb-6 px-4 sm:px-6 flex-1 flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                    {/* Your numbers ride with the heading — they are the ones you act on — and the
                        collection's sit out on the right as context. Same size and glow as the
                        dashboard heading. */}
                    <div className="flex-shrink-0 mt-6 mb-5 md:mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="flex flex-col lg:flex-row lg:items-center gap-x-6 gap-y-3 min-w-0">
                            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] leading-none">
                                <GlitchText text={title} />
                            </h1>
                            <div className="hidden lg:block w-px h-9 bg-white/12 flex-shrink-0" />
                            <PersonalChips personal={personal} connected={connected} />
                        </div>

                        <div className="flex-shrink-0 lg:text-right">
                            <CollectionLine collection={collection} />
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 flex flex-col">{children}</div>
                </motion.div>
            </div>

            <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} initialTab={profileInitialTab} />
        </main>
    )
}
