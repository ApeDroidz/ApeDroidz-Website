"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useActiveAccount } from "thirdweb/react"
import { NFTItem } from "@/app/upgrade_module/page"
import { resolveImageUrl } from "@/lib/utils"
import type { CollectionStats } from "./staking-shell"

export type StakingState = {
    registryConfigured: boolean
    pointsX100: number
    freemints: number
    remainderX100: number
    droidsLocked: number
    lockedTokenIds: string[]
}

const EMPTY_STATE: StakingState = {
    registryConfigured: false,
    pointsX100: 0,
    freemints: 0,
    remainderX100: 0,
    droidsLocked: 0,
    lockedTokenIds: [],
}

/**
 * Everything both staking tabs need, in one place.
 *
 * Lifetime and Working are separate routes now, and each still has to show the same header numbers.
 * Sharing the fetching here keeps the two pages from drifting apart the way the desktop and mobile
 * menus once did.
 */
export function useStakingData() {
    const account = useActiveAccount()

    const [droids, setDroids] = useState<NFTItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [state, setState] = useState<StakingState>(EMPTY_STATE)
    const [collection, setCollection] = useState<CollectionStats | null>(null)

    const fetchDroids = useCallback(async () => {
        if (!account?.address) {
            setDroids([])
            setIsLoading(false)
            return
        }
        setIsLoading(true)
        try {
            const res = await fetch(`/api/owned-droids?owner=${account.address}`, { cache: 'no-store' })
            const data = await res.json().catch(() => ({}))
            setDroids((data?.droids || []).map((d: any) => ({
                id: d.id,
                tokenId: d.tokenId,
                name: d.name,
                image: resolveImageUrl(d.image),
                type: 'droid' as const,
                level: d.level ?? 1,
                metadata: { attributes: d.attributes, is_super: d.is_super },
            })))
        } catch (e) {
            console.error('[staking] failed to load droids:', e)
        } finally {
            setIsLoading(false)
        }
    }, [account?.address])

    const fetchState = useCallback(async () => {
        if (!account?.address) {
            setState(EMPTY_STATE)
            return
        }
        try {
            const res = await fetch(`/api/locker/state?owner=${account.address}`, { cache: 'no-store' })
            const data = await res.json().catch(() => ({}))
            if (res.ok) setState({ ...EMPTY_STATE, ...data })
        } catch (e) {
            console.error('[staking] failed to load state:', e)
        }
    }, [account?.address])

    const fetchCollection = useCallback(async () => {
        try {
            const res = await fetch('/api/locker/stats', { cache: 'no-store' })
            if (res.ok) setCollection(await res.json())
        } catch (e) {
            console.error('[staking] failed to load collection stats:', e)
        }
    }, [])

    useEffect(() => { fetchDroids(); fetchState() }, [fetchDroids, fetchState])
    useEffect(() => { fetchCollection() }, [fetchCollection])

    const lockableLeft = useMemo(
        () => droids.filter((d) => !state.lockedTokenIds.includes(d.id)).length,
        [droids, state.lockedTokenIds],
    )

    const refreshAll = useCallback(
        async () => { await Promise.all([fetchDroids(), fetchState(), fetchCollection()]) },
        [fetchDroids, fetchState, fetchCollection],
    )

    return {
        account,
        connected: Boolean(account?.address),
        droids,
        isLoading,
        state,
        collection,
        lockableLeft,
        refreshAll,
        personal: {
            droidsLocked: state.droidsLocked,
            freemints: state.freemints,
            remainderX100: state.remainderX100,
            lockableLeft,
        },
    }
}
