"use client"

import { StakingShell } from "../staking-shell"
import { useStakingData } from "../use-staking-data"
import { ComingSoonPanel } from "../coming-soon-panel"

export default function WorkingPage() {
    const { connected, state, collection, personal } = useStakingData()

    return (
        <StakingShell title="Working" collection={collection} personal={personal} connected={connected}>
            <div className="flex-1 min-h-0">
                <ComingSoonPanel variant="working" lockedCount={state.droidsLocked} />
            </div>
        </StakingShell>
    )
}
