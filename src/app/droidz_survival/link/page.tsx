'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AutoConnect, ConnectButton, useActiveAccount } from 'thirdweb/react'
import { createWallet } from 'thirdweb/wallets'
import { client, apeChain } from '@/lib/thirdweb'
import { Check, Loader2 } from 'lucide-react'
import { useGlitchSession } from '@/hooks/useGlitchSession'

/**
 * The site's half of linking wallets (owner, 17.10.2026: one account, several wallets — the pass
 * bought with MetaMask shows up when playing with the Otherside Glyph wallet).
 *
 * The game (Settings → WALLETS) shows a code made under the wallet it plays with. Here the OTHER
 * wallet signs in, enters that code, sees both accounts side by side and chooses whose progress
 * stays (lib/survivalAccount.ts, api/survival/link/{preview,redeem}). The game notices the code was
 * used and reloads into the joined account by itself.
 */

const WALLETS = [createWallet('io.metamask'), createWallet('com.coinbase.wallet'), createWallet('me.rainbow')]

interface Summary {
    account: string; wallets: string[]; nickname: string | null
    coins: number; runs: number; best: number; tier: number; pass: boolean
}
type Preview = { theirs: Summary; mine: Summary }

const ERRORS: Record<string, string> = {
    bad_code: 'That code is not right. Check it in the game: Settings → Wallets.',
    used: 'That code was already used. Make a new one in the game.',
    expired: 'That code expired (codes work for 10 minutes). Make a new one in the game.',
    same_wallet: 'This is the same wallet the game is signed in with. Connect the OTHER wallet here — the one that bought the pass.',
    same_account: 'These wallets are already one account.',
    both_grouped: 'Both wallets already belong to accounts with several wallets. Unlink one side first (Settings → Wallets).',
    full: 'An account holds up to 3 wallets. Unlink one first (Settings → Wallets).',
    cooldown: 'This wallet left an account less than 7 days ago and cannot join one yet.',
    banned: 'One of these wallets cannot play. If that is a mistake, open a ticket in Discord.',
    too_many_tries: 'Too many wrong codes. Wait a few minutes and try again.',
    no_access: 'This wallet cannot play right now.',
    unauthenticated: 'Sign in with this wallet first.',
    no_server: 'The server did not answer. Try again in a moment.',
}
const say = (s: string) => ERRORS[s] ?? 'Something went wrong. Try again.'
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`
const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)

function LinkWallets() {
    const params = useSearchParams()
    const account = useActiveAccount()
    const { authedWallet, ensureLogin, loading } = useGlitchSession()
    const [code, setCode] = useState(() => cleanCode(params.get('code') ?? ''))
    const [preview, setPreview] = useState<Preview | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [keep, setKeep] = useState<'theirs' | 'mine' | null>(null)
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)
    const signedIn = !!account && authedWallet === account.address.toLowerCase()

    // Both sides, once the wallet is signed in and the code is whole.
    useEffect(() => {
        setPreview(null); setError(null); setKeep(null)
        if (!signedIn || code.length !== 8) return
        let alive = true
        void fetch(`/api/survival/link/preview?code=${code}`, { credentials: 'include', cache: 'no-store' })
            .then((r) => r.json().catch(() => ({})))
            .then((d) => {
                if (!alive) return
                if (d.ok) {
                    setPreview({ theirs: d.theirs, mine: d.mine })
                    // The fuller save first: more runs, then more Ape Mini.
                    const t = d.theirs as Summary, m = d.mine as Summary
                    setKeep(t.runs > m.runs || (t.runs === m.runs && t.coins > m.coins) ? 'theirs' : 'mine')
                } else setError(say(d.state ?? d.error ?? ''))
            })
            .catch(() => alive && setError(say('no_server')))
        return () => { alive = false }
    }, [signedIn, code, authedWallet])

    const link = useCallback(async () => {
        if (!keep || busy) return
        setBusy(true); setError(null)
        try {
            const r = await fetch('/api/survival/link/redeem', {
                method: 'POST', credentials: 'include', cache: 'no-store',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, keep }),
            })
            const d = await r.json().catch(() => ({}))
            if (d.ok) setDone(true); else setError(say(d.state ?? ''))
        } catch { setError(say('no_server')) } finally { setBusy(false) }
    }, [keep, busy, code])

    return (
        <main className="min-h-[100dvh] bg-[#0a0f1e] text-white px-4 py-16 flex justify-center">
            <AutoConnect client={client} wallets={WALLETS} />
            <div className="w-full max-w-2xl space-y-6">
                <header className="space-y-2 text-center">
                    <div className="text-xs font-bold tracking-[0.3em] text-white/40">DROIDZ SURVIVAL</div>
                    <h1 className="text-3xl font-black uppercase tracking-tight">Link a wallet</h1>
                    <p className="text-white/60 text-sm max-w-lg mx-auto">
                        One account, several wallets: the season pass, purchases, progress and your place on the board — whichever wallet you play with,
                        on the site or in the Otherside arcade.
                    </p>
                </header>

                {done ? (
                    <section className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-6 text-center space-y-2">
                        <Check className="mx-auto text-emerald-400" size={32} />
                        <div className="text-lg font-bold">Linked</div>
                        <p className="text-white/60 text-sm">Go back to the game — it reloads into your account by itself within a few seconds.</p>
                    </section>
                ) : (
                    <>
                        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
                            <Step n={1} title="Connect the wallet that bought the pass">
                                <p className="text-white/50 text-xs">Not the one the game is signed in with — the other one.</p>
                                <div className="flex flex-wrap items-center gap-3 pt-2">
                                    <ConnectButton client={client} chain={apeChain} wallets={WALLETS} theme="dark" autoConnect={false}
                                        connectButton={{ label: 'Connect Wallet', className: '!bg-white !text-black !font-bold !rounded-full !h-[42px] !px-6 !text-sm' }}
                                        connectModal={{ size: 'compact', title: 'Link a wallet', showThirdwebBranding: false }} />
                                    {account && !signedIn && (
                                        <button onClick={() => void ensureLogin()} disabled={loading}
                                            className="h-[42px] px-6 rounded-full bg-[#3b82f6] font-bold text-sm disabled:opacity-50">
                                            Sign in (free, no transaction)
                                        </button>
                                    )}
                                    {signedIn && <span className="text-emerald-400 text-sm font-mono">{short(account!.address)} signed in</span>}
                                </div>
                            </Step>
                            <Step n={2} title="Enter the code from the game">
                                <p className="text-white/50 text-xs">In the game: Settings → Wallets → Add a wallet.</p>
                                <input value={code} onChange={(e) => setCode(cleanCode(e.target.value))} placeholder="XXXXXXXX" spellCheck={false}
                                    className="mt-2 w-full max-w-xs rounded-xl bg-black/40 border border-white/15 px-4 py-3 font-mono text-2xl tracking-[0.3em] uppercase outline-none focus:border-[#3b82f6]" />
                            </Step>
                        </section>

                        {signedIn && code.length === 8 && !preview && !error && (
                            <div className="flex justify-center text-white/50"><Loader2 className="animate-spin" /></div>
                        )}

                        {preview && (
                            <section className="space-y-4">
                                <Step n={3} title="Choose whose progress stays">
                                    <p className="text-white/50 text-xs">
                                        The season pass and every purchase of both wallets stay with the account either way. The other progress is not deleted:
                                        it is set aside and comes back if that wallet is unlinked.
                                    </p>
                                </Step>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Side label="The game's wallet" s={preview.theirs} on={keep === 'theirs'} pick={() => setKeep('theirs')} />
                                    <Side label="This wallet" s={preview.mine} on={keep === 'mine'} pick={() => setKeep('mine')} />
                                </div>
                                <button onClick={() => void link()} disabled={!keep || busy}
                                    className="w-full py-3 rounded-xl bg-[#3b82f6] font-black uppercase tracking-widest text-sm disabled:opacity-50">
                                    {busy ? 'Linking…' : 'Link into one account'}
                                </button>
                            </section>
                        )}
                        {error && <p className="text-orange-400 text-sm text-center">{error}</p>}
                    </>
                )}
            </div>
        </main>
    )
}

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
    return (
        <div className="flex gap-3">
            <div className="shrink-0 w-7 h-7 rounded-full bg-white/10 text-sm font-bold flex items-center justify-center">{n}</div>
            <div className="space-y-1 min-w-0 flex-1">
                <div className="font-bold">{title}</div>
                {children}
            </div>
        </div>
    )
}

function Side({ label, s, on, pick }: { label: string; s: Summary; on: boolean; pick: () => void }) {
    return (
        <button onClick={pick}
            className={`text-left rounded-2xl border p-4 space-y-3 transition-colors ${on ? 'border-[#3b82f6] bg-[#3b82f6]/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}>
            <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-widest text-white/50 uppercase">{label}</span>
                <span className={`w-5 h-5 rounded-full border-2 ${on ? 'border-[#3b82f6] bg-[#3b82f6]' : 'border-white/30'}`} />
            </div>
            <div className="font-mono text-sm">{s.nickname ? `${s.nickname} · ` : ''}{short(s.account)}{s.wallets.length > 1 ? ` +${s.wallets.length - 1}` : ''}</div>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-white/50">Ape Mini</dt><dd className="text-right font-bold text-[#3b82f6]">{s.coins.toLocaleString('en-US')}</dd>
                <dt className="text-white/50">Runs</dt><dd className="text-right font-bold">{s.runs}</dd>
                <dt className="text-white/50">Season best</dt><dd className="text-right font-bold">{s.best.toLocaleString('en-US')}</dd>
                <dt className="text-white/50">Season tier</dt><dd className="text-right font-bold">{s.tier}</dd>
                <dt className="text-white/50">Season pass</dt><dd className="text-right font-bold">{s.pass ? 'Yes' : '—'}</dd>
            </dl>
            {on && <div className="text-xs text-[#3b82f6] font-bold">This progress stays</div>}
        </button>
    )
}

export default function Page() {
    return <Suspense><LinkWallets /></Suspense>
}
