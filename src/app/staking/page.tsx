import { redirect } from "next/navigation"

/**
 * Staking has two tabs and no landing of its own — /staking always means "the one that is open".
 * Keeping the bare route working means old links and the header both land somewhere real.
 */
export default function StakingIndex() {
    redirect("/staking/lifetime")
}
