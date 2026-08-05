"use client"

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react"
import { useActiveAccount } from "thirdweb/react"
import { getContract } from "thirdweb/contract"
import { getOwnedNFTs } from "thirdweb/extensions/erc721"
import { client, apeChain } from "@/lib/thirdweb"
import { supabase } from "@/lib/supabase"

// Level can arrive as 'level' (current) or legacy 'Level'/'Rank Value'.
const LEVEL_TRAIT_KEYS = ['level', 'rank value', 'upgrade level']

const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""
const BATTERY_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || ""

const LEVEL_MILESTONES = [0, 1000, 3000, 5000, 10000, 30000, 50000, 100000, 200000, 300000]

interface UserProgressState {
    xp: number          // total display XP (NFT + S1 + S2)
    nftXp: number       // XP from NFTs only (blockchain-synced)
    s1Xp: number        // Season 1 gameplay XP
    s2Xp: number        // Season 2 gameplay XP
    s2Level: number     // in-season Level (1-10)
    s2RankTitle: string // in-season rank title
    level: number       // global ecosystem level
    rank: string        // global rank
    progress: number    // 0-100 progress to next global level
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
        nftXp: 0,
        s1Xp: 0,
        s2Xp: 0,
        s2Level: 1,
        s2RankTitle: "Rookie Pilot",
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

            // 1. Fetch DB user + Season XP in parallel
            const [userRes, s1Res, s2Res] = await Promise.all([
                supabase.from('users').select('*').ilike('wallet_address', address).maybeSingle(),
                supabase.from('glitch_season_1').select('season_xp').ilike('wallet_address', address).maybeSingle(),
                supabase.from('glitch_season_2').select('season_xp, s2_level, s2_rank_title').ilike('wallet_address', address).maybeSingle(),
            ])

            const dbUser = userRes.data
            const s1Xp = s1Res.data?.season_xp ?? 0
            const s2Xp = s2Res.data?.season_xp ?? 0
            const s2Level = s2Res.data?.s2_level ?? 1
            const s2RankTitle = s2Res.data?.s2_rank_title ?? 'Rookie Pilot'

            if (userRes.error && userRes.error.code !== 'PGRST116') {
                console.error("❌ DB user fetch error:", userRes.error)
            }

            if (dbUser) {
                // Total display XP = NFT XP (from DB) + Season 1 + Season 2
                const nftXp = dbUser.xp ?? 0
                const totalXp = nftXp + s1Xp + s2Xp
                console.log(`👤 Found user in DB: NFT XP=${nftXp}, S1=${s1Xp}, S2=${s2Xp}, Total=${totalXp}`)
                const { level, rank, progress } = calculateStats(totalXp)
                setState(prev => ({
                    ...prev,
                    xp: totalXp,
                    nftXp,
                    s1Xp,
                    s2Xp,
                    s2Level,
                    s2RankTitle,
                    level, rank, progress,
                    stats: { droids: dbUser.droids_count, batteries: dbUser.batteries_count },
                    username: dbUser.username || "",
                    isLoading: false
                }))
            } else {
                console.log("👤 No user found in DB - will sync from blockchain")
                setState(prev => ({ ...prev, s1Xp, s2Xp, s2Level, s2RankTitle, isLoading: false }))
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
                                    LEVEL_TRAIT_KEYS.includes(String(a.trait_type || '').toLowerCase())
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

                // totalXP here = NFT-only XP (from blockchain)
                // Display XP = nftXP + s1Xp + s2Xp
                const displayXP = totalXP + s1Xp + s2Xp
                const { level, rank, progress } = calculateStats(displayXP)

                // Only re-sync DB if NFT XP changed (avoid overwriting season XP)
                const dbNftXp = dbUser?.xp || 0
                if (!dbUser || dbNftXp !== totalXP) {
                    setState({
                        xp: displayXP,
                        nftXp: totalXP,
                        s1Xp,
                        s2Xp,
                        s2Level,
                        s2RankTitle,
                        level, rank, progress,
                        stats: { droids: droidsCount, batteries: batteriesCount },
                        username: dbUser?.username || "",
                        isLoading: false
                    })
                    const { error: upsertError } = await supabase.from('users').upsert({
                        wallet_address: address,
                        xp: totalXP,       // store NFT XP only — season XP lives in season tables
                        droids_count: droidsCount,
                        batteries_count: batteriesCount,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'wallet_address' })

                    if (upsertError) {
                        console.error("❌ Failed to update User Progress in DB:", upsertError)
                    } else {
                        console.log(`✅ User Progress Saved: NFT XP ${totalXP}, Display XP ${displayXP}`)
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