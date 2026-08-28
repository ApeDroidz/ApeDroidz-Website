"use client"

import { Lock, TriangleAlert, Zap } from "lucide-react"

type Variant = 'lifetime' | 'working'

const COPY: Record<Variant, {
    icon: typeof Lock
    blurb: string
    terms: Array<{ icon: typeof Lock; text: string }>
    footnote: string
}> = {
    lifetime: {
        icon: Lock,
        blurb:
            'Lock a droid and it stays in your wallet for good — yours to keep, but never transferable or ' +
            'sellable again. In return you earn guaranteed Gnanas™ freemints: 1x per droid, 1.1x at Level 2, ' +
            '1.5x at Level 2 Super.',
        terms: [
            {
                icon: TriangleAlert,
                text: 'Permanent — never sellable or transferable again, not even to your own second wallet.',
            },
            { icon: Zap, text: 'A locked droid can never be sent to Working.' },
        ],
        footnote: 'Opens once the lock registry contract is live on ApeChain.',
    },
    working: {
        icon: Zap,
        blurb:
            'Put droids to work and earn over time. Unlike Lifetime Lock this is not a one-off — rewards accrue ' +
            'while a droid is working, and it stays yours to call back.',
        terms: [
            {
                icon: Lock,
                text:
                    'A droid you lock forever can never be sent to Working. Lifetime Lock is permanent and ' +
                    'exclusive — choose it only for droids you are certain you will never want to put to work.',
            },
        ],
        footnote: 'Conditions, rates and duration will be published before this opens.',
    },
}

/**
 * The pre-launch face of a staking mode.
 *
 * Both modes need the same thing before they open: say what the deal is, say what it costs, and be
 * plain that it is not live yet. Sharing one component means the two tabs cannot drift into looking
 * like different products, and the real Lifetime UI stays in the tree behind a flag rather than
 * being deleted and rebuilt later.
 */
export function ComingSoonPanel({ variant, lockedCount = 0 }: { variant: Variant; lockedCount?: number }) {
    const copy = COPY[variant]
    const Icon = copy.icon

    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-8 md:p-12 h-full flex items-center">
            <div className="max-w-xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/12 text-[9px] font-black uppercase tracking-[0.25em] text-white/40">
                    <Icon size={11} className="text-white icon-dim-40" />
                    Coming soon
                </div>

                <p className="mt-6 text-gray-400 text-xs md:text-sm font-mono leading-relaxed">{copy.blurb}</p>

                <div className="mt-7 space-y-3 rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-3.5">
                    {copy.terms.map((term) => {
                        const TermIcon = term.icon
                        return (
                            <div key={term.text} className="flex items-start gap-3">
                                <TermIcon size={13} className="text-red-400 mt-0.5 flex-shrink-0" />
                                <p className="text-[11px] font-bold text-red-300/85 leading-relaxed">{term.text}</p>
                            </div>
                        )
                    })}

                    {variant === 'working' && lockedCount > 0 && (
                        <p className="text-[11px] font-bold text-red-300/70 leading-relaxed pl-6">
                            You have already locked <strong className="text-red-200">{lockedCount}</strong>.
                        </p>
                    )}
                </div>

                <p className="mt-7 text-[10px] font-mono text-white/25">{copy.footnote}</p>
            </div>
        </div>
    )
}
