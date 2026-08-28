"use client"

import { useEffect, useMemo, useState } from "react"
import { Inventory } from "@/app/upgrade_module/inventory"
import { NFTItem } from "@/app/upgrade_module/page"
import { formatMultiplier, multiplierX100Of } from "@/lib/locker"
import { StakingShell } from "../staking-shell"
import { useStakingData } from "../use-staking-data"
import { LockPanel, type Quote } from "../lock-panel"
import { LockFlowModal } from "../lock-flow-modal"
import { ComingSoonPanel } from "../coming-soon-panel"

export default function LifetimeLockPage() {
    const { account, connected, droids, isLoading, state, collection, personal, refreshAll } = useStakingData()

    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [quote, setQuote] = useState<Quote | null>(null)
    const [isQuoting, setIsQuoting] = useState(false)
    const [isFlowOpen, setIsFlowOpen] = useState(false)

    // Priced by the server, so the figure shown before signing is the one recorded afterwards.
    useEffect(() => {
        if (!account?.address || selectedIds.length === 0) {
            setQuote(null)
            return
        }
        let cancelled = false
        setIsQuoting(true)
        ;(async () => {
            try {
                const res = await fetch('/api/locker/state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ owner: account.address, tokenIds: selectedIds }),
                })
                const data = await res.json()
                if (!cancelled && res.ok) setQuote(data)
            } catch (e) {
                console.error('[staking] quote failed:', e)
            } finally {
                if (!cancelled) setIsQuoting(false)
            }
        })()
        return () => { cancelled = true }
    }, [account?.address, selectedIds])

    const toggleSelect = (item: NFTItem | null) => {
        if (!item) return
        if (state.lockedTokenIds.includes(item.id)) return
        setSelectedIds((prev) => (prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]))
    }

    const selectedDroids = useMemo(
        () => selectedIds.map((id) => droids.find((d) => d.id === id)).filter(Boolean) as NFTItem[],
        [selectedIds, droids],
    )

    // The whole flow hangs off the lock registry. Until that contract is deployed and its address
    // is set, there is nothing a holder could actually do here — so the page shows the teaser
    // instead of an interface whose only button says "not live yet". Setting
    // NEXT_PUBLIC_LOCK_REGISTRY_ADDRESS flips it live with no code change.
    if (!state.registryConfigured) {
        return (
            <StakingShell title="Lifetime Lock" collection={collection} personal={personal} connected={connected}>
                <div className="flex-1 min-h-0">
                    <ComingSoonPanel variant="lifetime" />
                </div>
            </StakingShell>
        )
    }

    return (
        <StakingShell
            title="Lifetime Lock"
            collection={collection}
            personal={personal}
            connected={connected}
        >
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-5 gap-5 lg:gap-6">
                <div className="lg:col-span-3 min-h-[560px] lg:min-h-0 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-5">
                    <LockPanel
                        selected={selectedDroids}
                        quote={quote}
                        isQuoting={isQuoting}
                        freemintsHeld={state.freemints}
                        registryConfigured={state.registryConfigured}
                        onContinue={() => setIsFlowOpen(true)}
                        onClear={() => setSelectedIds([])}
                    />
                </div>

                <div className="lg:col-span-2 min-h-[420px] lg:min-h-0 shadow-2xl shadow-black/50 rounded-2xl">
                    <Inventory
                        title="Your Droidz"
                        items={droids}
                        selectedIds={selectedIds}
                        disabledIds={state.lockedTokenIds}
                        disabledLabel="Locked"
                        onSelect={toggleSelect}
                        type="droid"
                        showDetails={false}
                        isLoading={isLoading}
                        onRefresh={refreshAll}
                        // The multiplier belongs on the droid, where the choice is made.
                        cardBadge={(item) => ({
                            label: formatMultiplier(multiplierX100Of({ level: item.level, is_super: item.metadata?.is_super })),
                        })}
                    />
                </div>
            </div>

            <LockFlowModal
                isOpen={isFlowOpen}
                onClose={() => setIsFlowOpen(false)}
                selected={selectedDroids}
                quote={quote}
                onLocked={async () => {
                    setSelectedIds([])
                    await refreshAll()
                }}
            />
        </StakingShell>
    )
}
