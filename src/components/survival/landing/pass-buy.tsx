'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useActiveAccount, useConnectModal, useSendTransaction } from 'thirdweb/react'
import { createWallet } from 'thirdweb/wallets'
import { prepareTransaction, toWei } from 'thirdweb'
import { Check, Loader2, Play, Ticket, X } from 'lucide-react'
import { client, apeChain } from '@/lib/thirdweb'
import { useGlitchSession } from '@/hooks/useGlitchSession'
import { cancelOrder, isUserRejection, reportPayment, requestOrder } from '@/lib/survivalHostPay'
import { ACCENT_BTN, LABEL_CLASS } from '@/components/landing/ui'
import { Ape, ape, LiveDot, PlayLink, POOL_SEASON, utc, type Pool } from './shared'
import { PassCard, PassTrack, Podium, SPARK, SparkBurst } from './pass-parts'

/**
 * The season pass bought on the landing itself (owner, 16.10.2026: «добавить на лендинге
 * возможность купить пасс, а не отправлять человека в игру; и детали — окно с преимуществами»).
 *
 * The same door as the game's Season screen, only opened from here: the server makes the order
 * (api/survival/order — the price, the holder discount, one pass per season), the wallet pays the
 * cashier, the server books it from the chain's Paid event (api/survival/pay). The rules of
 * lib/survivalHostPay.ts hold: one payment at a time, «sent» counts as yes, a refusal in the
 * wallet closes the order. The pass lands as an entitlement the game claims on its next load.
 *
 * Without NEXT_PUBLIC_SURVIVAL_PAY_FOR_REAL (the same switch as the play page) nothing is charged
 * here: the button goes to the game as before. `next dev` shows the flow (there is no cashier locally:
 * the order answers «Payments are not open yet»).
 */
export const PAY_FOR_REAL = process.env.NEXT_PUBLIC_SURVIVAL_PAY_FOR_REAL === '1' || process.env.NODE_ENV === 'development'

const WALLETS = [createWallet('io.metamask'), createWallet('com.coinbase.wallet'), createWallet('me.rainbow')]

type Step = 'idle' | 'connect' | 'sign' | 'order' | 'wallet' | 'confirm' | 'done'

export interface PassBuy {
    step: Step
    /** true — this wallet holds the season's pass; null — not known (no wallet, not signed in). */
    owned: boolean | null
    error: string | null
    /** What the next click does. */
    next: 'connect' | 'sign' | 'buy'
    busy: boolean
    act: () => void
}

/** The server's no, in words a player can act on. */
const ORDER_NO: Record<string, string> = {
    pending: 'Your pass payment is being confirmed — give it a few minutes.',
    unknown_item: 'The pass is not on sale right now.',
    no_season: 'No season is live right now.',
    season_over: 'This season is over — the next pass opens with the next season.',
    rate_limited: 'Too many orders in an hour. Try again a bit later.',
    no_access: 'This wallet has no access to the game.',
    mode_closed: 'The pass is not on sale right now.',
    not_configured: 'Payments are not open yet.',
}

export function usePassBuy(sku: string | null): PassBuy {
    const account = useActiveAccount()
    const { connect } = useConnectModal()
    const { authedWallet, ensureLogin, lastError } = useGlitchSession()
    // thirdweb's Buy / Deposit window for a wallet short of APE stays on, with our name on it.
    const { mutateAsync: sendTx } = useSendTransaction({ payModal: { metadata: { name: 'Droidz Survival' } } })
    const [step, setStep] = useState<Step>('idle')
    const [owned, setOwned] = useState<boolean | null>(null)
    const [error, setError] = useState<string | null>(null)
    const addr = account?.address?.toLowerCase() ?? null
    const signed = !!addr && authedWallet === addr
    /** One purchase at a time — a double click opens no second order. */
    const inflight = useRef(false)
    /** BUY was clicked with no wallet: carry on once it connects. */
    const wantRef = useRef(false)

    // Does this wallet already hold the pass? Asked once it is signed in (the forecast names it).
    useEffect(() => {
        setOwned(null)
        if (!signed) return
        let alive = true
        fetch('/api/survival/pool/forecast', { credentials: 'include', cache: 'no-store' })
            .then((r) => r.json()).then((f: { ok?: boolean; me?: { hasPass?: boolean } }) => { if (alive && f?.ok) setOwned(!!f.me?.hasPass) })
            .catch(() => undefined)
        return () => { alive = false }
    }, [signed, addr])

    const buy = useCallback(async () => {
        if (!sku) return
        setStep('order')
        const o = await requestOrder(sku, 'site')
        if (!o.ok) {
            setStep('idle')
            if (o.state === 'owned') { setOwned(true); return }
            setError(o.state === 'unauthenticated' ? 'Your sign-in ran out — sign in again.' : ORDER_NO[o.state] ?? 'Could not start the purchase. Try again.')
            return
        }
        setStep('wallet')
        let hash: string
        try {
            const tx = prepareTransaction({ chain: apeChain, client, to: o.to as `0x${string}`, value: toWei(o.valueApe), data: o.data as `0x${string}` })
            hash = (await sendTx(tx)).transactionHash
        } catch (e) {
            setStep('idle')
            if (isUserRejection(e)) cancelOrder(o.orderId)
            else setError('The wallet did not send the payment. Try again.')
            return
        }
        setStep('confirm')
        // Sent: yes, unless the server says a definite no (a slow server is not a no).
        const state = await reportPayment(hash, o.orderId)
        if (state === 'paid' || state === 'sent') { setStep('done'); setOwned(true); return }
        setStep('idle')
        setError(state === 'late'
            ? 'Your payment arrived more than an hour after the order was made. Support will settle it — open a ticket in Discord.'
            : 'The payment was not accepted. If APE left your wallet, open a ticket in Discord.')
    }, [sku, sendTx])

    const run = useCallback(async (fn: () => Promise<void>) => {
        if (inflight.current) return
        inflight.current = true
        setError(null)
        try { await fn() } finally { inflight.current = false }
    }, [])

    // Connected after a BUY click: on a desktop the signature asks for itself and the purchase
    // goes on; a phone (its wallet opens only from a tap) keeps the button, now «Sign in & buy».
    useEffect(() => {
        if (!addr || !wantRef.current) return
        wantRef.current = false
        void run(async () => {
            setStep('sign')
            const ok = await ensureLogin({ auto: true })
            setStep('idle')
            if (ok) await buy()
        })
    }, [addr, ensureLogin, buy, run])

    const act = useCallback(() => {
        if (!account) {
            wantRef.current = true
            setStep('connect')
            connect({ client, chain: apeChain, wallets: WALLETS, size: 'compact', title: 'ApeDroidz Access', showThirdwebBranding: false })
                .catch(() => { wantRef.current = false })
                .finally(() => setStep((s) => (s === 'connect' ? 'idle' : s)))
            return
        }
        void run(async () => {
            if (!signed) {
                // Nothing with the network before the signature: a phone's wallet opens only inside the tap.
                setStep('sign')
                const ok = await ensureLogin()
                if (!ok) { setStep('idle'); setError(lastError() ?? 'The signature is needed to buy.'); return }
            }
            await buy()
        })
    }, [account, connect, run, signed, ensureLogin, lastError, buy])

    return {
        step, owned, error, act,
        next: !account ? 'connect' : !signed ? 'sign' : 'buy',
        busy: step !== 'idle' && step !== 'done',
    }
}

const BUSY_LABEL: Partial<Record<Step, string>> = {
    connect: 'Connecting…', sign: 'Sign in your wallet…', order: 'Preparing…', wallet: 'Confirm in your wallet…', confirm: 'Confirming payment…',
}

/**
 * GET THE PASS and the line under it. Owned — a quiet «yours» and PLAY; no real payments — the
 * game's door, as before.
 */
export function PassBuyButton({ buy, price, className = '', wide = false, compact = false }: {
    buy: PassBuy; price: number | null; className?: string
    /** The button fills its column, without the price on it (the window shows the price right above). */
    wide?: boolean
    /** The phone's bar at the window's foot: the line under the button only when it is an error. */
    compact?: boolean
}) {
    if (!PAY_FOR_REAL) {
        return (
            <PlayLink testId="play-pass" className={`${ACCENT_BTN} ${wide ? 'w-full' : ''} ${className}`}>
                <Ticket className="h-4 w-4" /> Get the pass
            </PlayLink>
        )
    }
    if (buy.owned) {
        return (
            <div className={className}>
                <div className={`flex flex-wrap items-center gap-3 ${wide ? '[&>*]:flex-1 [&>*]:justify-center' : ''}`}>
                    <span className="inline-flex items-center gap-2 rounded-full border border-[#FFCF4A]/40 bg-[#FFCF4A]/10 px-6 py-4 text-sm font-black uppercase tracking-widest text-[#FFCF4A]">
                        <Check className="h-4 w-4" /> The pass is yours
                    </span>
                    <PlayLink testId="play-pass" className={ACCENT_BTN}><Play className="h-4 w-4" fill="currentColor" /> Play</PlayLink>
                </div>
                <p className="mt-3 text-xs text-white/50">
                    {buy.step === 'done' ? 'Paid. The pass and its rewards are waiting in the game.' : `This wallet holds the Season ${POOL_SEASON} pass.`}
                </p>
            </div>
        )
    }
    const label = buy.busy ? BUSY_LABEL[buy.step] : buy.next === 'sign' ? 'Sign in & buy' : 'Buy the pass'
    return (
        <div className={className}>
            <button type="button" data-testid="buy-pass" onClick={buy.act} disabled={buy.busy} className={`${ACCENT_BTN} ${wide ? 'w-full !px-6' : ''} disabled:cursor-wait disabled:opacity-80 disabled:hover:bg-[#0069FF] disabled:hover:text-white`}>
                {buy.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                {label}
                {!buy.busy && (!wide || compact) && price != null && <span className="font-semibold normal-case tracking-normal opacity-80">· {ape(price)} <Ape /></span>}
            </button>
            {(!compact || buy.error) && <p aria-live="polite" className={`mt-3 text-xs ${buy.error ? 'text-[#FF5A6A]' : 'text-white/45'}`}>
                {buy.error
                    ?? (buy.next === 'connect' ? 'Paid in APE on ApeChain, straight from your wallet.'
                        : buy.next === 'sign' ? 'One free signature proves the wallet is yours.'
                            : 'ApeDroidz holders get their discount at checkout.')}
            </p>}
        </div>
    )
}

// ── The window ───────────────────────────────────────────────────────────────────────────────────

/**
 * What the pass gives, on one screen (owner, 17.10.2026: «уместить в экран, меньше инфы — всё
 * нагромождено; прогресс пропуска показать как прогресс, призы едут; Ape Mini не надо; Spark colours
 * в конце; акцент на пропуск»). Left: the card, large and alive, its price and BUY. Right: the pool
 * (live, and how it is cut, drawn), the PASS track riding past, the spark colours to close.
 * On a phone it is a sheet: the card beside the price on top, BUY pinned to its foot.
 * Closes on Esc, the cross or a click outside; the page under it does not scroll.
 */
export function PassModal({ onClose, buy, price, holderPrice, pool }: {
    onClose: () => void; buy: PassBuy; price: number | null; holderPrice: number | null; pool: Pool | null | undefined
}) {
    const box = useRef<HTMLDivElement>(null)
    const close = useRef<HTMLButtonElement>(null)
    const onCloseRef = useRef(onClose)
    useEffect(() => { onCloseRef.current = onClose }, [onClose])

    useEffect(() => {
        const opener = document.activeElement as HTMLElement | null
        close.current?.focus()
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const onKey = (e: KeyboardEvent) => {
            // The wallet's own window (thirdweb, outside this box) keeps its keys.
            const active = document.activeElement
            const ours = !!box.current && (box.current.contains(active) || active === document.body)
            if (e.key === 'Escape' && ours) { e.preventDefault(); onCloseRef.current(); return }
            if (e.key !== 'Tab' || !box.current || !ours) return
            const f = Array.from(box.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
            if (f.length === 0) return
            const first = f[0], last = f[f.length - 1]
            if (e.shiftKey && (active === first || !box.current.contains(active))) { e.preventDefault(); last.focus() }
            else if (!e.shiftKey && (active === last || !box.current.contains(active))) { e.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; opener?.focus?.() }
    }, [])

    const live = pool?.paysOut && pool.endsAt ? pool : null
    const endDay = live?.endsAt ? utc(new Date(live.endsAt).toISOString()).replace(/, .*/, '') : null

    // Into <body>: inside the page's z-10 layer the site header (z-50) would sit over it.
    return createPortal(
        <div className="fixed inset-0 z-[400] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
            <div
                ref={box}
                role="dialog"
                aria-modal="true"
                aria-labelledby="pass-modal-title"
                className="relative flex max-h-[94svh] w-full max-w-[1060px] flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0b0b0d] shadow-[0_40px_120px_rgba(0,0,0,0.6)] sm:rounded-3xl"
            >
                <button ref={close} onClick={onClose} aria-label="Close" className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur transition-colors hover:bg-white hover:text-black">
                    <X className="h-4 w-4" />
                </button>

                <div className="grid min-h-0 flex-1 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
                    {/* The stage: the card in its gold light, the price, BUY. */}
                    <aside className="relative overflow-hidden border-white/10 px-6 pb-5 pt-7 lg:flex lg:flex-col lg:items-center lg:justify-center lg:border-r lg:px-10 lg:py-10">
                        <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_40%,rgba(255,207,74,0.10),transparent_70%)]" />
                        <div className="relative flex items-center gap-6 lg:flex-col lg:gap-8">
                            <div className="w-[104px] shrink-0 lg:w-auto"><PassCard width="clamp(104px, 17vw, 200px)" /></div>
                            <div className="min-w-0 lg:text-center">
                                <div className={`${LABEL_CLASS} text-[#FFCF4A]/80`}>Season {POOL_SEASON} pass</div>
                                <div className="mt-2 flex items-baseline gap-2 font-semibold tabular-nums tracking-tight lg:justify-center">
                                    <span className="text-5xl leading-none text-white">{price != null ? ape(price) : '—'}</span>
                                    <Ape className="text-2xl leading-none text-white/55" />
                                </div>
                                {holderPrice != null && <p className="mt-2 text-sm text-white/55">{ape(holderPrice)} <Ape /> for ApeDroidz holders</p>}
                            </div>
                        </div>
                        <PassBuyButton buy={buy} price={price} wide className="relative mt-8 hidden w-full lg:block" />
                    </aside>

                    <div className="flex min-w-0 flex-col gap-7 px-6 pb-6 pt-2 lg:justify-center lg:gap-9 lg:px-10 lg:py-10">
                        <h3 id="pass-modal-title" className="hidden pr-12 text-2xl font-semibold tracking-tight lg:block">What the pass gives</h3>

                        {/* The pool — the reason to hold the pass. */}
                        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                            <div className="flex items-start justify-between gap-5">
                                <div className="min-w-0">
                                    <div className={`${LABEL_CLASS} flex items-center gap-2 text-white/45`}><LiveDot color="#34D399" /> Prize pool</div>
                                    <div className="mt-2 text-4xl font-semibold tabular-nums tracking-tight">{pool ? ape(pool.poolApe) : '—'} <Ape className="text-2xl text-white/55" /></div>
                                    <p className="mt-2 text-sm leading-snug text-white/55">
                                        Only pass holders share it, by their best score{endDay ? <> — paid out {endDay}</> : null}.
                                    </p>
                                </div>
                                <div className="shrink-0 pt-1">
                                    <Podium />
                                    <p className="mt-1.5 text-right font-mono text-[9px] uppercase tracking-wider text-white/30">Top 10% paid</p>
                                </div>
                            </div>
                        </section>

                        {/* The PASS track, riding. */}
                        <section>
                            <div className="mb-2 flex items-baseline justify-between gap-3">
                                <h4 className="text-base font-semibold tracking-tight">Pass rewards</h4>
                                <span className="text-xs text-white/40">Climb 20 tiers by playing</span>
                            </div>
                            <PassTrack />
                        </section>

                        {/* And to close: the colours nobody without the pass has. */}
                        <section className="flex items-center gap-4">
                            <div className="flex -space-x-1">
                                {Object.values(SPARK).map((c) => <SparkBurst key={c} color={c} size={34} />)}
                            </div>
                            <p className="text-sm text-white/60"><span className="font-semibold text-white">+ 4 spark colours</span> only pass holders get.</p>
                        </section>
                    </div>
                </div>

                {/* On a phone BUY stays at the sheet's foot. */}
                <div className="border-t border-white/10 bg-[#0b0b0d] px-5 py-4 lg:hidden">
                    <PassBuyButton buy={buy} price={price} wide compact />
                </div>
            </div>
        </div>,
        document.body,
    )
}
