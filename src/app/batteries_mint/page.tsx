"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion } from "framer-motion"
import { useActiveAccount, ConnectButton, TransactionButton } from "thirdweb/react"
import { Header } from "@/components/header"
import { client, apeChain } from "@/lib/thirdweb"
import { formatDistanceToNow } from "date-fns"
import { getContract, readContract, getContractEvents } from "thirdweb"
import { claimTo, getActiveClaimCondition, getClaimConditions, getOwnedNFTs, tokensClaimedEvent, totalSupply as getTotalSupply, canClaim } from "thirdweb/extensions/erc721"
import { getClaimParams } from "thirdweb/utils"
import { Minus, Plus, Lock, ChevronDown, ChevronUp, CheckCircle, Loader2 } from "lucide-react"
import { ProfileModal } from "@/components/profile-modal"
import { EligibilityModal } from "@/components/eligibility-modal"
import { useUserProgress } from "@/hooks/useUserProgress"
import { MintSuccessModal } from "@/components/mint-success-modal"
import { SocialSidebar } from "@/components/social-sidebar"
import { createWallet } from "thirdweb/wallets"
import { formatEther, parseEther } from "viem"
import holdersSnapshot from "./snapshot.json"

const BATTERY_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || ""

// Create contract outside component to prevent infinite re-renders
const batteryContract = BATTERY_CONTRACT_ADDRESS ? getContract({
    client,
    chain: apeChain,
    address: BATTERY_CONTRACT_ADDRESS,
}) : null

type PhaseStatus = 'upcoming' | 'live' | 'finished'

interface ClaimConditionData {
    startTimestamp: bigint
    maxClaimableSupply: bigint
    supplyClaimed: bigint
    quantityLimitPerWallet: bigint
    pricePerToken: bigint
    currency: string
    metadata?: string
}

interface PhaseData {
    name: string
    status: PhaseStatus
    price: string
    priceUsd: string
    maxPerWallet: number
    supplyClaimed: number
    maxSupply: number
    startTime: Date | null
}

const faqItems = [
    {
        question: "What are Energy Batteries?",
        answer: "Energy Batteries are essential fuel cells required for ApeDroid evolution and upgrades. They come in Standard and Super variants, distributed randomly during minting."
    },
    {
        question: "How many Batteries can I mint?",
        answer: "ApeDroidz Holders can mint up to 1 battery per Droid they own. Public stage allows 10 batteries per wallet."
    },
    {
        question: "ApeDroidz Holder Loyalty Airdrop",
        answer: (
            <div className="space-y-4">
                <p>We’re launching a loyalty airdrop to support our holders and help animate more Droidz.</p>
                <div>
                    <p className="font-bold mb-2 text-white">Free Energy Batteries by holdings:</p>
                    <ul className="space-y-1">
                        <li>• 10 Droidz → 1 free battery</li>
                        <li>• 20 Droidz → 3 free batteries</li>
                        <li>• 50 Droidz → 8 free batteries</li>
                        <li>• 100 Droidz → 20 free batteries</li>
                        <li>• 200+ Droidz → 30 free batteries</li>
                    </ul>
                </div>
                <div className="space-y-2">
                    <p>The more Droidz you hold, the more batteries you receive - completely free.</p>
                    <p>Our goal is simple: animate as many Droidz as possible and deliver an amazing upgrade experience to our community.</p>
                </div>
            </div>
        )
    },
    {
        question: "What's the difference between Standard and Super Batteries?",
        answer: "Super Battery replaces the Droid's background from apechain_blue to apechain_orange and also grants more experience."
    },
]

const wallets = [
    createWallet("io.metamask"),
    createWallet("com.coinbase.wallet"),
    createWallet("me.rainbow"),
]

function shortenAddress(address: string) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getOpenSeaLink(address: string) {
    return `https://opensea.io/${address}`
}

export default function MintPage() {
    const account = useActiveAccount()
    const [quantity, setQuantity] = useState(1)
    const [isProfileOpen, setIsProfileOpen] = useState(false)
    const [profileInitialTab, setProfileInitialTab] = useState<'profile' | 'leaderboard'>('profile')
    const [isEligibilityOpen, setIsEligibilityOpen] = useState(false)
    const [eligibilityPhase, setEligibilityPhase] = useState<'holders' | 'public'>('holders')
    const [openFaq, setOpenFaq] = useState<number | null>(null)

    const [isMintSuccessOpen, setIsMintSuccessOpen] = useState(false)
    const [mintedAmount, setMintedAmount] = useState(0)

    // User Progress for Success Modal
    const { level: userLevel, progress: userProgress } = useUserProgress()

    // Contract data states
    const [isLoading, setIsLoading] = useState(true)
    const [totalSupply, setTotalSupply] = useState(3333)
    const [totalMinted, setTotalMinted] = useState(0)
    const [phases, setPhases] = useState<PhaseData[]>([])
    const [activePhaseIndex, setActivePhaseIndex] = useState(0)
    const [countdown, setCountdown] = useState(0)
    const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000))
    const [recentMints, setRecentMints] = useState<{ address: string; amount: number; time: string }[]>([])
    const [pricePerToken, setPricePerToken] = useState<bigint>(BigInt(0))
    const [apePriceUsd, setApePriceUsd] = useState<number | null>(null)

    // Fetch APE Price
    useEffect(() => {
        const fetchPrice = async () => {
            try {
                const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=apecoin&vs_currencies=usd')
                const data = await res.json()
                if (data.apecoin?.usd) {
                    setApePriceUsd(data.apecoin.usd)
                }
            } catch (e) {
                console.error("Failed to fetch APE price", e)
                // Fallback or leave as null (will show $0.00 or generic text)
            }
        }
        fetchPrice()
        // Refresh price every minute
        const interval = setInterval(fetchPrice, 60000)
        return () => clearInterval(interval)
    }, [])

    // Polling refs
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
    const lastBlockRef = useRef<bigint>(BigInt(0))

    // Eligibility state - keyed by phase index for per-phase tracking
    const [eligibility, setEligibility] = useState<Record<number, {
        isEligible: boolean
        batteriesAvailable: number
        batteriesMinted: number
    }>>({})
    const [isEligibilityLoading, setIsEligibilityLoading] = useState(false)

    // Use the pre-created contract
    const contract = batteryContract

    // Helper function to parse phase name from metadata
    const parsePhaseName = (metadata: string | undefined, fallbackIndex: number): string => {
        // 3-phase fallback: 0 = Team Phase, 1 = ApeDroidz Holders, 2+ = Public Phase
        const getDefaultName = (index: number) => {
            if (index === 0) return "Team Phase"
            if (index === 1) return "ApeDroidz Holders"
            return "Public Phase"
        }

        if (!metadata) return getDefaultName(fallbackIndex)

        // Try to parse as JSON first
        try {
            const meta = JSON.parse(metadata)
            if (meta.name && typeof meta.name === 'string') {
                return meta.name
            }
        } catch {
            // Not JSON
        }

        // If it's an IPFS link or other non-name string, use fallback
        if (metadata.startsWith('ipfs://') || metadata.startsWith('http') || metadata.length > 50) {
            return getDefaultName(fallbackIndex)
        }

        return metadata
    }

    // Helper function to safely parse quantity limit (handles unlimited/max uint values)
    const parseQuantityLimit = (limit: bigint): number => {
        // If the limit is larger than MAX_SAFE_INTEGER or is a very large value, treat as unlimited
        // Max uint256 is approximately 1.15e77, so any value > 1e15 is effectively unlimited
        const MAX_REASONABLE_LIMIT = BigInt(1000000)
        if (limit > MAX_REASONABLE_LIMIT) {
            return 100 // Default "unlimited" to 100 for display purposes
        }
        return Number(limit)
    }

    // Fetch contract data
    const fetchContractData = useCallback(async (showLoading = true) => {
        if (!BATTERY_CONTRACT_ADDRESS || !contract) {
            setIsLoading(false)
            return
        }

        try {
            if (showLoading) setIsLoading(true)

            // Get total minted (using totalSupply which returns actual minted count)
            let totalMintedCount = 0
            try {
                const supply = await getTotalSupply({ contract: contract! })
                totalMintedCount = Number(supply)
            } catch (e) {
                console.log("Could not fetch totalSupply:", e)
            }
            setTotalMinted(totalMintedCount)

            // Get ALL claim conditions (not just active one)
            let allConditions: any[] = []
            try {
                allConditions = await getClaimConditions({ contract: contract! })
            } catch (e) {
                // Fallback to single active condition
                const activeCondition = await getActiveClaimCondition({ contract: contract! })
                if (activeCondition) allConditions = [activeCondition]
            }

            if (allConditions.length > 0) {
                const now = BigInt(Math.floor(Date.now() / 1000))
                const parsedPhases: PhaseData[] = []
                let foundActivePhase = false
                let activePrice = BigInt(0)

                for (let i = 0; i < allConditions.length; i++) {
                    const condition = allConditions[i]
                    const price = formatEther(condition.pricePerToken)
                    const priceNum = parseFloat(price)
                    const priceUsd = (priceNum * 0.5).toFixed(2)
                    const startTime = condition.startTimestamp
                    const isLive = now >= startTime

                    // Check if this is the currently active phase
                    const nextCondition = allConditions[i + 1]
                    const isCurrentlyActive = isLive && (!nextCondition || now < nextCondition.startTimestamp)

                    if (isCurrentlyActive && !foundActivePhase) {
                        foundActivePhase = true
                        activePrice = condition.pricePerToken
                        setActivePhaseIndex(parsedPhases.length)
                    }

                    let status: PhaseStatus = 'upcoming'
                    if (isCurrentlyActive) {
                        status = 'live'
                    } else if (isLive && !isCurrentlyActive) {
                        status = 'finished'
                    }

                    const phase: PhaseData = {
                        name: parsePhaseName(condition.metadata, i),
                        status,
                        price: `${priceNum} APE`,
                        priceUsd: `≈$${priceUsd}`,
                        maxPerWallet: parseQuantityLimit(condition.quantityLimitPerWallet),
                        supplyClaimed: Number(condition.supplyClaimed || 0),
                        maxSupply: parseQuantityLimit(condition.maxClaimableSupply),
                        startTime: new Date(Number(startTime) * 1000)
                    }

                    parsedPhases.push(phase)
                }

                setPhases(parsedPhases)
                setPricePerToken(activePrice)

                // Calculate countdown for next upcoming phase
                const upcomingPhase = parsedPhases.find(p => p.status === 'upcoming')
                if (upcomingPhase?.startTime) {
                    const secondsUntilStart = Math.floor(upcomingPhase.startTime.getTime() / 1000) - Math.floor(Date.now() / 1000)
                    setCountdown(Math.max(0, secondsUntilStart))
                } else {
                    setCountdown(0)
                }
            }

            // Fetch recent mint events
            try {
                const events = await getContractEvents({
                    contract: contract!,
                    events: [tokensClaimedEvent()],
                })

                if (events.length > 0) {
                    // Update last processed block
                    const lastEvent = events[events.length - 1]
                    if (lastEvent.blockNumber) {
                        lastBlockRef.current = lastEvent.blockNumber
                    }
                }

                // Process events into recent mints (last 3)
                const last3Events = events.slice(-3).reverse()
                const mints = await Promise.all(last3Events.map(async (event: any) => {
                    const claimer = event.args?.claimer || event.args?.[0] || ""
                    const qty = Number(event.args?.quantityClaimed || event.args?.[2] || 1)
                    const blockNum = event.blockNumber || BigInt(0)

                    let timeStr = "Just now"
                    try {
                        if (blockNum > 0) {
                            // Direct RPC call to get block time (getBlock not exported)
                            const res = await fetch("https://curtis.rpc.caldera.xyz/http", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    jsonrpc: "2.0",
                                    method: "eth_getBlockByNumber",
                                    params: [`0x${blockNum.toString(16)}`, false],
                                    id: 1
                                })
                            })
                            const data = await res.json()
                            if (data.result && data.result.timestamp) {
                                const timestamp = parseInt(data.result.timestamp, 16)
                                timeStr = formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true })
                                    .replace("about ", "") // Make it shorter
                            }
                        }
                    } catch (e) {
                        console.warn("Failed to fetch block time:", e)
                        timeStr = `Block ${blockNum.toString()}`
                    }

                    return {
                        address: claimer,
                        amount: qty,
                        time: timeStr
                    }
                }))
                setRecentMints(mints)
            } catch (eventError) {
                console.log("Could not fetch recent events:", eventError)
            }

        } catch (error) {
            console.error("Error fetching contract data:", error)
            // Set default fallback data
            setPhases([{
                name: "Holders Phase",
                status: 'live',
                price: "15 APE",
                priceUsd: "≈$7.5",
                maxPerWallet: 10,
                supplyClaimed: 0,
                maxSupply: 3333,
                startTime: null
            }])
        } finally {
            setIsLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []) // Empty deps - contract is stable

    // Check eligibility for connected wallet - checks ALL phases
    const checkEligibility = useCallback(async () => {
        if (!account?.address || !BATTERY_CONTRACT_ADDRESS || !contract) {
            setEligibility({})
            return
        }

        setIsEligibilityLoading(true)
        console.log("=== CHECKING ELIGIBILITY ===")
        console.log("Wallet:", account.address)

        try {
            const newEligibility: Record<number, { isEligible: boolean; batteriesAvailable: number; batteriesMinted: number }> = {}

            // Get current active claim condition
            let activeCondition = null
            let activeConditionId = BigInt(0)
            try {
                activeCondition = await getActiveClaimCondition({ contract: contract! })
                console.log("Active condition:", activeCondition)

                // Get the condition ID from the conditions list
                if (activeCondition) {
                    const allConditions = await getClaimConditions({ contract: contract! })
                    console.log("All conditions:", allConditions.length)
                    const now = BigInt(Math.floor(Date.now() / 1000))
                    for (let i = 0; i < allConditions.length; i++) {
                        const cond = allConditions[i]
                        const nextCond = allConditions[i + 1]
                        const isActive = now >= cond.startTimestamp && (!nextCond || now < nextCond.startTimestamp)
                        if (isActive) {
                            activeConditionId = BigInt(i)
                            console.log("Active condition ID:", i)
                            break
                        }
                    }
                }
            } catch (e) {
                console.error("Could not get active claim condition:", e)
            }

            // Helper function to get claimed count for a specific phase
            const getClaimedForPhase = async (conditionId: number): Promise<number> => {
                console.log(`>>> Calling getSupplyClaimedByWallet for conditionId=${conditionId}, wallet=${account.address}`)
                try {
                    const claimed = await readContract({
                        contract: contract!,
                        method: "function getSupplyClaimedByWallet(uint256 _conditionId, address _claimer) view returns (uint256)",
                        params: [BigInt(conditionId), account.address]
                    })
                    console.log(`>>> SUCCESS: Claimed for conditionId ${conditionId}:`, Number(claimed))
                    return Number(claimed)
                } catch (e) {
                    console.error(`>>> ERROR reading claimed for conditionId ${conditionId}:`, e)
                    return 0
                }
            }

            // Process each phase with its own claimed count
            for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
                const phase = phases[phaseIndex]
                const isLive = phase.status === 'live'
                const isUpcoming = phase.status === 'upcoming'
                const isFinished = phase.status === 'finished'
                console.log(`Phase ${phaseIndex}: ${phase.name}, status: ${phase.status}`)

                // ALWAYS get claimed count for debugging - for ALL phases
                const claimedInThisPhase = await getClaimedForPhase(phaseIndex)
                console.log(`Phase ${phaseIndex} - claimedInThisPhase = ${claimedInThisPhase}`)

                if (phaseIndex === 0) {
                    // Team Phase
                    if (isLive) {
                        try {
                            const claimParams = await getClaimParams({ contract: contract!, to: account.address, quantity: BigInt(1), type: "erc721" })
                            const limit = claimParams.allowlistProof
                                ? parseQuantityLimit(claimParams.allowlistProof.quantityLimitPerWallet)
                                : phase.maxPerWallet || 10
                            const claimCheck = await canClaim({ contract: contract!, claimer: account.address, quantity: BigInt(1) })

                            newEligibility[0] = {
                                isEligible: claimCheck.result && (limit - claimedInThisPhase > 0),
                                batteriesAvailable: limit,
                                batteriesMinted: claimedInThisPhase
                            }
                        } catch {
                            newEligibility[0] = { isEligible: false, batteriesAvailable: 0, batteriesMinted: claimedInThisPhase }
                        }
                    } else if (isFinished) {
                        // Show minted count for finished phase
                        newEligibility[0] = { isEligible: false, batteriesAvailable: 0, batteriesMinted: claimedInThisPhase }
                    } else {
                        newEligibility[0] = { isEligible: false, batteriesAvailable: 0, batteriesMinted: 0 }
                    }
                } else if (phaseIndex === 1) {
                    // ApeDroidz Holders Phase
                    const walletAddress = account.address.toLowerCase()
                    const snapshotLimit = (holdersSnapshot as Record<string, number>)[walletAddress] || 0
                    console.log(`Phase 1 - Snapshot limit for ${walletAddress}: ${snapshotLimit}, Claimed: ${claimedInThisPhase}`)

                    if (isLive) {
                        // LIVE - Get data from contract
                        try {
                            const claimParams = await getClaimParams({
                                contract: contract!,
                                to: account.address,
                                quantity: BigInt(1),
                                type: "erc721"
                            })
                            console.log("Phase 1 claimParams:", claimParams)

                            const contractLimit = claimParams.allowlistProof
                                ? parseQuantityLimit(claimParams.allowlistProof.quantityLimitPerWallet)
                                : snapshotLimit
                            console.log("Phase 1 contract limit:", contractLimit)

                            const claimCheck = await canClaim({
                                contract: contract!,
                                claimer: account.address,
                                quantity: BigInt(1)
                            })
                            console.log("Phase 1 canClaim result:", claimCheck.result, claimCheck.reason)

                            const remaining = contractLimit - claimedInThisPhase
                            console.log(`Phase 1 - Limit: ${contractLimit}, Claimed: ${claimedInThisPhase}, Remaining: ${remaining}`)

                            newEligibility[1] = {
                                isEligible: claimCheck.result && remaining > 0,
                                batteriesAvailable: contractLimit,
                                batteriesMinted: claimedInThisPhase
                            }
                        } catch (e) {
                            console.error("Error checking Phase 1:", e)
                            const remaining = snapshotLimit - claimedInThisPhase
                            newEligibility[1] = {
                                isEligible: remaining > 0,
                                batteriesAvailable: snapshotLimit,
                                batteriesMinted: claimedInThisPhase
                            }
                        }
                    } else if (isFinished) {
                        // Finished - show what was minted
                        newEligibility[1] = {
                            isEligible: false,
                            batteriesAvailable: snapshotLimit,
                            batteriesMinted: claimedInThisPhase
                        }
                    } else {
                        // NOT LIVE - Use snapshot only
                        newEligibility[1] = {
                            isEligible: snapshotLimit > 0,
                            batteriesAvailable: snapshotLimit,
                            batteriesMinted: 0
                        }
                    }
                    console.log("Phase 1 eligibility result:", newEligibility[1])
                } else if (phaseIndex >= 2) {
                    // Public Phase
                    if (isLive) {
                        try {
                            const conditionLimit = activeCondition
                                ? parseQuantityLimit(activeCondition.quantityLimitPerWallet)
                                : phase.maxPerWallet || 10

                            const claimCheck = await canClaim({
                                contract: contract!,
                                claimer: account.address,
                                quantity: BigInt(1)
                            })
                            console.log(`Phase ${phaseIndex} limit: ${conditionLimit}, claimed: ${claimedInThisPhase}`)

                            newEligibility[phaseIndex] = {
                                isEligible: claimCheck.result && (conditionLimit - claimedInThisPhase > 0),
                                batteriesAvailable: conditionLimit,
                                batteriesMinted: claimedInThisPhase
                            }
                        } catch (e) {
                            console.error(`Error checking Phase ${phaseIndex}:`, e)
                            newEligibility[phaseIndex] = {
                                isEligible: true,
                                batteriesAvailable: phase.maxPerWallet || 10,
                                batteriesMinted: claimedInThisPhase
                            }
                        }
                    } else if (isFinished) {
                        newEligibility[phaseIndex] = {
                            isEligible: false,
                            batteriesAvailable: phase.maxPerWallet || 10,
                            batteriesMinted: claimedInThisPhase
                        }
                    } else {
                        newEligibility[phaseIndex] = {
                            isEligible: true,
                            batteriesAvailable: phase.maxPerWallet || 10,
                            batteriesMinted: 0
                        }
                    }
                }
            }

            console.log("=== FINAL ELIGIBILITY ===", newEligibility)
            setEligibility(newEligibility)

        } catch (error) {
            console.error("Error checking eligibility:", error)
            setEligibility({})
        } finally {
            setIsEligibilityLoading(false)
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [account?.address, activePhaseIndex, phases]) // Re-run when wallet or phases change

    // Initial data fetch - run once on mount
    useEffect(() => {
        fetchContractData()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []) // Run once on mount

    // Polling for real-time updates
    useEffect(() => {
        // Poll every 15 seconds for new data (mints, events, etc.)
        pollingIntervalRef.current = setInterval(() => {
            fetchContractData(false) // false = don't show loading spinner
        }, 15000)

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Check eligibility when wallet connects OR when phases change
    useEffect(() => {
        if (account?.address && phases.length > 0) {
            checkEligibility()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [account?.address, phases.length]) // Run when wallet changes OR phases are loaded

    // Update currentTime every second for countdown displays
    useEffect(() => {
        const timer = setInterval(() => {
            const now = Math.floor(Date.now() / 1000)
            setCurrentTime(now)

            // Check if any upcoming phase just became live
            const upcomingPhase = phases.find(p => p.status === 'upcoming' && p.startTime)
            if (upcomingPhase && upcomingPhase.startTime) {
                const phaseStart = Math.floor(upcomingPhase.startTime.getTime() / 1000)
                if (now >= phaseStart) {
                    // Phase just started, refresh data
                    fetchContractData()
                    checkEligibility()
                }
            }
        }, 1000)
        return () => clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phases])

    const formatCountdown = (seconds: number) => {
        const h = Math.floor(seconds / 3600)
        const m = Math.floor((seconds % 3600) / 60)
        const s = seconds % 60
        return `${h.toString().padStart(2, '0')}H:${m.toString().padStart(2, '0')}M:${s.toString().padStart(2, '0')}S`
    }

    const remaining = totalSupply - totalMinted
    const mintedPercent = (totalMinted / totalSupply) * 100

    // Find active phase for Mint Logic (quantity calculation)
    const activePhase = phases.find(p => p.status === 'live') || phases[0]

    // Max mintable calculation depends on active phase eligibility
    // Note: This logic assumes we are minting from the ACTIVE phase.
    const activePhaseEligibility = eligibility[activePhaseIndex]
    const maxMintable = activePhaseEligibility
        ? (activePhaseEligibility.isEligible ? Math.max(0, activePhaseEligibility.batteriesAvailable - activePhaseEligibility.batteriesMinted) : 0)
        : (activePhase?.maxPerWallet || 10)

    // Ensure quantity doesn't exceed maxMintable or drop below 1 (unless max is 0)
    useEffect(() => {
        if (maxMintable === 0) {
            setQuantity(0)
        } else if (quantity > maxMintable) {
            setQuantity(maxMintable)
        } else if (quantity === 0 && maxMintable > 0) {
            setQuantity(1)
        }
    }, [maxMintable, quantity])

    const increment = () => setQuantity(prev => {
        if (maxMintable === 0) return 0
        return Math.min(prev + 1, maxMintable)
    })

    const decrement = () => setQuantity(prev => {
        if (maxMintable === 0) return 0
        return Math.max(prev - 1, 1)
    })

    const setMax = () => setQuantity(maxMintable)

    const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value)
        if (isNaN(val)) {
            setQuantity(0)
            return
        }

        if (val > maxMintable) {
            setQuantity(maxMintable)
        } else {
            setQuantity(val)
        }
    }

    const handleCheckEligibility = (phase: 'holders' | 'public') => {
        setEligibilityPhase(phase)
        setIsEligibilityOpen(true)
    }

    const handleMintSuccess = () => {
        setMintedAmount(quantity)
        setIsMintSuccessOpen(true)

        // INSTANTLY update local state to reflect the mint
        const newTotalMinted = totalMinted + quantity
        setTotalMinted(newTotalMinted)

        if (eligibility[activePhaseIndex]) {
            const currentPhaseData = eligibility[activePhaseIndex]
            const newMinted = currentPhaseData.batteriesMinted + quantity
            const newEligible = currentPhaseData.batteriesAvailable - newMinted > 0

            setEligibility({
                ...eligibility,
                [activePhaseIndex]: {
                    ...currentPhaseData,
                    batteriesMinted: newMinted,
                    isEligible: newEligible
                }
            })

            // Also reset input to valid value if maxed
            if (quantity > (currentPhaseData.batteriesAvailable - newMinted)) {
                setQuantity(Math.max(1, currentPhaseData.batteriesAvailable - newMinted))
            }
        }

        // Trigger XP sync with multiple retry attempts (blockchain indexer lag)
        console.log("🔋 Mint success! Starting XP sync...")

        // Immediate attempt
        window.dispatchEvent(new Event('user_progress_updated'))
        fetchContractData()

        // Retry 1: After 3 seconds
        setTimeout(() => {
            console.log("🔄 XP Sync retry #1 (3s)")
            window.dispatchEvent(new Event('user_progress_updated'))
            checkEligibility()
            fetchContractData()
        }, 3000)

        // Retry 2: After 6 seconds
        setTimeout(() => {
            console.log("🔄 XP Sync retry #2 (6s)")
            window.dispatchEvent(new Event('user_progress_updated'))
        }, 6000)

        // Retry 3: After 10 seconds (final attempt)
        setTimeout(() => {
            console.log("🔄 XP Sync retry #3 (10s) - Final")
            window.dispatchEvent(new Event('user_progress_updated'))
        }, 10000)
    }

    return (
        <main className="relative min-h-screen w-full bg-black text-white font-sans overflow-hidden">
            <Header
                isDashboard={false}
                onOpenProfile={() => { setProfileInitialTab('profile'); setIsProfileOpen(true); }}
                onOpenLeaderboard={() => { setProfileInitialTab('leaderboard'); setIsProfileOpen(true); }}
            />

            <div className="flex min-h-screen pt-20 justify-center">
                <div className="flex w-full max-w-[1600px] px-8 lg:px-16">
                    {/* LEFT SIDE: Fixed battery image */}
                    <div className="hidden lg:flex w-[40%] fixed left-1/2 -translate-x-[calc(50%+380px)] top-0 h-screen items-center justify-center p-8">
                        <div className="relative w-full max-w-[600px] aspect-square rounded-3xl overflow-hidden">
                            <img
                                src="https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/standart_battery.webp"
                                alt="Energy Battery"
                                className="w-full h-full object-cover"
                            />
                        </div>
                    </div>

                    {/* RIGHT SIDE: Scrollable content */}
                    <div className="w-full lg:w-[50%] lg:ml-[50%] min-h-screen overflow-y-auto">
                        <div className="py-8 lg:py-20">

                            {/* MOBILE: Battery image at top */}
                            <div className="lg:hidden mb-6">
                                <div className="relative w-full aspect-square rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
                                    <img
                                        src="https://jpbalgwwwalofynoaavv.supabase.co/storage/v1/object/public/assets/batteries/standart_battery.webp"
                                        alt="Energy Battery"
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            </div>

                            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tight mb-8 lg:mb-12">
                                Energy Batteries Mint
                            </h1>

                            <div className="max-w-[580px]">
                                {/* Loading State - Skeleton */}
                                {isLoading ? (
                                    <div className="animate-pulse">
                                        {/* Skeleton: Remaining Counter */}
                                        <div className="mb-4">
                                            <div className="flex justify-between items-baseline mb-3">
                                                <div className="h-4 w-32 bg-white/10 rounded" />
                                                <div className="h-8 w-24 bg-white/10 rounded" />
                                            </div>
                                            <div className="h-2 bg-white/10 rounded-full" />
                                        </div>

                                        {/* Skeleton: Phase Cards */}
                                        <div className="space-y-4 mb-12">
                                            {[1, 2, 3].map((i) => (
                                                <div key={i} className="rounded-2xl border-2 border-white/10 bg-[#0a0a0a] p-6">
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div className="h-4 w-20 bg-white/10 rounded" />
                                                        <div className="h-4 w-28 bg-white/10 rounded" />
                                                    </div>
                                                    <div className="flex justify-between items-center">
                                                        <div>
                                                            <div className="h-6 w-40 bg-white/10 rounded mb-2" />
                                                            <div className="h-4 w-32 bg-white/10 rounded" />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* Remaining Counter */}
                                        <div className="mb-4">
                                            <div className="flex justify-between items-baseline mb-3">
                                                <span className="text-white/60 text-sm">Batteries Remaining:</span>
                                                <div className="flex items-baseline gap-1">
                                                    <span className="text-3xl font-black">{remaining.toLocaleString()}</span>
                                                    <span className="text-white/40 text-sm">/{totalSupply.toLocaleString()} Total</span>
                                                </div>
                                            </div>

                                            {/* Progress bar - Energy depleting from right to left */}
                                            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                                <div className="h-full flex">
                                                    {/* Dark part (minted/used) - grows from left */}
                                                    <div
                                                        className="h-full bg-white/5 transition-all duration-500"
                                                        style={{ width: `${mintedPercent}%` }}
                                                    />
                                                    {/* Blue part (remaining energy) - shrinks from right */}
                                                    <div
                                                        className="h-full transition-all duration-500 progress-pulse"
                                                        style={{ width: `${100 - mintedPercent}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Recent mints log */}
                                        {recentMints.length > 0 && (
                                            <div className="mb-10 space-y-1 text-right">
                                                {recentMints.map((mint, index) => (
                                                    <div
                                                        key={index}
                                                        className="text-xs font-mono flex flex-col md:block items-end gap-0.5 text-right"
                                                        style={{ opacity: 1 - (index * 0.3) }}
                                                    >
                                                        <div className="md:inline">
                                                            <span className="text-white/40">{mint.time} — </span>
                                                            <a
                                                                href={getOpenSeaLink(mint.address)}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-white/40 hover:text-white hover:underline transition-colors"
                                                            >
                                                                {shortenAddress(mint.address)}
                                                            </a>
                                                        </div>
                                                        <div className="md:inline">
                                                            <span className="text-white/40 hidden md:inline"> — minted </span>
                                                            <span className="text-white">{mint.amount} Batteries</span>
                                                            <span className="text-white/40 md:hidden"> minted</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* PHASES LIST - Render ALL phases */}
                                        <motion.div
                                            className="space-y-4 mb-12"
                                            initial="hidden"
                                            animate="show"
                                            variants={{
                                                hidden: { opacity: 0 },
                                                show: {
                                                    opacity: 1,
                                                    transition: {
                                                        staggerChildren: 0.12,
                                                        delayChildren: 0.1,
                                                    },
                                                },
                                            }}
                                        >
                                            {phases.map((phase, idx) => {
                                                const isLive = phase.status === 'live';
                                                const isFinished = phase.status === 'finished';
                                                const isUpcoming = phase.status === 'upcoming';
                                                const phaseEligibility = eligibility[idx];

                                                return (
                                                    <motion.div
                                                        key={idx}
                                                        variants={{
                                                            hidden: { opacity: 0, y: 20 },
                                                            show: {
                                                                opacity: 1,
                                                                y: 0,
                                                                transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
                                                            },
                                                        }}
                                                        className={`relative rounded-2xl border-2 overflow-hidden transition-all ${isLive ? 'border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.3)]' :
                                                            isFinished ? 'border-white/5 bg-white/5 opacity-60' :
                                                                'border-white/10 bg-[#0a0a0a]'
                                                            }`}
                                                    >
                                                        <div className={`p-6 ${isLive ? 'bg-[#111]' : ''}`}>
                                                            {/* === UPCOMING PHASE LAYOUT === */}
                                                            {isUpcoming ? (
                                                                <>
                                                                    {/* Header Row: Lock + UPCOMING on left, CHECK ELIGIBILITY on right */}
                                                                    <div className="flex justify-between items-center mb-4">
                                                                        <div className="flex items-center gap-2">
                                                                            <Lock size={14} className="text-white/50" />
                                                                            <span className="font-black text-xs uppercase tracking-widest text-white/50">
                                                                                Upcoming
                                                                            </span>
                                                                        </div>
                                                                        {/* Check Eligibility - ONLY for Phase 2 (Holders, idx === 1) */}
                                                                        {idx === 1 && (
                                                                            <button
                                                                                onClick={() => handleCheckEligibility('holders')}
                                                                                className="text-white/40 text-xs uppercase tracking-widest underline hover:text-white transition-colors cursor-pointer"
                                                                            >
                                                                                Check Eligibility
                                                                            </button>
                                                                        )}
                                                                    </div>

                                                                    {/* Content Row: Name + Status on left, Countdown + Date on right */}
                                                                    <div className="flex justify-between items-end">
                                                                        {/* Left Column: Name + Status */}
                                                                        <div>
                                                                            <h3 className="text-xl font-bold text-white">{phase.name}</h3>
                                                                            {/* Status Text */}
                                                                            {!account?.address ? (
                                                                                <p className="text-white/30 text-xs font-mono uppercase mt-1">
                                                                                    Limit: {phase.maxPerWallet} per wallet
                                                                                </p>
                                                                            ) : isEligibilityLoading ? (
                                                                                <div className="flex items-center gap-2 mt-1">
                                                                                    <Loader2 className="w-3 h-3 animate-spin text-white/50" />
                                                                                    <span className="text-white/30 text-xs font-mono uppercase">Checking...</span>
                                                                                </div>
                                                                            ) : phaseEligibility?.isEligible ? (
                                                                                <p className="text-xs font-mono uppercase mt-1">
                                                                                    <span className="text-green-500/70">Eligible:</span>
                                                                                    <span className="text-white/70"> {phaseEligibility.batteriesAvailable} available</span>
                                                                                    {phaseEligibility.batteriesMinted > 0 && (
                                                                                        <span className="text-white/30"> / {phaseEligibility.batteriesMinted} minted</span>
                                                                                    )}
                                                                                </p>
                                                                            ) : phaseEligibility ? (
                                                                                <p className="text-white/40 text-xs font-mono uppercase text-red-500/50 mt-1">
                                                                                    Not Eligible
                                                                                </p>
                                                                            ) : (
                                                                                <p className="text-white/30 text-xs font-mono uppercase mt-1">
                                                                                    Limit: {phase.maxPerWallet} per wallet
                                                                                </p>
                                                                            )}
                                                                        </div>

                                                                        {/* Right Column: Countdown + Date */}
                                                                        {phase.startTime && (
                                                                            <div className="text-right">
                                                                                {(() => {
                                                                                    const phaseStartTimestamp = Math.floor(phase.startTime.getTime() / 1000)
                                                                                    const timeUntil = phaseStartTimestamp - currentTime
                                                                                    if (timeUntil > 0) {
                                                                                        const h = Math.floor(timeUntil / 3600)
                                                                                        const m = Math.floor((timeUntil % 3600) / 60)
                                                                                        const s = timeUntil % 60
                                                                                        return (
                                                                                            <span className="font-mono text-lg font-bold text-white/70 block">
                                                                                                {`${h.toString().padStart(2, '0')}H:${m.toString().padStart(2, '0')}M:${s.toString().padStart(2, '0')}S`}
                                                                                            </span>
                                                                                        )
                                                                                    }
                                                                                    return null
                                                                                })()}
                                                                                <p className="text-white/40 text-[10px] font-mono uppercase mt-1">
                                                                                    {phase.startTime.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }).toUpperCase()} / {phase.startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })} UTC
                                                                                </p>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                /* === LIVE / FINISHED PHASE LAYOUT (Original) === */
                                                                <>
                                                                    {/* Header */}
                                                                    <div className="flex justify-between items-start mb-4">
                                                                        <div className="flex items-center gap-2">
                                                                            {isLive && <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
                                                                            <span className={`font-black text-xs uppercase tracking-widest ${isLive ? 'text-green-500' :
                                                                                isFinished ? 'text-white/30' :
                                                                                    'text-white/50'
                                                                                }`}>
                                                                                {isLive ? 'Live' : isFinished ? 'Ended' : 'Upcoming'}
                                                                            </span>
                                                                        </div>
                                                                        {/* Check Eligibility button - show ONLY for Phase 2 (Holders), idx === 1 */}
                                                                        {idx === 1 && (isLive || isUpcoming) && (
                                                                            <button
                                                                                onClick={() => handleCheckEligibility('holders')}
                                                                                className="text-white/40 text-xs uppercase tracking-widest underline hover:text-white transition-colors"
                                                                            >
                                                                                Check Eligibility
                                                                            </button>
                                                                        )}
                                                                        {/* Per-phase countdown - show time until this phase starts */}
                                                                        {isUpcoming && phase.startTime && (
                                                                            (() => {
                                                                                const phaseStartTimestamp = Math.floor(phase.startTime.getTime() / 1000)
                                                                                const timeUntil = phaseStartTimestamp - currentTime
                                                                                if (timeUntil > 0) {
                                                                                    const h = Math.floor(timeUntil / 3600)
                                                                                    const m = Math.floor((timeUntil % 3600) / 60)
                                                                                    const s = timeUntil % 60
                                                                                    return (
                                                                                        <span className="font-mono text-sm font-bold text-white/70">
                                                                                            {`${h.toString().padStart(2, '0')}H:${m.toString().padStart(2, '0')}M:${s.toString().padStart(2, '0')}S`}
                                                                                        </span>
                                                                                    )
                                                                                }
                                                                                return null
                                                                            })()
                                                                        )}
                                                                    </div>

                                                                    {/* Phase Content */}
                                                                    <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 lg:gap-0">
                                                                        <div className="flex flex-col gap-1">
                                                                            <h3 className={`text-xl font-bold ${isFinished ? 'text-white/50' : 'text-white'}`}>{phase.name}</h3>

                                                                            {/* Eligibility / Status Text */}
                                                                            {isLive ? (
                                                                                !account?.address ? (
                                                                                    <p className="text-white/40 text-xs font-mono uppercase">
                                                                                        LIMIT: {phase.maxPerWallet} per wallet
                                                                                    </p>
                                                                                ) : isEligibilityLoading ? (
                                                                                    <div className="flex items-center gap-2">
                                                                                        <Loader2 className="w-3 h-3 animate-spin text-white/50" />
                                                                                        <span className="text-white/30 text-xs font-mono uppercase">Checking...</span>
                                                                                    </div>
                                                                                ) : phaseEligibility?.isEligible ? (
                                                                                    <p className="text-xs font-mono uppercase">
                                                                                        <span className="text-green-500">Eligible:</span>
                                                                                        <span className="text-white"> {phaseEligibility.batteriesAvailable} available</span>
                                                                                        <span className="text-white/40"> / {phaseEligibility.batteriesMinted} minted</span>
                                                                                    </p>
                                                                                ) : (
                                                                                    <p className="text-white/40 text-xs font-mono uppercase text-red-500/50">
                                                                                        Not Eligible
                                                                                    </p>
                                                                                )
                                                                            ) : isUpcoming ? (
                                                                                // Upcoming phase - show eligibility from snapshot/defaults
                                                                                !account?.address ? (
                                                                                    <p className="text-white/30 text-xs font-mono uppercase">
                                                                                        Limit: {phase.maxPerWallet} per wallet
                                                                                    </p>
                                                                                ) : isEligibilityLoading ? (
                                                                                    <div className="flex items-center gap-2">
                                                                                        <Loader2 className="w-3 h-3 animate-spin text-white/50" />
                                                                                        <span className="text-white/30 text-xs font-mono uppercase">Checking...</span>
                                                                                    </div>
                                                                                ) : phaseEligibility?.isEligible ? (
                                                                                    <p className="text-xs font-mono uppercase">
                                                                                        <span className="text-green-500/70">Eligible:</span>
                                                                                        <span className="text-white/70"> {phaseEligibility.batteriesAvailable} available</span>
                                                                                        {phaseEligibility.batteriesMinted > 0 && (
                                                                                            <span className="text-white/30"> / {phaseEligibility.batteriesMinted} minted</span>
                                                                                        )}
                                                                                    </p>
                                                                                ) : phaseEligibility ? (
                                                                                    <p className="text-white/40 text-xs font-mono uppercase text-red-500/50">
                                                                                        Not Eligible
                                                                                    </p>
                                                                                ) : (
                                                                                    <p className="text-white/30 text-xs font-mono uppercase">
                                                                                        Limit: {phase.maxPerWallet} per wallet
                                                                                    </p>
                                                                                )
                                                                            ) : (
                                                                                // Finished phase
                                                                                <p className="text-white/30 text-xs font-mono uppercase">
                                                                                    Minted: {phase.supplyClaimed.toLocaleString()}
                                                                                </p>
                                                                            )}
                                                                        </div>

                                                                        {/* Controls (Only if Live) - Mobile: Row 4 */}
                                                                        {isLive && (
                                                                            <div className="flex items-center gap-3 mt-2 lg:mt-0">
                                                                                <button
                                                                                    onClick={decrement}
                                                                                    disabled={!phaseEligibility?.isEligible}
                                                                                    className="w-10 h-10 lg:w-9 lg:h-9 rounded-lg border border-white/20 flex items-center justify-center hover:bg-white hover:text-black hover:border-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white disabled:hover:border-white/20"
                                                                                >
                                                                                    <Minus size={14} />
                                                                                </button>
                                                                                <input
                                                                                    type="text"
                                                                                    value={quantity}
                                                                                    onChange={handleQuantityChange}
                                                                                    disabled={!phaseEligibility?.isEligible}
                                                                                    className="w-14 h-10 lg:h-9 text-center bg-transparent border border-white/20 rounded-lg text-white text-base font-mono disabled:opacity-30"
                                                                                />
                                                                                <button
                                                                                    onClick={increment}
                                                                                    disabled={!phaseEligibility?.isEligible}
                                                                                    className="w-10 h-10 lg:w-9 lg:h-9 rounded-lg border border-white/20 flex items-center justify-center hover:bg-white hover:text-black hover:border-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white disabled:hover:border-white/20"
                                                                                >
                                                                                    <Plus size={14} />
                                                                                </button>
                                                                                <button
                                                                                    onClick={setMax}
                                                                                    disabled={!phaseEligibility?.isEligible}
                                                                                    className="h-10 lg:h-9 px-4 lg:px-3 rounded-lg border border-white/20 text-xs uppercase tracking-wider hover:bg-white hover:text-black hover:border-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white disabled:hover:border-white/20"
                                                                                >
                                                                                    Max
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* Divider & Actions (Only if Live) */}
                                                                    {isLive && (
                                                                        <>
                                                                            <div className="h-px bg-white/10 my-5" />
                                                                            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-5 lg:gap-0">
                                                                                {/* Mobile: Row 5 - Price */}
                                                                                <div>
                                                                                    <p className="text-white/40 text-[10px] uppercase tracking-widest mb-1">Total Price</p>
                                                                                    <div className="flex items-baseline gap-1">
                                                                                        <span className="text-2xl font-black">
                                                                                            {pricePerToken > BigInt(0)
                                                                                                ? `${parseFloat(formatEther(pricePerToken * BigInt(quantity))).toFixed(2)} APE`
                                                                                                : phase.price}
                                                                                        </span>
                                                                                        <span className="text-white/30 text-xs">
                                                                                            {pricePerToken > BigInt(0)
                                                                                                ? `≈$${(parseFloat(formatEther(pricePerToken)) * quantity * (apePriceUsd || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                                                                                : phase.priceUsd}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>

                                                                                {/* Mobile: Row 6 - Button */}
                                                                                <div className="w-full lg:w-auto">
                                                                                    {!account?.address ? (
                                                                                        <ConnectButton
                                                                                            client={client}
                                                                                            chain={apeChain}
                                                                                            wallets={wallets}
                                                                                            theme="dark"
                                                                                            connectButton={{
                                                                                                label: "Connect Wallet",
                                                                                                className: `
                                                                                                !bg-white !text-black !font-bold !rounded-lg 
                                                                                                !h-[52px] lg:!h-[48px] !px-8 !text-base !w-full lg:!w-auto
                                                                                                !border !border-transparent !transition-all !duration-300
                                                                                                hover:!bg-[#0069FF] hover:!text-white hover:!border-transparent
                                                                                            `,
                                                                                            }}
                                                                                            connectModal={{
                                                                                                size: "compact",
                                                                                                title: "ApeDroidz Access",
                                                                                                showThirdwebBranding: false,
                                                                                            }}
                                                                                        />
                                                                                    ) : (
                                                                                        <TransactionButton
                                                                                            transaction={() => claimTo({
                                                                                                contract: contract!,
                                                                                                to: account?.address || "",
                                                                                                quantity: BigInt(quantity),
                                                                                            })}
                                                                                            onTransactionConfirmed={handleMintSuccess}
                                                                                            onError={(err) => console.error(err)}
                                                                                            disabled={!phaseEligibility?.isEligible || quantity === 0}
                                                                                            className="!bg-white !text-black !font-bold !uppercase !tracking-wider !rounded-xl !h-[52px] lg:!h-12 !px-10 !w-full lg:!w-auto hover:!bg-[#0069FF] hover:!text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:!bg-white disabled:hover:!text-black"
                                                                                        >
                                                                                            Mint Now
                                                                                        </TransactionButton>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </motion.div>
                                                )
                                            })}
                                        </motion.div>

                                        {/* FAQ Section */}
                                        <div className="border-t border-white/10 pt-12">
                                            <h2 className="text-2xl font-black uppercase tracking-tight mb-8">
                                                Frequently Asked Questions
                                            </h2>

                                            <div className="space-y-3">
                                                {faqItems.map((item, index) => (
                                                    <div
                                                        key={index}
                                                        className="border border-white/10 rounded-xl overflow-hidden"
                                                    >
                                                        <button
                                                            onClick={() => setOpenFaq(openFaq === index ? null : index)}
                                                            className="w-full p-5 flex justify-between items-center text-left hover:bg-white/5 transition-colors"
                                                        >
                                                            <span className="font-semibold">{item.question}</span>
                                                            {openFaq === index ? (
                                                                <ChevronUp size={20} className="text-white/40" />
                                                            ) : (
                                                                <ChevronDown size={20} className="text-white/40" />
                                                            )}
                                                        </button>
                                                        {openFaq === index && (
                                                            <div className="px-5 pb-5 text-white/60 text-sm leading-relaxed">
                                                                {item.answer}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="h-20" />
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {/* Modals */}
            <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} initialTab={profileInitialTab} />
            <EligibilityModal
                isOpen={isEligibilityOpen}
                onClose={() => setIsEligibilityOpen(false)}
                phaseType={eligibilityPhase}
                isPhaseActive={eligibilityPhase === 'holders' ? phases[1]?.status === 'live' : phases[2]?.status === 'live'}
            />
            <MintSuccessModal
                isOpen={isMintSuccessOpen}
                onClose={() => setIsMintSuccessOpen(false)}
                mintedAmount={mintedAmount}
                xpEarned={mintedAmount * 100}
                currentLevel={userLevel}
                currentProgress={userProgress}
                previousProgress={Math.max(0, userProgress - 5)} // Visual effect only
            />

            {/* Social Sidebar */}
            <SocialSidebar orientation="vertical" />
        </main >
    )
}