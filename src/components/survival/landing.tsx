'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Gamepad2, PenLine, Play, Wallet } from 'lucide-react'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import { ProfileModal } from '@/components/profile-modal'
import { InstallHint } from '@/components/survival/install-hint'
import { GlitchText } from '@/components/glitch/glitch-text'
import { ACCENT_BTN, LABEL_CLASS, Reveal } from '@/components/landing/ui'
import { trackFunnel } from '@/lib/survivalFunnel'
import { inWalletBrowser, isIOSDevice, isMobileDevice } from '@/lib/survivalDevice'
import { Ape, ape, LiveDot, PlayLink, POOL_SEASON, saleOn, Section, TRIAL_WAVES, utc, type BoardRow, type LandingPrice, type Pool, type Tickets } from './landing/shared'
import { GameplayVideo } from './landing/video'
import { PoolSection } from './landing/pool-section'
import { PassSection } from './landing/pass-section'
import { BoardSection } from './landing/board-section'
import { HeroesSection } from './landing/heroes-section'
import { LastCall } from './landing/last-call'

export type { LandingPrice } from './landing/shared'

/**
 * The Droidz Survival landing (owner, 03.10.2026): the site's look, not the game's.
 *
 * Order (owner, second pass 03.10.2026): the hero (the video, the name, OPEN BETA · LIVE, PLAY —
 * nothing else, and the next block peeking under it) → the prize pool and how it grows → the pass →
 * the beta leaderboard → the heroes → how to play → FAQ. Each block has one accent to look at:
 * the pool and the board gold, the pass cyan, the heroes their own colours, PLAY the site's blue.
 *
 * Every number on it comes from the live API (pool, board, tickets), the live catalog (prices, read
 * by page.tsx on the server) or the game's own config. Nothing is invented: a number that is not
 * there yet shows as a dash, not as a guess.
 *
 * Light on purpose: the video loads its metadata only and plays only while on screen; on a phone it
 * is the poster with a play button until tapped. The heroes' loops are CSS steps, paused off screen.
 * PLAY is a full page load to /play, so nothing of this page stays in memory under the game.
 */
/** `heroCosts`: hero id → unlock price in Ape Mini, from the game's export (page.tsx). */
export function SurvivalLanding({ prices, heroCosts = {} }: { prices: LandingPrice[]; heroCosts?: Record<string, number> }) {
    const [isProfileOpen, setIsProfileOpen] = useState(false)
    const [pool, setPool] = useState<Pool | null | undefined>(undefined)
    const [board, setBoard] = useState<BoardRow[] | null | undefined>(undefined)
    const [tickets, setTickets] = useState<Tickets | null>(null)
    const [now, setNow] = useState(() => Date.now())
    /** Phone facts after mount: the video's mode, the background, the install hint. */
    const [device, setDevice] = useState<{ mobile: boolean; ios: boolean; inWallet: boolean } | null>(null)

    useEffect(() => {
        setDevice({ mobile: isMobileDevice(), ios: isIOSDevice(), inWallet: inWalletBrowser() })
        trackFunnel('landing_view')
    }, [])

    // The live numbers. The pool every minute while the tab is in front (its route is cached at the
    // edge for 30 s); the board and the ticket price once.
    useEffect(() => {
        let alive = true
        const getJson = async <T,>(url: string): Promise<T | null> => {
            try {
                const r = await fetch(url, { cache: 'no-store' })
                if (r.status !== 200) return null
                return (await r.json()) as T
            } catch { return null }
        }
        const loadPool = () => getJson<Pool>('/api/survival/pool').then((p) => { if (alive) setPool(p) })
        void loadPool()
        void getJson<{ rows: BoardRow[] }>('/api/survival/board').then((b) => { if (alive) setBoard(b?.rows ?? null) })
        void getJson<Tickets>('/api/survival/tickets').then((t) => { if (alive) setTickets(t) })
        const id = setInterval(() => { if (document.visibilityState === 'visible') { void loadPool(); setNow(Date.now()) } }, 60_000)
        return () => { alive = false; clearInterval(id) }
    }, [])

    const runs = prices.filter((p) => p.kind === 'runs')
    const seasonLive = !!pool?.paysOut && !!pool.endsAt

    return (
        <main className="relative w-full overflow-x-hidden bg-black font-sans text-white">
            <LandingStyles />
            <Header onOpenProfile={() => setIsProfileOpen(true)} />

            <div className="relative z-10">
                {/* ── 1. Hero (owner, 04.10.2026): the trailer is the screen, playing; on it only OPEN BETA ·
                       LIVE, the glitching name and PLAY. One accent — the site's blue (PLAY); a calm black
                       ground. On a phone and a small tablet the words stack above the video. ──────────── */}
                <section className="relative px-4 pb-4 pt-24 md:px-[5vw] md:pt-28">
                    {/* As wide as the screen allows while the next block still peeks under it. */}
                    <div className="relative mx-auto max-w-[1280px]" style={{ maxWidth: device?.mobile ? undefined : 'min(1280px, max(640px, calc((100svh - 270px) * 1.971)))' }}>
                        <div className="relative flex flex-col">
                            <div className="order-1 lg:pointer-events-none lg:absolute lg:inset-y-0 lg:left-0 lg:z-10 lg:flex lg:w-[min(560px,50%)] lg:flex-col lg:justify-end lg:p-10 xl:p-12">
                                {/* Just words and a green «live» dot — the page's only green (owner, 04.10.2026). */}
                                <span data-testid="season-status" className="inline-flex w-fit items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-white/85">
                                    <LiveDot color="#34D399" />
                                    {seasonLive ? `${pool!.seasonName} · Live` : 'Open beta · Live'}
                                </span>
                                {/* The site's glitch on the name, as in the first version — without the glow. */}
                                <h1 className="mt-4 text-[2.9rem] font-black uppercase leading-[0.9] tracking-tighter text-white sm:text-6xl xl:text-7xl" aria-label="Droidz Survival">
                                    <GlitchText text="Droidz" />
                                    <GlitchText text="Survival" />
                                </h1>
                                <div className="mt-7 lg:pointer-events-auto lg:w-[280px]">
                                    <PlayLink testId="play-hero" className={`${ACCENT_BTN} w-full !py-5 !text-base`}>
                                        <Play className="h-5 w-5" fill="currentColor" /> Play
                                    </PlayLink>
                                </div>
                            </div>
                            <div className="order-2 mt-7 lg:mt-0">
                                <GameplayVideo tapToPlay={device?.mobile ?? true} scrim />
                            </div>
                        </div>
                        <a href="#pool" className="group mx-auto mt-5 flex w-fit flex-col items-center gap-1 text-white" aria-label="Scroll to the prize pool">
                            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-white/45 transition-colors group-hover:text-white">
                                Prize pool{pool ? <> · <span className="text-white/80">{ape(pool.poolApe)}</span> <Ape /></> : null}
                            </span>
                            <ChevronDown className="h-5 w-5 animate-bounce opacity-50 group-hover:opacity-100" />
                        </a>
                    </div>
                </section>

                {/* ── 2. The prize pool ───────────────────────────────────────────────────────── */}
                <PoolSection pool={pool} prices={prices} tickets={tickets} now={now} />

                {/* ── 3. The pass ─────────────────────────────────────────────────────────────── */}
                <PassSection prices={prices} />

                {/* ── 4. The beta leaderboard ─────────────────────────────────────────────────── */}
                <BoardSection board={board} pool={pool} />

                {/* ── 5. Heroes ───────────────────────────────────────────────────────────────── */}
                <HeroesSection costs={heroCosts} />

                {/* ── 6. How to play ──────────────────────────────────────────────────────────── */}
                <Section id="how" label="How to play" title="Three steps to the first wave" action={<PlayLink testId="play-how" className={ACCENT_BTN}><Play className="h-4 w-4" fill="currentColor" /> Play now</PlayLink>}>
                    <div className="grid gap-4 md:grid-cols-3 md:gap-5">
                        {[
                            { n: '01', icon: Wallet, title: 'Connect a wallet', text: 'MetaMask, Coinbase Wallet or Rainbow. On a phone the wallet app opens to approve.' },
                            { n: '02', icon: PenLine, title: 'Sign once', text: 'One message proves the wallet is yours. Free: no transaction, no gas, nothing leaves your wallet.' },
                            { n: '03', icon: Gamepad2, title: 'Play', text: `Pick a hero and survive the waves. Your first run is a free ${TRIAL_WAVES}-wave trial; your best score goes on the board.` },
                        ].map((s, i) => (
                            <Reveal key={s.n} delay={i * 0.06}>
                                <div className="h-full rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md md:p-7">
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono text-sm font-bold tracking-widest text-white/35">{s.n}</span>
                                        <s.icon className="h-5 w-5 text-white" />
                                    </div>
                                    <h3 className="mt-7 text-xl font-semibold tracking-tight md:text-2xl">{s.title}</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-white/55">{s.text}</p>
                                </div>
                            </Reveal>
                        ))}
                    </div>
                </Section>

                {/* ── 7. FAQ ──────────────────────────────────────────────────────────────────── */}
                <Section id="faq" label="FAQ" title="Questions">
                    <div className="mx-auto max-w-3xl space-y-3">
                        <Faq q="Which wallet do I need?">
                            Any of MetaMask, Coinbase Wallet or Rainbow. On a phone the wallet app opens to approve the
                            connection; if it never comes back, open the play page in your wallet&apos;s own browser — the
                            play page has a button for that.
                        </Faq>
                        <Faq q="Is the signature free?">
                            Yes. Signing a message only proves the wallet is yours: there is no transaction, no gas, and
                            nothing leaves your wallet. You sign once and stay signed in.
                        </Faq>
                        <Faq q="Why ApeChain?">
                            Droidz Survival lives on ApeChain: runs, lucky tickets and the prize pool are in <Ape />. If your
                            wallet app does not have ApeChain yet, the play page adds it with one tap. Ape Mini, the
                            game&apos;s own coin, is not <Ape />: it cannot be withdrawn, sold or swapped.
                        </Faq>
                        <Faq q="How much does a run cost?" open>
                            <span className="block">Your first run is a free {TRIAL_WAVES}-wave trial. After that runs are bought in the game, in <Ape />:</span>
                            {runs.length > 0 ? (
                                <span className="mt-3 block space-y-1.5">
                                    {runs.map((p) => <PriceLine key={p.sku} title={p.title} p={p} now={now} />)}
                                    {tickets?.priceApe != null && (
                                        <PriceLine title="Lucky ticket" p={{ priceApe: tickets.priceApe, fullPriceApe: tickets.fullPriceApe ?? tickets.priceApe, salePct: tickets.salePct, saleUntil: tickets.saleUntil }} now={now} />
                                    )}
                                </span>
                            ) : (
                                <span className="mt-2 block">The live price list is in the game&apos;s shop.</span>
                            )}
                            <span className="mt-3 block">Half of every payment goes into the prize pool.</span>
                        </Faq>
                        <Faq q="Can I play on my phone?">
                            <span className="block">
                                Yes — iPhone and Android, held sideways. Add it to your Home Screen and it opens full screen,
                                without the browser&apos;s bars: on iPhone, Safari → Share → Add to Home Screen; on Android,
                                the browser menu → Install app (or Add to Home screen). Sign in once inside the app.
                            </span>
                            {device?.mobile && !device.inWallet && <InstallHint ios={device.ios} className="mt-4" />}
                        </Faq>
                        <Faq q="Who gets the prize pool?">
                            Season-pass holders, by their best score of the season. The open beta&apos;s pool is paid out in
                            Season {POOL_SEASON}. The pass is not on sale yet — it opens with Season {POOL_SEASON}.
                        </Faq>
                    </div>
                </Section>

                {/* ── Last call: the heroes running on the game's floor ─────────────────────── */}
                <LastCall pool={pool} />

                <Footer />
            </div>

            <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
        </main>
    )
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────

function Faq({ q, children, open = false }: { q: string; children: ReactNode; open?: boolean }) {
    return (
        <details open={open} className="group rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md open:bg-white/[0.07]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-base font-semibold tracking-tight md:px-6 md:py-5 [&::-webkit-details-marker]:hidden">
                {q}
                <ChevronDown className="h-4 w-4 shrink-0 text-white icon-dim-50 transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 text-sm leading-relaxed text-white/60 md:px-6">{children}</div>
        </details>
    )
}

function PriceLine({ title, p, now }: { title: string; p: { priceApe: number; fullPriceApe: number; salePct: number; saleUntil: string | null }; now: number }) {
    const sale = saleOn(p, now)
    return (
        <span className="flex flex-wrap items-baseline gap-x-2 text-white/75">
            <span className="font-semibold text-white">{title}</span>
            <span>—</span>
            <span className="font-mono tabular-nums text-white">{ape(sale ? p.priceApe : p.fullPriceApe)} <Ape /></span>
            {sale && (
                <>
                    <span className="font-mono tabular-nums text-white/35 line-through">{ape(p.fullPriceApe)}</span>
                    <span className="rounded-full border border-white/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-white/70">-{p.salePct}% until {utc(p.saleUntil!)}</span>
                </>
            )}
        </span>
    )
}

/**
 * The page's own motion: the heroes' sprite steps, the pool bar's glint, the flow lines, the pass
 * card's turn and sweep. All of it stops for reduced motion.
 */
// Set as raw HTML: as a text child React escapes the quotes on the server, and inside <style> the
// browser keeps «&quot;» literally — the client's text then differs (a hydration mismatch).
function LandingStyles() {
    return <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
}
const LANDING_CSS = `
.ds-heroes { --hero-k: 2; }
@media (min-width: 768px) { .ds-heroes { --hero-k: 2.2; } }
@media (min-width: 1024px) { .ds-heroes { --hero-k: 2.6; } }
.ds-sprite { background-repeat: no-repeat; background-position: 0 0; image-rendering: pixelated; animation-name: ds-sprite; animation-iteration-count: infinite; animation-play-state: paused; }
[data-playing="1"] .ds-sprite { animation-play-state: running; }
.ds-run { --run-k: 1.2; }
@media (min-width: 768px) { .ds-run { --run-k: 1.6; } }
.ds-floor { animation: ds-floor 7s linear infinite; animation-play-state: paused; }
.ds-run[data-playing="1"] .ds-floor { animation-play-state: running; }
@keyframes ds-floor { from { background-position: 0 0; } to { background-position: calc(-1100px * var(--run-k)) 0; } }
/* the run's sky and city behind the runners (landing/last-call.tsx): one tile per loop, timed per layer */
.ds-par { animation: ds-par-drift linear infinite; animation-play-state: paused; }
.ds-run[data-playing="1"] .ds-par { animation-play-state: running; }
@keyframes ds-par-drift { from { background-position-x: 0; } to { background-position-x: var(--par-w); } }
/* the runners spread wider on a phone, so the three never overlap */
.ds-runner { left: var(--lm); }
@media (min-width: 768px) { .ds-runner { left: var(--ld); } }
@keyframes ds-sprite { from { background-position: 0 0; } to { background-position: var(--ds-end) 0; } }
.ds-glint { left: -4rem; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent); animation: ds-glint 2.8s ease-in-out infinite; }
@keyframes ds-glint { 0% { left: -4rem; } 60%, 100% { left: 100%; } }
.ds-flow { stroke-dasharray: 4 6; animation: ds-flow 1.2s linear infinite; }
@keyframes ds-flow { to { stroke-dashoffset: -10; } }
.ds-pass { animation: ds-pass 6s ease-in-out infinite; transform-style: preserve-3d; }
@keyframes ds-pass { 0%, 100% { transform: perspective(900px) rotateY(-14deg) translateY(0); } 50% { transform: perspective(900px) rotateY(14deg) translateY(-6px); } }
.ds-pass-sweep::after { content: ''; position: absolute; top: -20%; bottom: -20%; width: 28%; left: -40%; transform: skewX(-18deg); background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent); animation: ds-sweep 3.2s ease-in-out infinite; }
@keyframes ds-sweep { 0% { left: -40%; } 45%, 100% { left: 120%; } }
@media (prefers-reduced-motion: reduce) {
  .ds-sprite, .ds-glint, .ds-flow, .ds-pass, .ds-pass-sweep::after, .ds-floor, .ds-par { animation: none !important; }
}
`
