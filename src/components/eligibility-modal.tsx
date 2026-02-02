"use client"

import { motion, AnimatePresence } from "framer-motion"
import { X, CheckCircle, XCircle, Loader2, Search } from "lucide-react"
import { useState, useEffect } from "react"
import { useActiveAccount } from "thirdweb/react"
import { getContract, readContract } from "thirdweb"
import { getActiveClaimCondition, getOwnedNFTs, canClaim } from "thirdweb/extensions/erc721"
import { client, apeChain } from "@/lib/thirdweb"
import { getClaimParams } from "thirdweb/utils"
import holdersSnapshot from "@/app/batteries_mint/snapshot.json"

const BATTERY_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BATTERY_CONTRACT_ADDRESS || ""
const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""

// Create contracts outside component to prevent infinite re-renders
const batteryContractInstance = BATTERY_CONTRACT_ADDRESS ? getContract({
    client,
    chain: apeChain,
    address: BATTERY_CONTRACT_ADDRESS,
}) : null

const droidContractInstance = DROID_CONTRACT_ADDRESS ? getContract({
    client,
    chain: apeChain,
    address: DROID_CONTRACT_ADDRESS,
}) : null



// Helper function to safely parse quantity limit (handles unlimited/max uint values)
const parseQuantityLimit = (limit: bigint): number => {
    const MAX_REASONABLE_LIMIT = BigInt(1000000)
    if (limit > MAX_REASONABLE_LIMIT) {
        return 100 // Default "unlimited" to 100 for display purposes
    }
    return Number(limit)
}

interface EligibilityModalProps {
    isOpen: boolean
    onClose: () => void
    phaseType: 'holders' | 'public'
    isPhaseActive?: boolean  // Whether this phase is currently live
}

export function EligibilityModal({ isOpen, onClose, phaseType, isPhaseActive = true }: EligibilityModalProps) {
    const account = useActiveAccount()
    const [isLoading, setIsLoading] = useState(false)
    const [manualAddress, setManualAddress] = useState("")
    const [eligibilityData, setEligibilityData] = useState<{
        isEligible: boolean
        droidsOwned: number
        batteriesAvailable: number
        batteriesMinted: number
        checkedAddress: string
    } | null>(null)

    // Use pre-created contracts
    const batteryContract = batteryContractInstance

    // Автоматическая проверка при открытии если кошелек подключен
    useEffect(() => {
        if (isOpen && account?.address) {
            checkEligibility(account.address)
        } else if (isOpen && !account?.address) {
            setEligibilityData(null)
            setManualAddress("")
        }
    }, [isOpen, account?.address])

    const checkEligibility = async (address: string) => {
        if (!address || address.length < 42 || !batteryContract) return

        setIsLoading(true)
        setEligibilityData(null)

        try {
            // Get owned batteries to count how many already minted
            let batteriesMinted = 0
            try {
                const ownedBatteries = await getOwnedNFTs({
                    contract: batteryContract!,
                    owner: address
                })
                batteriesMinted = ownedBatteries.length
            } catch (e) {
                console.log("Could not fetch owned batteries:", e)
            }

            // Get owned droids count
            let droidsOwned = 0
            if (droidContractInstance) {
                try {
                    const ownedDroids = await getOwnedNFTs({
                        contract: droidContractInstance,
                        owner: address
                    })
                    droidsOwned = ownedDroids.length
                } catch (e) {
                    console.log("Could not fetch owned droids:", e)
                }
            }

            // For holders phase that is NOT yet active, use snapshot data
            if (phaseType === 'holders' && !isPhaseActive) {
                const walletAddress = address.toLowerCase()
                const snapshotLimit = (holdersSnapshot as Record<string, number>)[walletAddress] || 0

                const remainingAvailable = Math.max(0, snapshotLimit - batteriesMinted)

                setEligibilityData({
                    isEligible: snapshotLimit > 0 && remainingAvailable > 0,
                    droidsOwned: droidsOwned,
                    batteriesAvailable: snapshotLimit,
                    batteriesMinted: batteriesMinted,
                    checkedAddress: address
                })
                setIsLoading(false)
                return
            }

            // For active phases, use contract data
            const activeCondition = await getActiveClaimCondition({ contract: batteryContract! })

            if (!activeCondition) {
                setEligibilityData({
                    isEligible: false,
                    droidsOwned: droidsOwned,
                    batteriesAvailable: 0,
                    batteriesMinted: batteriesMinted,
                    checkedAddress: address
                })
                setIsLoading(false)
                return
            }

            const maxPerWallet = parseQuantityLimit(activeCondition.quantityLimitPerWallet)

            // Determine max available based on limit
            let batteriesAvailable = maxPerWallet

            // fetch proof from snapshot
            try {
                const claimParams = await getClaimParams({
                    contract: batteryContract!,
                    to: address,
                    quantity: BigInt(1),
                    type: "erc721"
                })

                if (claimParams.allowlistProof) {
                    const proofLimit = parseQuantityLimit(claimParams.allowlistProof.quantityLimitPerWallet)
                    batteriesAvailable = proofLimit
                }
            } catch (e) {
                console.log("Could not fetch claim params:", e)
            }

            // Verify actual eligibility on contract using canClaim
            let isEligible = false
            try {
                const claimCheck = await canClaim({
                    contract: batteryContract!,
                    claimer: address,
                    quantity: BigInt(1)
                })
                isEligible = claimCheck.result
            } catch (e) {
                console.log("Error verifying claim via canClaim:", e)
            }

            // Calculate remaining available (taking into account already minted)
            const remainingAvailable = Math.max(0, batteriesAvailable - batteriesMinted)

            setEligibilityData({
                isEligible: isEligible && remainingAvailable > 0,
                droidsOwned: droidsOwned,
                batteriesAvailable: batteriesAvailable,
                batteriesMinted: batteriesMinted,
                checkedAddress: address
            })
        } catch (error) {
            console.error("Error checking eligibility:", error)
            // For holders phase fallback to snapshot
            if (phaseType === 'holders') {
                const walletAddress = address.toLowerCase()
                const snapshotLimit = (holdersSnapshot as Record<string, number>)[walletAddress] || 0
                setEligibilityData({
                    isEligible: snapshotLimit > 0,
                    droidsOwned: 0,
                    batteriesAvailable: snapshotLimit,
                    batteriesMinted: 0,
                    checkedAddress: address
                })
            } else {
                // Fallback to public-style eligibility
                setEligibilityData({
                    isEligible: true,
                    droidsOwned: 0,
                    batteriesAvailable: 10,
                    batteriesMinted: 0,
                    checkedAddress: address
                })
            }
        } finally {
            setIsLoading(false)
        }
    }

    const handleManualCheck = () => {
        if (manualAddress.startsWith("0x") && manualAddress.length === 42) {
            checkEligibility(manualAddress)
        }
    }

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleManualCheck()
        }
    }

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
                        className="relative w-full max-w-md bg-[#0a0a0a] border border-white/15 rounded-3xl p-8 flex flex-col gap-6 shadow-[0_0_50px_rgba(0,0,0,0.8)]"
                    >
                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 text-white/30 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>

                        {/* Title */}
                        <h2 className="text-xl font-black text-white uppercase tracking-widest text-center">
                            Check Eligibility
                        </h2>

                        {/* Если кошелек НЕ подключен - показываем поле ввода */}
                        {!account?.address && !eligibilityData && (
                            <div className="flex flex-col gap-4">
                                <p className="text-white/50 text-sm text-center">
                                    Enter a wallet address to check eligibility
                                </p>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={manualAddress}
                                        onChange={(e) => setManualAddress(e.target.value)}
                                        onKeyPress={handleKeyPress}
                                        placeholder="0x..."
                                        className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-4 pr-12 text-white font-mono text-sm placeholder:text-white/30 focus:outline-none focus:border-[#0069FF] transition-colors"
                                    />
                                    <button
                                        onClick={handleManualCheck}
                                        disabled={!manualAddress.startsWith("0x") || manualAddress.length !== 42}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-[#0069FF] disabled:opacity-30 disabled:hover:bg-white/10 transition-colors"
                                    >
                                        <Search size={16} />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Loading state */}
                        {isLoading && (
                            <div className="flex flex-col items-center justify-center py-12 gap-4">
                                <Loader2 size={48} className="text-[#0069FF] animate-spin" />
                                <p className="text-white/50 text-sm font-mono">Checking contract data...</p>
                            </div>
                        )}

                        {/* Results */}
                        {eligibilityData && !isLoading && (
                            <div className="flex flex-col gap-6">
                                {/* Status */}
                                <div className="flex items-center justify-center gap-3 py-4">
                                    {eligibilityData.isEligible ? (
                                        <>
                                            <CheckCircle size={32} className="text-green-500" />
                                            <span className="text-xl font-bold text-green-500">Eligible</span>
                                        </>
                                    ) : (
                                        <>
                                            <XCircle size={32} className="text-red-500" />
                                            <span className="text-xl font-bold text-red-500">Not Eligible</span>
                                        </>
                                    )}
                                </div>

                                {/* Details */}
                                <div className="bg-white/5 rounded-xl p-5 space-y-4">
                                    <div className="flex justify-between items-center">
                                        <span className="text-white/50 text-sm">Wallet</span>
                                        <span className="text-white font-mono text-xs">
                                            {eligibilityData.checkedAddress.slice(0, 6)}...{eligibilityData.checkedAddress.slice(-4)}
                                        </span>
                                    </div>

                                    {phaseType === 'holders' && (
                                        <>
                                            <div className="h-px bg-white/10" />
                                            <div className="flex justify-between items-center">
                                                <span className="text-white/50 text-sm">ApeDroidz Owned</span>
                                                <span className="text-white font-bold">{eligibilityData.droidsOwned}</span>
                                            </div>
                                        </>
                                    )}

                                    <div className="h-px bg-white/10" />
                                    <div className="flex justify-between items-center">
                                        <span className="text-white/50 text-sm">Batteries Available</span>
                                        <span className={`font-bold ${eligibilityData.isEligible ? 'text-green-500' : 'text-red-500'}`}>
                                            {eligibilityData.batteriesAvailable}
                                        </span>
                                    </div>

                                    <div className="h-px bg-white/10" />
                                    <div className="flex justify-between items-center">
                                        <span className="text-white/50 text-sm">Already Minted</span>
                                        <span className="text-white font-bold">{eligibilityData.batteriesMinted}</span>
                                    </div>
                                </div>

                                {/* Check another address (if not connected) */}
                                {!account?.address && (
                                    <button
                                        onClick={() => {
                                            setEligibilityData(null)
                                            setManualAddress("")
                                        }}
                                        className="text-white/40 text-xs uppercase tracking-widest hover:text-white underline transition-colors"
                                    >
                                        Check Another Address
                                    </button>
                                )}

                                {/* Close button */}
                                <button
                                    onClick={onClose}
                                    className="w-full h-12 bg-white text-black font-bold uppercase tracking-wider rounded-xl hover:bg-[#0069FF] hover:text-white transition-all"
                                >
                                    Got it
                                </button>
                            </div>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}