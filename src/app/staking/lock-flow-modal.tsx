"use client"

import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { getContract, prepareContractCall, waitForReceipt } from "thirdweb"
import { useActiveAccount, useSendTransaction } from "thirdweb/react"
import { client, apeChain } from "@/lib/thirdweb"
import { Check, ExternalLink, Loader2, Lock, ShieldAlert, TriangleAlert, X } from "lucide-react"
import { NFTItem } from "@/app/upgrade_module/page"
import { useGlitchSession } from "@/hooks/useGlitchSession"
import { LOCK_ACKNOWLEDGEMENT, TIER_LABEL, type DroidTier } from "@/lib/locker"
import type { Quote } from "./lock-panel"

type Step = 'listings' | 'confirm' | 'locking' | 'done'

type Operator = { address: string; label: string }

type Result = {
    txHash: string
    droidCount: number
    freemintsAfter: number
    freemintsGained: number
}

const DROID_CONTRACT = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ""
const LOCK_REGISTRY = process.env.NEXT_PUBLIC_LOCK_REGISTRY_ADDRESS || ""

const STEP_ORDER: Step[] = ['listings', 'confirm', 'locking']
const STEP_TITLE: Record<Step, string> = {
    listings: 'Clear your listings',
    confirm: 'Confirm the exchange',
    locking: 'Lock forever',
    done: 'Locked forever',
}

export function LockFlowModal({
    isOpen,
    onClose,
    selected,
    quote,
    onLocked,
}: {
    isOpen: boolean
    onClose: () => void
    selected: NFTItem[]
    quote: Quote | null
    onLocked: (result: Result) => void
}) {
    const account = useActiveAccount()
    const { mutateAsync: sendTx } = useSendTransaction()
    const { ensureLogin } = useGlitchSession()

    const [step, setStep] = useState<Step>('listings')
    const [operators, setOperators] = useState<Operator[] | null>(null)
    const [checking, setChecking] = useState(false)
    const [revoking, setRevoking] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<Result | null>(null)

    // ── Step 1: which marketplace operators can still move these droids? ─────────────────────
    const checkListings = useCallback(async () => {
        if (!account?.address) return
        setChecking(true)
        setError(null)
        try {
            const res = await fetch(`/api/locker/preflight?owner=${account.address}`, { cache: 'no-store' })
            const data = await res.json()
            if (!res.ok) throw new Error(data?.error || 'Could not check your approvals')
            setOperators(data.operators || [])
        } catch (e: any) {
            setError(e.message)
            setOperators(null)
        } finally {
            setChecking(false)
        }
    }, [account?.address])

    useEffect(() => {
        if (!isOpen) return
        setStep('listings')
        setError(null)
        setResult(null)
        checkListings()
    }, [isOpen, checkListings])

    const revoke = async (operator: string) => {
        setRevoking(operator)
        setError(null)
        try {
            const contract = getContract({ client, chain: apeChain, address: DROID_CONTRACT })
            const tx = prepareContractCall({
                contract,
                method: "function setApprovalForAll(address operator, bool approved)",
                params: [operator, false],
            })
            const sent = await sendTx(tx)
            await waitForReceipt({ client, chain: apeChain, transactionHash: sent.transactionHash })
            await checkListings()
        } catch (e: any) {
            setError(e?.message?.includes('rejected') ? 'You rejected the transaction.' : (e?.message || 'Revoke failed'))
        } finally {
            setRevoking(null)
        }
    }

    // ── Step 3: the lock itself ──────────────────────────────────────────────────────────────
    const doLock = async () => {
        if (!account?.address || selected.length === 0) return
        setBusy(true)
        setError(null)
        setStep('locking')

        try {
            // Sign in first: a lock that cannot be recorded afterwards would still be permanent
            // on-chain, so this must never fail *after* the transaction.
            const authed = await ensureLogin()
            if (!authed) throw new Error('Please sign the login message before locking.')

            const tokenIds = selected.map((d) => BigInt(d.tokenId || d.id))
            const registry = getContract({ client, chain: apeChain, address: LOCK_REGISTRY })

            const tx = tokenIds.length === 1
                ? prepareContractCall({
                    contract: registry,
                    method: "function lockForever(uint256 tokenId, bytes32 acknowledgement)",
                    params: [tokenIds[0], LOCK_ACKNOWLEDGEMENT as `0x${string}`],
                })
                : prepareContractCall({
                    contract: registry,
                    method: "function lockForeverBatch(uint256[] tokenIds, bytes32 acknowledgement)",
                    params: [tokenIds, LOCK_ACKNOWLEDGEMENT as `0x${string}`],
                })

            const sent = await sendTx(tx)
            await waitForReceipt({ client, chain: apeChain, transactionHash: sent.transactionHash })

            // The server re-reads the lock off the chain; it does not take our word for it.
            const res = await fetch('/api/locker/commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ txHash: sent.transactionHash }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data?.error || 'Locked on-chain, but recording it failed.')

            const outcome: Result = {
                txHash: sent.transactionHash,
                droidCount: data.droidCount,
                freemintsAfter: data.freemintsAfter,
                freemintsGained: data.freemintsGained,
            }
            setResult(outcome)
            setStep('done')
            onLocked(outcome)
        } catch (e: any) {
            const message = e?.message || 'Lock failed'
            setError(message.includes('rejected') || message.includes('denied')
                ? 'You rejected the transaction. Nothing was locked.'
                : message)
            setStep('confirm')
        } finally {
            setBusy(false)
        }
    }

    if (!isOpen) return null

    const listingsClear = operators !== null && operators.length === 0
    const tierCounts = (quote?.items || []).reduce<Record<string, number>>((acc, i) => {
        acc[i.tier] = (acc[i.tier] || 0) + 1
        return acc
    }, {})

    return (
        <AnimatePresence>
            <motion.div
                className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => { if (!busy && revoking === null) onClose() }}
            >
                <motion.div
                    className="relative w-full max-w-lg rounded-2xl border border-white/15 bg-[#0a0a0a] shadow-2xl overflow-hidden"
                    initial={{ opacity: 0, y: 20, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.98 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header + step rail */}
                    <div className="px-6 pt-5 pb-4 border-b border-white/10">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-black uppercase tracking-wider text-white">{STEP_TITLE[step]}</h2>
                            {!busy && revoking === null && (
                                <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer">
                                    <X size={16} className="text-white icon-dim-50" />
                                </button>
                            )}
                        </div>

                        {step !== 'done' && (
                            <div className="mt-4 flex items-center gap-2">
                                {STEP_ORDER.map((s, i) => {
                                    const active = s === step
                                    const passed = STEP_ORDER.indexOf(step) > i
                                    return (
                                        <div key={s} className="flex items-center gap-2 flex-1">
                                            <div className={`h-1.5 flex-1 rounded-full transition-colors ${passed ? 'bg-green-400/70' : active ? 'bg-white' : 'bg-white/15'}`} />
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    <div className="px-6 py-5 max-h-[60vh] overflow-y-auto custom-scrollbar">
                        {/* ── STEP 1 — listings ───────────────────────────────────────────── */}
                        {step === 'listings' && (
                            <div>
                                <p className="text-[11px] font-mono text-white/50 leading-relaxed">
                                    A locked droid can never be sold, so any listing left standing would just fail at
                                    checkout and confuse a buyer. Revoking marketplace approval kills those orders
                                    everywhere at once — on every marketplace, including ones we have not integrated with.
                                </p>

                                {checking && (
                                    <div className="mt-5 flex items-center gap-2 text-white/50 text-xs font-mono">
                                        <Loader2 size={14} className="animate-spin" /> Reading your approvals from the chain…
                                    </div>
                                )}

                                {!checking && listingsClear && (
                                    <div className="mt-5 flex items-center gap-3 rounded-xl border border-green-400/25 bg-green-400/5 px-4 py-3">
                                        <Check size={16} className="text-green-400 flex-shrink-0" />
                                        <p className="text-[11px] font-bold text-green-300/90">
                                            No marketplace can move your droids. Nothing to cancel.
                                        </p>
                                    </div>
                                )}

                                {!checking && operators && operators.length > 0 && (
                                    <div className="mt-5 space-y-2">
                                        {operators.map((op) => (
                                            <div key={op.address} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3">
                                                <div className="min-w-0">
                                                    <div className="text-xs font-bold text-white truncate">{op.label}</div>
                                                    <div className="text-[9px] font-mono text-white/30 truncate">{op.address}</div>
                                                </div>
                                                <button
                                                    onClick={() => revoke(op.address)}
                                                    disabled={revoking !== null}
                                                    className="flex-shrink-0 h-8 px-3.5 rounded-full bg-white text-black text-[10px] font-black uppercase tracking-wider hover:bg-red-500 hover:text-white transition-all disabled:opacity-40 cursor-pointer"
                                                >
                                                    {revoking === op.address ? <Loader2 size={12} className="animate-spin" /> : 'Revoke'}
                                                </button>
                                            </div>
                                        ))}
                                        <p className="pt-1 text-[10px] font-mono text-white/30 leading-relaxed">
                                            This also cancels listings on your other droids. You can approve again afterwards to
                                            keep trading the ones you did not lock.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── STEP 2 — confirm ────────────────────────────────────────────── */}
                        {step === 'confirm' && (
                            <div>
                                <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                                    <div className="text-[9px] uppercase tracking-[0.2em] font-black text-white/35">You are locking</div>
                                    <div className="mt-2 text-2xl font-black text-white">
                                        {selected.length} droid{selected.length === 1 ? '' : 's'}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase tracking-wider font-bold text-white/40">
                                        {(['lvl1', 'lvl2', 'lvl2super'] as DroidTier[]).map((t) =>
                                            tierCounts[t] ? (
                                                <span key={t} className={t === 'lvl2super' ? 'text-orange-400/80' : ''}>
                                                    {tierCounts[t]} × {TIER_LABEL[t]}
                                                </span>
                                            ) : null,
                                        )}
                                    </div>
                                    <div className="mt-3 text-[10px] font-mono text-white/40 leading-relaxed break-all">
                                        #{selected.map((d) => d.tokenId || d.id).join(', #')}
                                    </div>
                                </div>

                                <div className="mt-3 rounded-xl border border-yellow-300/20 bg-yellow-300/5 p-4">
                                    <div className="text-[9px] uppercase tracking-[0.2em] font-black text-yellow-300/60">You receive</div>
                                    <div className="mt-1 flex items-baseline gap-2">
                                        <span className="text-3xl font-black text-yellow-300">+{quote?.freemintsGained ?? 0}</span>
                                        <span className="text-xs font-bold text-yellow-300/70">
                                            guaranteed Gnanas freemint{(quote?.freemintsGained ?? 0) === 1 ? '' : 's'}
                                        </span>
                                    </div>
                                    <div className="mt-1 text-[10px] font-mono text-white/40">
                                        Total after this lock: {quote?.freemintsAfter ?? 0} freemints
                                        {quote && quote.remainderX100 > 0 && ` · ${(quote.remainderX100 / 100).toFixed(2)} carried over`}
                                    </div>
                                </div>

                                <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
                                    <ShieldAlert size={15} className="text-red-400 mt-0.5 flex-shrink-0" />
                                    <p className="text-[11px] font-bold text-red-300/90 leading-relaxed">
                                        This cannot be undone. Not by you, not by us, not by support. If you lose access to this
                                        wallet, these droids are gone with it.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* ── STEP 3 — locking ────────────────────────────────────────────── */}
                        {step === 'locking' && (
                            <div className="py-8 flex flex-col items-center text-center">
                                <Loader2 size={30} className="animate-spin text-white icon-dim-60" />
                                <p className="mt-4 text-xs font-bold uppercase tracking-wider text-white">Locking your droids</p>
                                <p className="mt-2 text-[11px] font-mono text-white/40 max-w-xs leading-relaxed">
                                    Confirm in your wallet, then leave this open while the transaction is mined and verified
                                    on-chain.
                                </p>
                            </div>
                        )}

                        {/* ── DONE ────────────────────────────────────────────────────────── */}
                        {step === 'done' && result && (
                            <div className="py-4 flex flex-col items-center text-center">
                                <div className="w-14 h-14 rounded-2xl bg-green-400/10 border border-green-400/30 flex items-center justify-center">
                                    <Lock size={24} className="text-green-400" />
                                </div>
                                <h3 className="mt-4 text-lg font-black uppercase tracking-tight text-white">Congratulations</h3>
                                <p className="mt-2 text-xs font-mono text-white/60 leading-relaxed max-w-xs">
                                    You permanently locked <strong className="text-white">{result.droidCount}</strong> droid
                                    {result.droidCount === 1 ? '' : 's'} and earned{' '}
                                    <strong className="text-yellow-300">{result.freemintsGained}</strong> Gnanas freemint
                                    {result.freemintsGained === 1 ? '' : 's'}.
                                </p>
                                <p className="mt-2 text-[11px] font-mono text-white/40">
                                    Total entitlement: {result.freemintsAfter} freemints
                                </p>
                                <a
                                    href={`https://apescan.io/tx/${result.txHash}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50 hover:text-white transition-colors"
                                >
                                    View transaction <ExternalLink size={11} />
                                </a>
                                <p className="mt-4 text-[10px] font-mono text-white/30 leading-relaxed max-w-xs">
                                    Their names now show as locked. Marketplaces may take a little while to re-index.
                                </p>
                            </div>
                        )}

                        {error && (
                            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                                <TriangleAlert size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
                                <p className="text-[11px] font-mono text-red-300 leading-relaxed">{error}</p>
                            </div>
                        )}
                    </div>

                    {/* Footer actions */}
                    <div className="px-6 py-4 border-t border-white/10 flex gap-3">
                        {step === 'listings' && (
                            <>
                                <button
                                    onClick={checkListings}
                                    disabled={checking || revoking !== null}
                                    className="h-11 px-5 rounded-full border border-white/15 text-white/60 text-[11px] font-black uppercase tracking-wider hover:bg-white/5 transition-all disabled:opacity-40 cursor-pointer"
                                >
                                    Re-check
                                </button>
                                <button
                                    onClick={() => setStep('confirm')}
                                    disabled={!listingsClear || checking}
                                    className="flex-1 h-11 rounded-full bg-white text-black text-[11px] font-black uppercase tracking-wider hover:bg-blue-600 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                >
                                    {listingsClear ? 'Continue' : 'Revoke to continue'}
                                </button>
                            </>
                        )}

                        {step === 'confirm' && (
                            <>
                                <button
                                    onClick={() => setStep('listings')}
                                    className="h-11 px-5 rounded-full border border-white/15 text-white/60 text-[11px] font-black uppercase tracking-wider hover:bg-white/5 transition-all cursor-pointer"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={doLock}
                                    disabled={busy}
                                    className="flex-1 h-11 rounded-full bg-red-500 text-white text-[11px] font-black uppercase tracking-wider hover:bg-red-400 transition-all disabled:opacity-40 cursor-pointer"
                                >
                                    Lock forever
                                </button>
                            </>
                        )}

                        {step === 'done' && (
                            <button
                                onClick={onClose}
                                className="flex-1 h-11 rounded-full bg-white text-black text-[11px] font-black uppercase tracking-wider hover:bg-blue-600 hover:text-white transition-all cursor-pointer"
                            >
                                Done
                            </button>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}
