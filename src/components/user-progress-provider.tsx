"use client"

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react"
import { useActiveAccount } from "thirdweb/react"
import { getContract } from "thirdweb/contract"
import { getOwnedNFTs } from "thirdweb/extensions/erc721"
import { client, apeChain } from "@/lib/thirdweb"
import { supabase } from "@/lib/supabase"

const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""
const BATTERY_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || ""

const LEVEL_MILESTONES = [0, 1000, 3000, 5000, 10000, 30000, 50000, 100000, 200000, 300000]

interface UserProgressState {
    xp: number
    level: number
    rank: string
    progress: number
    stats: { droids: number, batteries: number }
    username: string
    isLoading: boolean
}

interface UserProgressContextType extends UserProgressState {
    refetch: () => void
}

const UserProgressContext = createContext<UserProgressContextType | undefined>(undefined)

export const UserProgressProvider = ({ children }: { children: ReactNode }) => {
    const account = useActiveAccount()
    const address = account?.address || undefined
    const isFetching = useRef(false)

    const [state, setState] = useState<UserProgressState>({
        xp: 0,
        level: 1,
        rank: "Baby Droid",
        progress: 0,
        stats: { droids: 0, batteries: 0 },
        username: "",
        isLoading: true
    })

    const calculateStats = (xp: number) => {
        let level = 1
        for (let i = 0; i < LEVEL_MILESTONES.length; i++) {
            if (xp >= LEVEL_MILESTONES[i]) level = i + 1
            else break
        }
        const currentMilestone = LEVEL_MILESTONES[level - 1] || 0
        const nextMilestone = LEVEL_MILESTONES[level] || (xp * 1.5)
        const range = nextMilestone - currentMilestone
        const earned = xp - currentMilestone
        const progress = range > 0 ? Math.min((earned / range) * 100, 99.9) : 0

        let rank = "Baby Droid"
        if (xp >= 300000) rank = "IRON GOD"
        else if (xp >= 200000) rank = "Droidzilla"
        else if (xp >= 100000) rank = "BlackHole"
        else if (xp >= 50000) rank = "Droidz Glitch"
        else if (xp >= 30000) rank = "Droidz King"
        else if (xp >= 10000) rank = "Droidz Whale"
        else if (xp >= 5000) rank = "Droidz Legend"
        else if (xp >= 3000) rank = "Droidz Collector"
        else if (xp >= 1000) rank = "Droidz Holder"

        return { level, rank, progress }
    }

    const fetchProgress = useCallback(async (forceSync = false) => {
        if (!address || isFetching.current) return

        try {
            isFetching.current = true
            console.log(`📊 FetchProgress started for ${address.slice(0, 8)}... forceSync=${forceSync}`)

            // 1. Читаем БД (Истина для скорости)
            const { data: dbUser, error: dbError } = await supabase.from('users').select('*').ilike('wallet_address', address).maybeSingle()

            if (dbError && dbError.code !== 'PGRST116') { // PGRST116 = not found, which is OK
                console.error("❌ DB user fetch error:", dbError)
            }

            if (dbUser) {
                console.log(`👤 Found user in DB: XP=${dbUser.xp}, Level=${dbUser.level}`)
                const { level, rank, progress } = calculateStats(dbUser.xp)
                setState(prev => ({
                    ...prev,
                    xp: dbUser.xp,
                    level, rank, progress,
                    stats: { droids: dbUser.droids_count, batteries: dbUser.batteries_count },
                    username: dbUser.username || "",
                    isLoading: false
                }))
            } else {
                console.log("👤 No user found in DB - will sync from blockchain")
                // Set loading false even for new users to show UI
                setState(prev => ({ ...prev, isLoading: false }))
            }

            // 2. Синхронизация с Блокчейном (Фоновая проверка)
            // Запускаем ТОЛЬКО если это принудительный синк или данных нет
            if (!dbUser || forceSync) {
                console.log("🔗 Starting blockchain sync...")
                const droidsContract = getContract({ client, chain: apeChain, address: DROID_CONTRACT_ADDRESS })

                let ownedNfts = []
                try {
                    ownedNfts = await getOwnedNFTs({ contract: droidsContract, owner: address })
                    console.log(`🤖 Droids found: ${ownedNfts.length}`)
                } catch (err) {
                    console.warn("❌ Droids sync skipped (RPC error)", err)
                    isFetching.current = false
                    return
                }

                // Получаем детали из БД Droidz (Там лежат актуальные уровни)
                const tokenIds = ownedNfts.map(nft => nft.id.toString())
                const { data: droidStats } = await supabase
                    .from('droidz')
                    .select('token_id, level, is_super')
                    .in('token_id', tokenIds)

                let batteriesXP = 0
                let batteriesCount = 0
                if (BATTERY_CONTRACT_ADDRESS !== "") {
                    try {
                        const battContract = getContract({ client, chain: apeChain, address: BATTERY_CONTRACT_ADDRESS })
                        let batts = await getOwnedNFTs({ contract: battContract, owner: address })
                        console.log(`🔋 Batteries from blockchain: ${batts.length}`)

                        // FILTER BURNED BATTERIES (Fix for RPC Lag)
                        if (batts.length > 0) {
                            const battIds = batts.map(b => b.id.toString())
                            const { data: burnedData } = await supabase
                                .from('batteries')
                                .select('token_id')
                                .in('token_id', battIds)
                                .eq('is_burned', true)

                            if (burnedData && burnedData.length > 0) {
                                const burnedSet = new Set(burnedData.map(b => b.token_id.toString()))
                                batts = batts.filter(b => !burnedSet.has(b.id.toString()))
                                console.log(`🔋 After burn filter: ${batts.length}`)
                            }
                        }

                        batteriesCount = batts.length
                        batts.forEach(b => {
                            const name = b.metadata?.name?.toString() || ""
                            batteriesXP += name.includes("Super") ? 250 : 100
                        })
                        console.log(`🔋 Batteries XP: ${batteriesXP} (count: ${batteriesCount})`)
                    } catch (e) {
                        console.error("❌ Batteries fetch error:", e)
                    }
                } else {
                    console.log("⚠️ BATTERY_CONTRACT_ADDRESS not set - skipping battery fetch")
                }

                let totalXP = batteriesXP
                const droidsCount = ownedNfts.length

                tokenIds.forEach(id => {
                    const stats = droidStats?.find(d => d.token_id.toString() === id)
                    if (stats) {
                        // ПРИОРИТЕТ ДАННЫМ ИЗ ТАБЛИЦЫ DROIDZ
                        if (stats.is_super) totalXP += 2000
                        else if (stats.level === 2) totalXP += 1500
                        else totalXP += 1000
                    } else {
                        // FALLBACK: Check Metadata from Chain (if DB missing)
                        const nft = ownedNfts.find(n => n.id.toString() === id)
                        let fallbackXP = 1000

                        if (nft && nft.metadata) {
                            // @ts-ignore
                            const attrs = nft.metadata.attributes || nft.metadata.traits || []
                            let lvl = 1
                            let isSuper = false

                            if (Array.isArray(attrs)) {
                                const lvlAttr = attrs.find((a: any) =>
                                    a.trait_type === "Level" ||
                                    a.trait_type === "Rank Value" ||
                                    a.trait_type === "Upgrade Level"
                                )
                                if (lvlAttr) {
                                    const val = parseInt(String(lvlAttr.value).replace(/\D/g, ''))
                                    if (!isNaN(val)) lvl = val
                                }

                                // Check for Super in traits or name
                                isSuper = attrs.some((a: any) =>
                                    String(a.value).toLowerCase().includes("super")
                                )
                            }

                            if (nft.metadata.name?.toLowerCase().includes("super")) isSuper = true

                            if (isSuper) fallbackXP = 2000
                            else if (lvl >= 2) fallbackXP = 1500

                            console.warn(`⚠️ Droid #${id} missing in DB. Fallback to Chain Metadata. XP: ${fallbackXP}`)
                        }

                        totalXP += fallbackXP
                    }
                })

                // Calculate stats FIRST to compare with DB
                const { level, rank, progress } = calculateStats(totalXP)

                // Если данные отличаются (XP, Level или Rank) - обновляем User Table
                const dbLevel = dbUser?.level || 0
                const dbRank = dbUser?.rank_title || ""

                if (!dbUser || dbUser.xp !== totalXP || dbLevel !== level || dbRank !== rank) {
                    setState({
                        xp: totalXP,
                        level, rank, progress,
                        stats: { droids: droidsCount, batteries: batteriesCount },
                        username: dbUser?.username || "",
                        isLoading: false
                    })
                    const { error: upsertError } = await supabase.from('users').upsert({
                        wallet_address: address,
                        xp: totalXP,
                        droids_count: droidsCount,
                        batteries_count: batteriesCount,
                        level: level,
                        rank_title: rank,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'wallet_address' })

                    if (upsertError) {
                        console.error("❌ Failed to update User Progress in DB:", upsertError)
                    } else {
                        console.log(`✅ User Progress Saved: Level ${level}, XP ${totalXP}`)
                    }
                }
            }
        } catch (e) {
            console.error("Progress Error:", e)
        } finally {
            isFetching.current = false
        }
    }, [address])

    // Слушаем глобальное событие обновления (чтобы Хедер обновился, когда Машина закончила)
    useEffect(() => {
        if (!address) return; // Only fetch if connected

        fetchProgress()
        const handleGlobalUpdate = () => {
            console.log("🔄 Global Update Triggered (Context)")
            fetchProgress(true) // Force sync
        }
        window.addEventListener('user_progress_updated', handleGlobalUpdate)
        return () => window.removeEventListener('user_progress_updated', handleGlobalUpdate)
    }, [fetchProgress, address])

    // Функция ручного вызова
    const manualRefetch = () => {
        fetchProgress(true)
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('user_progress_updated'))
        }
    }

    return (
        <UserProgressContext.Provider value={{ ...state, refetch: manualRefetch }}>
            {children}
        </UserProgressContext.Provider>
    )
}

export const useUserProgressContext = () => {
    const context = useContext(UserProgressContext)
    if (context === undefined) {
        throw new Error("useUserProgressContext must be used within a UserProgressProvider")
    }
    return context
}