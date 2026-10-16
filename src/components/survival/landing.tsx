'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
import { applyPoolPush, subscribePoolLive } from '@/lib/survivalPoolLive'
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
    /** The pass holders' own board (?only=pass), ranked among themselves — the race for the pool. */
    const [passBoard, setPassBoard] = useState<BoardRow[] | null | undefined>(undefined)
    const [passCount, setPassCount] = useState<number | null>(null)
    const [tickets, setTickets] = useState<Tickets | null>(null)
    const [now, setNow] = useState(() => Date.now())
    /** Phone facts after mount: the video's mode, the background, the install hint. */
    const [device, setDevice] = useState<{ mobile: boolean; ios: boolean; inWallet: boolean } | null>(null)

    useEffect(() => {
        setDevice({ mobile: isMobileDevice(), ios: isIOSDevice(), inWallet: inWalletBrowser() })
        trackFunnel('landing_view')
    }, [])

    // The live numbers. The pool pushed live, and asked again every minute while the tab is in front,
    // the boards with it (17.10.2026: a pass bought on the page must show on the board — it was read once).
    // `bust` goes past the edge cache (a few seconds) — right after a purchase.
    const aliveRef = useRef(true)
    const loadPool = useCallback((bust = false) => getJson<Pool>(`/api/survival/pool${bust ? `?r=${Date.now()}` : ''}`).then((p) => { if (aliveRef.current) setPool(p) }), [])
    const loadBoards = useCallback((bust = false) => {
        const r = bust ? `r=${Date.now()}` : ''
        void getJson<{ rows: BoardRow[]; passCount?: number }>(`/api/survival/board${r ? `?${r}` : ''}`).then((b) => {
            if (!aliveRef.current) return
            setBoard(b?.rows ?? null)
            if (typeof b?.passCount === 'number') setPassCount(b.passCount)
        })
        void getJson<{ rows: BoardRow[] }>(`/api/survival/board?only=pass${r ? `&${r}` : ''}`).then((b) => { if (aliveRef.current) setPassBoard(b?.rows ?? null) })
    }, [])
    useEffect(() => {
        aliveRef.current = true
        void loadPool()
        loadBoards()
        void getJson<Tickets>('/api/survival/tickets').then((t) => { if (aliveRef.current) setTickets(t) })
        // Every new booking is pushed the moment it lands (lib/survivalPoolLive); the minute poll stays as a net.
        const off = subscribePoolLive((push) => { if (aliveRef.current) setPool((p) => (p ? applyPoolPush(p, push) : p)) })
        const id = setInterval(() => { if (document.visibilityState === 'visible') { void loadPool(); loadBoards(); setNow(Date.now()) } }, 60_000)
        return () => { aliveRef.current = false; clearInterval(id); off() }
    }, [loadPool, loadBoards])

    /**
     * A pass bought on this page: everything that shows it is read again at once, past the caches —
     * and once more after the server's own ten-second board memo has surely turned over.
     */
    const afterPurchase = useCallback(() => {
        void loadPool(true); loadBoards(true)
        setTimeout(() => { void loadPool(true); loadBoards(true) }, 11_000)
    }, [loadPool, loadBoards])

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
                                    {seasonLive ? `${pool!.seasonName} · Live` : `Season ${POOL_SEASON} · Live`}
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
                <PassSection prices={prices} pool={pool} onPurchased={afterPurchase} />

                {/* ── 4. The beta leaderboard ─────────────────────────────────────────────────── */}
                <BoardSection board={board} passBoard={passBoard} passCount={passCount} pool={pool} />

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
                            Season-pass holders, by their best score of the season — the pool is shared when the season
                            ends. Everything the open beta gathered is in the Season {POOL_SEASON} pool. The pass is bought
                            right on this page, in the Season pass block.
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

async function getJson<T>(url: string): Promise<T | null> {
    try {
        const r = await fetch(url, { cache: 'no-store' })
        if (r.status !== 200) return null
        return (await r.json()) as T
    } catch { return null }
}

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
.ds-flow { stroke-dasharray: 4 6; animation: ds-flow 1.2s linear infinite; }
@keyframes ds-flow { to { stroke-dashoffset: -10; } }
.ds-pass { animation: ds-pass 6s ease-in-out infinite; transform-style: preserve-3d; }
@keyframes ds-pass { 0%, 100% { transform: perspective(900px) rotateY(-14deg) translateY(0); } 50% { transform: perspective(900px) rotateY(14deg) translateY(-6px); } }
.ds-pass-sweep::after { content: ''; position: absolute; top: -20%; bottom: -20%; width: 28%; left: -40%; transform: skewX(-18deg); background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent); animation: ds-sweep 3.2s ease-in-out infinite; }
@keyframes ds-sweep { 0% { left: -40%; } 45%, 100% { left: 120%; } }
/* The Season 1 pass card (landing/pass-parts.tsx PassCard): floats, breathes gold, tilts toward the pointer with the light under it, turns over on a tap. */
.ds-card-stage { position: relative; aspect-ratio: 168 / 272; perspective: 1100px; }
.ds-card-glow { position: absolute; inset: -30% -55%; pointer-events: none; background: radial-gradient(closest-side, rgba(255,207,74,0.34), rgba(255,207,74,0.1) 55%, transparent 78%); animation: ds-breathe 3.4s ease-in-out infinite; }
@keyframes ds-breathe { 0%, 100% { opacity: 0.65; transform: scale(0.96); } 50% { opacity: 1; transform: scale(1.04); } }
.ds-card { position: relative; display: block; width: 100%; height: 100%; padding: 0; border: 0; background: none; cursor: pointer; transform-style: preserve-3d; animation: ds-float 6s ease-in-out infinite; -webkit-tap-highlight-color: transparent; }
.ds-card:focus-visible { outline: 2px solid #FFCF4A; outline-offset: 6px; border-radius: 4px; }
@keyframes ds-float { 0%, 100% { transform: translateY(0) rotateY(-9deg) rotateX(2deg); } 50% { transform: translateY(-8px) rotateY(9deg) rotateX(-2deg); } }
.ds-card.is-tilt { animation-play-state: paused; }
.ds-card-inner { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform 0.7s cubic-bezier(.2,.8,.2,1); transform: rotateX(var(--rx, 0deg)) rotateY(calc(var(--ry, 0deg) + var(--flip, 0deg))); }
.ds-card.is-tilt .ds-card-inner { transition: transform 0.12s linear; }
.ds-card-inner.is-flipped { --flip: 180deg; }
.ds-card-face { position: absolute; inset: 0; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden; box-shadow: 0 18px 34px rgba(0,0,0,0.55), 0 0 26px rgba(255,207,74,0.28); }
.ds-card-face img { width: 100%; height: 100%; image-rendering: pixelated; user-select: none; }
.ds-card-back { transform: rotateY(180deg); }
.ds-card-holo { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: overlay; opacity: 0.55; transition: opacity 0.3s;
  background: radial-gradient(circle at var(--mx, 28%) var(--my, 18%), rgba(255,255,255,0.75), transparent 42%), linear-gradient(115deg, transparent 28%, rgba(255,246,214,0.35) 44%, rgba(190,225,255,0.22) 50%, rgba(255,200,240,0.18) 55%, transparent 70%); background-size: 100% 100%, 260% 260%; animation: ds-holo 5s ease-in-out infinite; }
.ds-card.is-tilt .ds-card-holo { opacity: 1; }
@keyframes ds-holo { 0%, 100% { background-position: 0 0, 0% 0%; } 50% { background-position: 0 0, 100% 100%; } }
.ds-card-sweep::after { content: ''; position: absolute; top: -20%; bottom: -20%; width: 22%; left: -40%; transform: skewX(-20deg); background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent); animation: ds-sweep 3.6s ease-in-out infinite; }
.ds-glint { position: absolute; width: 5px; height: 5px; background: #FFE7A4; box-shadow: 0 0 8px #FFCF4A; opacity: 0; pointer-events: none; animation: ds-glint 3.6s steps(1) infinite; }
.ds-glint::before, .ds-glint::after { content: ''; position: absolute; background: #FFCF4A; }
.ds-glint::before { left: -5px; right: -5px; top: 2px; height: 1px; }
.ds-glint::after { top: -5px; bottom: -5px; left: 2px; width: 1px; }
@keyframes ds-glint { 0% { opacity: 0; } 8% { opacity: 1; } 16% { opacity: 0.4; } 24%, 100% { opacity: 0; } }
/* The pass bought (landing/pass-celebrate.tsx): charge → punch → burst → words. All timed here. */
.ds-cel { animation: ds-cel-in 0.35s ease-out both; perspective: 1100px; }
@keyframes ds-cel-in { from { opacity: 0; } }
.ds-cel-card { transform-style: preserve-3d; animation: ds-cel-spin 0.9s cubic-bezier(.55,0,.25,1) both; }
@keyframes ds-cel-spin { 0% { transform: translateY(60px) scale(0.3) rotateY(-1080deg); opacity: 0; } 12% { opacity: 1; } 100% { transform: translateY(0) scale(1) rotateY(0deg); opacity: 1; } }
.ds-cel-punch { perspective: 1000px; animation: ds-cel-punch 0.55s 0.9s cubic-bezier(.2,1.6,.4,1) both, ds-cel-glitch 0.32s 0.9s steps(1) both; }
@keyframes ds-cel-punch { 0% { transform: scale(1); } 30% { transform: scale(1.14); } 100% { transform: scale(1); } }
@keyframes ds-cel-glitch { 0% { translate: -7px 2px; filter: drop-shadow(4px 0 #FF2BD6) drop-shadow(-4px 0 #2BD4FF); } 25% { translate: 6px -2px; } 50% { translate: -3px 0; filter: drop-shadow(2px 0 #FF2BD6) drop-shadow(-2px 0 #2BD4FF); } 75%, 100% { translate: 0 0; filter: none; } }
.ds-cel-tilt { display: block; padding: 0; border: 0; background: none; cursor: pointer; transform-style: preserve-3d; transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition: transform 0.6s cubic-bezier(.2,.8,.2,1); animation: ds-cel-live 0s 1.4s both; -webkit-tap-highlight-color: transparent; }
@keyframes ds-cel-live { from { pointer-events: none; } to { pointer-events: auto; } }
.ds-cel-tilt.is-tilt { transition: transform 0.12s linear; }
.ds-cel-tilt.is-tilt .ds-card-holo { opacity: 1; }
.ds-cel-tilt:focus-visible { outline: 2px solid #FFCF4A; outline-offset: 6px; }
.ds-cel-flip { transform-style: preserve-3d; transition: transform 0.7s cubic-bezier(.2,.8,.2,1); transform: rotateY(var(--flip, 0deg)); }
.ds-cel-flip.is-flipped { --flip: 180deg; }
.ds-cel-glow { position: absolute; inset: -45% -70%; pointer-events: none; background: radial-gradient(closest-side, rgba(255,255,255,0.16), rgba(255,255,255,0.04) 55%, transparent 78%); opacity: 0; animation: ds-cel-glow 0.9s ease-out both, ds-breathe 3.2s 1.8s ease-in-out infinite; }
@keyframes ds-cel-glow { 0% { opacity: 0; transform: scale(0.4); } 100% { opacity: 1; transform: scale(1); } }
.ds-cel-ring { position: absolute; left: 50%; top: 50%; width: 40%; aspect-ratio: 1; translate: -50% -50%; border: 4px solid #FFE7A4; opacity: 0; pointer-events: none; animation: ds-cel-ring 0.75s 0.9s cubic-bezier(.1,.7,.3,1) both; }
@keyframes ds-cel-ring { 0% { opacity: 1; transform: scale(0.4) rotate(45deg); } 100% { opacity: 0; transform: scale(5) rotate(45deg); border-width: 1px; } }
.ds-cel-bit { position: absolute; left: 50%; top: 50%; opacity: 0; pointer-events: none; animation: ds-cel-bit 1s cubic-bezier(.1,.75,.3,1) both; }
@keyframes ds-cel-bit { 0% { opacity: 1; transform: translate(-50%, -50%); } 70% { opacity: 1; } 100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))); } }
.ds-cel-flash { position: absolute; inset: 0; pointer-events: none; opacity: 0; mix-blend-mode: screen; background: radial-gradient(circle at 50% 42%, rgba(255,240,200,0.75), transparent 60%), repeating-linear-gradient(0deg, transparent 0 6px, rgba(43,212,255,0.08) 6px 8px); animation: ds-cel-flash 0.5s 0.9s steps(4) both; }
@keyframes ds-cel-flash { 0% { opacity: 1; } 100% { opacity: 0; } }
/* Backgrounds: grid (dots + a wave of light from the card), spot (a stage light), glitch (scanlines + RGB tears). */
@property --ds-wave { syntax: '<length>'; inherits: false; initial-value: 0px; }
.ds-cel-grid { position: absolute; inset: 0; pointer-events: none; background-image: radial-gradient(rgba(255,255,255,0.13) 1.2px, transparent 1.6px); background-size: 22px 22px; background-position: center;
  -webkit-mask: radial-gradient(circle at 50% 40%, #000 0 30%, transparent 75%); mask: radial-gradient(circle at 50% 40%, #000 0 30%, transparent 75%); }
.ds-cel-wave { background-image: radial-gradient(rgba(255,255,255,0.95) 1.4px, transparent 1.9px);
  -webkit-mask: radial-gradient(circle at 50% 40%, transparent calc(var(--ds-wave) - 70px), #000 calc(var(--ds-wave) - 20px), transparent var(--ds-wave)); mask: radial-gradient(circle at 50% 40%, transparent calc(var(--ds-wave) - 70px), #000 calc(var(--ds-wave) - 20px), transparent var(--ds-wave));
  animation: ds-cel-wave 1.6s 0.9s cubic-bezier(.15,.6,.35,1) both; }
@keyframes ds-cel-wave { 0% { --ds-wave: 0px; opacity: 1; } 85% { opacity: 1; } 100% { --ds-wave: 120vmax; opacity: 0; } }
.ds-cel-spot { position: absolute; left: 50%; top: -10%; width: min(900px, 140vw); height: 95%; translate: -50% 0; pointer-events: none; opacity: 0;
  background: conic-gradient(from 180deg at 50% 0%, transparent 0deg 160deg, rgba(255,255,255,0.16) 171deg, rgba(255,255,255,0.28) 180deg, rgba(255,255,255,0.16) 189deg, transparent 200deg 360deg);
  -webkit-mask: linear-gradient(#000 40%, transparent 92%); mask: linear-gradient(#000 40%, transparent 92%); filter: blur(6px); animation: ds-cel-spot 0.8s 0.85s ease-out both; }
@keyframes ds-cel-spot { 0% { opacity: 0; } 15% { opacity: 1; } 30% { opacity: 0.55; } 45%, 100% { opacity: 1; } }
.ds-cel-floor { position: absolute; left: 50%; top: 58%; width: min(520px, 90vw); height: 90px; translate: -50% 0; pointer-events: none; opacity: 0; background: radial-gradient(closest-side, rgba(255,255,255,0.22), transparent); animation: ds-cel-rays-in 0.8s 1s ease-out both; }
.ds-cel-scan { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 4px); animation: ds-cel-rays-in 0.5s ease-out both; }
.ds-cel-tear { position: absolute; left: 0; right: 0; height: 7px; pointer-events: none; opacity: 0; background: linear-gradient(90deg, transparent, rgba(43,212,255,0.55) 20%, rgba(255,255,255,0.8) 50%, rgba(255,43,214,0.55) 80%, transparent); mix-blend-mode: screen; animation: ds-cel-tear 0.45s steps(5) both; }
@keyframes ds-cel-tear { 0% { opacity: 1; transform: translateX(-30%) scaleY(1); } 40% { opacity: 0.8; transform: translateX(18%) scaleY(2); } 70% { opacity: 0.6; transform: translateX(-8%) scaleY(0.5); } 100% { opacity: 0; transform: translateX(0) scaleY(1); } }
@keyframes ds-cel-rays-in { from { opacity: 0; } to { opacity: 1; } }
.ds-cel-rain { position: absolute; top: -12px; opacity: 0; pointer-events: none; animation-name: ds-cel-rain; animation-timing-function: linear; animation-iteration-count: 2; animation-fill-mode: both; }
@keyframes ds-cel-rain { 0% { opacity: 0; transform: translateY(0) rotate(0); } 10% { opacity: 0.9; } 90% { opacity: 0.9; } 100% { opacity: 0; transform: translateY(105vh) rotate(180deg); } }
.ds-cel-up { animation: ds-cel-up 0.55s cubic-bezier(.2,.8,.2,1) both; }
@keyframes ds-cel-up { from { opacity: 0; transform: translateY(14px); } }
.ds-cel-pop { animation: ds-cel-pop 0.4s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes ds-cel-pop { from { opacity: 0; transform: scale(0.6); } }
.ds-cel-late { animation: ds-cel-up 0.5s ease-out both; }
.ds-podium { transform-origin: bottom; animation: ds-rise 0.9s cubic-bezier(.2,.8,.2,1) both; }
@keyframes ds-rise { from { transform: scaleY(0); } }
.ds-track { -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 82%, transparent); mask-image: linear-gradient(90deg, transparent, #000 6%, #000 82%, transparent); }
/* Season-pass holders on the board (owner, 17.10.2026): a gold PASS a light crosses now and then, the picture in a gold hairline a short scan of light runs round. */
.ds-passtag { position: relative; overflow: hidden; color: #FFCF4A; background: rgba(255,207,74,0.12); box-shadow: inset 0 0 0 1px rgba(255,207,74,0.6); text-shadow: 0 0 8px rgba(255,207,74,0.45); }
.ds-passtag::after { content: ''; position: absolute; top: 0; bottom: 0; width: 45%; left: -70%; transform: skewX(-20deg); background: linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent); animation: ds-tagsweep 4.2s ease-in-out infinite; animation-delay: var(--ds-shine-delay, 0s); }
@keyframes ds-tagsweep { 0%, 72% { left: -70%; } 100% { left: 140%; } }
.ds-passring { position: relative; display: inline-grid; place-items: center; padding: 3px; border-radius: 9999px; }
.ds-passring::after { content: ''; position: absolute; inset: 0; border-radius: 9999px; box-shadow: inset 0 0 0 1px rgba(255,207,74,0.45); pointer-events: none; }
.ds-passring::before { content: ''; position: absolute; inset: 0; border-radius: 9999px; pointer-events: none; opacity: 0;
  background: conic-gradient(from 0deg, transparent 0deg 250deg, rgba(255,207,74,0.9) 340deg, #fff 358deg, transparent 360deg);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px)); mask: radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px));
  animation: ds-scan 4.2s cubic-bezier(.5,0,.3,1) infinite; animation-delay: var(--ds-shine-delay, 0s); }
@keyframes ds-scan { 0% { transform: rotate(0deg); opacity: 0; } 4% { opacity: 1; } 34% { opacity: 1; } 40% { transform: rotate(1turn); opacity: 0; } 100% { transform: rotate(1turn); opacity: 0; } }
.ds-spark > span + span { animation: ds-spark 1.1s steps(3) infinite; }
@keyframes ds-spark { 0% { opacity: 1; transform: scale(1); } 60% { opacity: 0.5; transform: scale(1.6) translate(1px, -1px); } 100% { opacity: 0; transform: scale(0.6); } }
@media (prefers-reduced-motion: reduce) {
  .ds-sprite, .ds-flow, .ds-pass, .ds-pass-sweep::after, .ds-spark > span, .ds-passtag::after, .ds-passring::before, .ds-card, .ds-card-glow, .ds-card-holo, .ds-card-sweep::after, .ds-glint, .ds-podium, .ds-cel, .ds-cel-card, .ds-cel-punch, .ds-cel-glow, .ds-cel-up, .ds-cel-pop, .ds-cel-late, .ds-floor, .ds-par { animation: none !important; }
  .ds-cel-ring, .ds-cel-bit, .ds-cel-flash, .ds-cel-rain { display: none; }
  .ds-cel-wave, .ds-cel-tear { display: none; }
  .ds-cel-spot, .ds-cel-floor { opacity: 1; animation: none; }
}
`
