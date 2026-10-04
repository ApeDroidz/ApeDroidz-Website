'use client'

import { Gift, Lock, Sparkles, Trophy } from 'lucide-react'
import { LABEL_CLASS, Reveal } from '@/components/landing/ui'
import { Ape, ape, POOL_SEASON, POOL_SHARE, Section, type LandingPrice } from './shared'

// One short line each (owner, 04.10.2026: «текста слишком много»). From the game: the pool goes to
// pass holders (config/season.ts), a PASS reward on every tier, four spark colours only the pass gives.
const PASS_PERKS: Array<{ icon: typeof Trophy; title: string; line: string }> = [
    { icon: Trophy, title: 'The prize pool', line: `Only pass holders share it.` },
    { icon: Gift, title: 'Pass rewards', line: 'A second reward on every tier.' },
    { icon: Sparkles, title: 'Spark colours', line: 'Four colours only the pass gives.' },
]

/**
 * The season pass (owner, 03.10.2026: «больше акцента — картинка, что даёт, цена, что 50% цены
 * уходит в пул»). The card is the game's sealed pass (ui/seasonTeaser.ts sealedFace, redrawn to a
 * PNG from the same gold ramp: public/droidz_survival/landing/pass-card.png). The price is the live
 * catalog's; the sale is not open yet («Soon»).
 */
export function PassSection({ prices }: { prices: LandingPrice[] }) {
    const pass = prices.find((p) => p.kind === 'season_pass')
    const price = pass?.fullPriceApe ?? null
    const holderPct = pass?.holderDiscountPct ?? 0
    return (
        <Section id="pass" label="Season pass" title="The pass is your ticket to the pool">
            <Reveal>
                {/* The order the eye takes: the card — the price — three perks — «Soon». */}
                <div className="grid items-center gap-10 rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
                    <div className="flex justify-center py-2">
                        <div className="ds-pass relative" style={{ width: 'clamp(160px, 20vw, 220px)', aspectRatio: '168 / 228' }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/droidz_survival/landing/pass-card.png" alt={`Season ${POOL_SEASON} pass`} width={168} height={228} className="h-full w-full" style={{ imageRendering: 'pixelated' }} />
                            <span aria-hidden className="ds-pass-sweep pointer-events-none absolute inset-[2%] overflow-hidden" />
                        </div>
                    </div>

                    <div className="min-w-0">
                        <div className={`${LABEL_CLASS} text-white/40`}>Season {POOL_SEASON} pass</div>
                        <div className="mt-3 flex items-baseline gap-3 font-semibold tabular-nums tracking-tight">
                            <span className="text-6xl leading-none text-white md:text-7xl">{price != null ? ape(price) : '—'}</span>
                            <Ape className="text-3xl leading-none text-white/55" />
                        </div>
                        {price != null && (
                            <p className="mt-3 text-sm text-white/50">
                                {holderPct > 0 && <>{ape(price * (1 - holderPct / 100))} <Ape /> for ApeDroidz holders · </>}
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

                        <span className="mt-9 inline-flex cursor-not-allowed select-none items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-6 py-4 text-sm font-black uppercase tracking-widest text-[#6a6a6a]">
                            {/* a solid colour, not opacity: the lock's shackle overlaps its body */}
                            <Lock size={15} className="text-[#6a6a6a]" /> Soon · opens with Season {POOL_SEASON}
                        </span>
                    </div>
                </div>
            </Reveal>
        </Section>
    )
}
