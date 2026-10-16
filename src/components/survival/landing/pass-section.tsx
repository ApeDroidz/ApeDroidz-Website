'use client'

import { useState } from 'react'
import { ArrowUpRight, Gift, Sparkles, Trophy } from 'lucide-react'
import { LABEL_CLASS, Reveal } from '@/components/landing/ui'
import { Ape, ape, POOL_SEASON, POOL_SHARE, Section, type LandingPrice, type Pool } from './shared'
import { PassBuyButton, PassModal, usePassBuy } from './pass-buy'
import { PassCard } from './pass-parts'

// One short line each (owner, 04.10.2026: «текста слишком много»). From the game: the pool goes to
// pass holders (config/season.ts), the PASS reward on every tier, four spark colours only the pass gives.
const PASS_PERKS: Array<{ icon: typeof Trophy; title: string; line: string }> = [
    { icon: Trophy, title: 'The prize pool', line: 'Only pass holders share it.' },
    { icon: Gift, title: 'Pass rewards', line: 'A richer reward on every tier.' },
    { icon: Sparkles, title: 'Spark colours', line: 'Four colours only the pass gives.' },
]

/**
 * The season pass (owner, 03.10.2026: «больше акцента — картинка, что даёт, цена, что 50% цены
 * уходит в пул»). The order the eye takes: the card — the price — three perks — get it.
 *
 * The card is the game's Season 1 pass, alive (landing/pass-parts.tsx PassCard — owner, 17.10.2026:
 * «в этом блоке только карточку заменить на новую»; the block itself stays as it was). BUY buys it
 * right here (landing/pass-buy.tsx; owner, 16.10.2026); «What's inside» opens the window with the
 * pool, the PASS track and the sparks — the details live there, not here.
 */
export function PassSection({ prices, pool }: { prices: LandingPrice[]; pool: Pool | null | undefined }) {
    const pass = prices.find((p) => p.kind === 'season_pass')
    const price = pass?.fullPriceApe ?? null
    const holderPct = pass?.holderDiscountPct ?? 0
    const holderPrice = price != null && holderPct > 0 ? price * (1 - holderPct / 100) : null
    const buy = usePassBuy(pass?.sku ?? null)
    const [open, setOpen] = useState(false)
    return (
        <Section id="pass" label="Season pass" title="The pass is your ticket to the pool">
            <Reveal>
                <div className="grid items-center gap-10 rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
                    <div className="flex justify-center py-4">
                        <PassCard width="clamp(150px, 17vw, 210px)" />
                    </div>

                    <div className="min-w-0">
                        <div className={`${LABEL_CLASS} text-white/40`}>Season {POOL_SEASON} pass</div>
                        <div className="mt-3 flex items-baseline gap-3 font-semibold tabular-nums tracking-tight">
                            <span className="text-6xl leading-none text-white md:text-7xl">{price != null ? ape(price) : '—'}</span>
                            <Ape className="text-3xl leading-none text-white/55" />
                        </div>
                        {price != null && (
                            <p className="mt-3 text-sm text-white/50">
                                {holderPrice != null && <>{ape(holderPrice)} <Ape /> for ApeDroidz holders · </>}
                                {Math.round(POOL_SHARE * 100)}% goes into the pool
                            </p>
                        )}

                        <ul className="mt-9 grid gap-6 sm:grid-cols-3">
                            {PASS_PERKS.map((p) => (
                                <li key={p.title}>
                                    <p.icon className="h-5 w-5 text-white" />
                                    <p className="mt-3 font-semibold tracking-tight">{p.title}</p>
                                    <p className="mt-0.5 text-sm text-white/50">{p.line}</p>
                                </li>
                            ))}
                        </ul>

                        <div className="mt-9 flex flex-wrap items-start gap-x-5 gap-y-4">
                            <PassBuyButton buy={buy} price={price} />
                            <button type="button" data-testid="pass-details" onClick={() => setOpen(true)} className="group inline-flex items-center gap-2 rounded-full border border-white/15 px-7 py-4 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black">
                                What&apos;s inside <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                            </button>
                        </div>
                    </div>
                </div>
            </Reveal>
            {open && <PassModal onClose={() => setOpen(false)} buy={buy} price={price} holderPrice={holderPrice} pool={pool} />}
        </Section>
    )
}
