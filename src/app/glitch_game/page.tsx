"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { useActiveAccount, useIsAutoConnecting } from "thirdweb/react"
import { getContract } from "thirdweb/contract"
import { balanceOf } from "thirdweb/extensions/erc721"
import { client, apeChain } from "@/lib/thirdweb"
import { Header } from "@/components/header"
import { DigitalBackground } from "@/components/digital-background"
import { ProfileModal } from "@/components/profile-modal"
import { GameBoard } from "@/components/glitch_game/GameBoard"
import { ControlPanel } from "@/components/glitch_game/ControlPanel"
import { useUserProgress } from "@/hooks/useUserProgress"
import { supabase } from "@/lib/supabase"
import { Loader2 } from "lucide-react"
import { staggerContainer } from "@/lib/animations"
import { SkeletonLoader } from "@/components/glitch_game/SkeletonLoader"

const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""

export default function GamesPage() {
    const account = useActiveAccount()
    const isAutoConnecting = useIsAutoConnecting()
    const { refetch: refetchProgress } = useUserProgress()

    const [isProfileOpen, setIsProfileOpen] = useState(false)
    const [profileInitialTab, setProfileInitialTab] = useState<"profile" | "leaderboard">("profile")

    // User state
    const [isLoading, setIsLoading] = useState(true)
    const [isFetchingState, setIsFetchingState] = useState(true)
    const [isHolder, setIsHolder] = useState(false)
    const [balance, setBalance] = useState(0)
    const [xHandle, setXHandle] = useState<string | null>(null)

    // Fetch user state
    const fetchState = useCallback(async () => {
        // Wait until wallet finishes checking cache
        if (isAutoConnecting) return;

        setIsFetchingState(true)

        if (!account?.address) {
            setBalance(0)
            setIsHolder(false)
            setXHandle(null)
            setIsLoading(false)
            setIsFetchingState(false)
            return
        }

        const wallet = account.address

        try {
            // Run Holder Check and Balance Check concurrently
            const holderPromise = (async () => {
                try {
                    const droidContract = getContract({ client, chain: apeChain, address: DROID_CONTRACT_ADDRESS })
                    const bal = await balanceOf({ contract: droidContract, owner: wallet })
                    return bal > BigInt(0)
                } catch {
                    const { data } = await supabase
                        .from("users")
                        .select("droids_count")
                        .eq("wallet_address", wallet)
                        .maybeSingle()
                    return (data?.droids_count ?? 0) > 0
                }
            })()

            const balancePromise = (async () => {
                const balRes = await fetch(`/api/glitch_game/balance?wallet=${encodeURIComponent(wallet)}`)
                if (balRes.ok) {
                    return await balRes.json()
                }
                return { games_balance: 0, x_handle: null }
            })()

            const [holderResult, balanceResult] = await Promise.allSettled([holderPromise, balancePromise])

            if (holderResult.status === 'fulfilled') {
                setIsHolder(holderResult.value)
            }
            if (balanceResult.status === 'fulfilled') {
                setBalance(balanceResult.value.games_balance ?? 0)
                setXHandle(balanceResult.value.x_handle ?? null)
            }

        } catch (err) {
            console.error("Games state error:", err)
        } finally {
            setIsLoading(false)
            setIsFetchingState(false)
        }
    }, [account?.address, isAutoConnecting])

    useEffect(() => { fetchState() }, [fetchState])

    const handleBalanceUpdate = (newBal: number) => {
        setBalance(newBal)
        if (refetchProgress) refetchProgress()
    }

    return (
        <main className="relative min-h-screen w-full bg-black font-sans overflow-y-auto text-white selection:bg-white/20">
            {/* Background */}
            <div className="fixed inset-0 z-0 opacity-20 pointer-events-none mix-blend-lighten">
                <DigitalBackground />
            </div>

            <div className="relative z-10 min-h-screen flex flex-col">
                <Header
                    onOpenProfile={() => { setProfileInitialTab("profile"); setIsProfileOpen(true) }}
                    onOpenLeaderboard={() => { setProfileInitialTab("leaderboard"); setIsProfileOpen(true) }}
                />

                {/* Loading */}
                {isLoading && (
                    <SkeletonLoader />
                )}

                {/* Main content */}
                {!isLoading && (
                    <motion.div
                        className="pt-20 flex-1 flex flex-col lg:flex-row"
                        initial="hidden"
                        animate="show"
                        variants={staggerContainer}
                    >
                        {/* Left: Game Board (70%) */}
                        <GameBoard
                            balance={balance}
                            wallet={account?.address}
                            onPlayComplete={handleBalanceUpdate}
                            onRefetch={fetchState}
                            isFetchingState={isFetchingState}
                        />

                        {/* Right: Control Panel (30%) */}
                        <ControlPanel
                            wallet={account?.address}
                            balance={balance}
                            isHolder={isHolder}
                            xHandle={xHandle}
                            onBalanceUpdate={handleBalanceUpdate}
                            isFetchingState={isFetchingState}
                            onRefetch={fetchState}
                        />
                    </motion.div>
                )}
            </div>

            <ProfileModal
                isOpen={isProfileOpen}
                onClose={() => setIsProfileOpen(false)}
                initialTab={profileInitialTab}
            />
        </main>
    )
}
