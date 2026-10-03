'use client'

import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'

/**
 * «Play it like an app» (owner, 02.10.2026: «важно сделать mobile native»): on a phone's browser,
 * how to put the game on the Home Screen, where it opens without the browser's bars.
 *  - iPhone: there is no prompt to call — Share → Add to Home Screen is the only way, so say it.
 *  - Android (Chrome): the browser's own install prompt, kept by layout.tsx's early script when it
 *    fires; without one (another browser, or not offered yet) — the menu's «Add to Home screen».
 * Dismissed once, it stays dismissed on this phone.
 */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const INSTALL_HINT_KEY = 'ds_install_hint_dismissed_v1'

export function InstallHint({ ios, className = 'mt-8' }: { ios: boolean; className?: string }) {
    const [hidden, setHidden] = useState(true)
    const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
    const [steps, setSteps] = useState(false)

    useEffect(() => {
        let dismissed = false
        try { dismissed = localStorage.getItem(INSTALL_HINT_KEY) === '1' } catch { /* private mode */ }
        const w = window as Window & { __dsInstallPrompt?: InstallPromptEvent | null; __dsInstalled?: boolean }
        const sync = () => {
            setPrompt(w.__dsInstallPrompt ?? null)
            if (w.__dsInstalled) setHidden(true)
        }
        // The early script may not have run (a client-side navigation to this page): listen here too.
        const onPrompt = (e: Event) => { e.preventDefault(); w.__dsInstallPrompt = e as InstallPromptEvent; sync() }
        const onInstalled = () => { w.__dsInstallPrompt = null; w.__dsInstalled = true; sync() }
        setHidden(dismissed || !!w.__dsInstalled)
        sync()
        window.addEventListener('ds:installable', sync)
        window.addEventListener('beforeinstallprompt', onPrompt)
        window.addEventListener('appinstalled', onInstalled)
        return () => {
            window.removeEventListener('ds:installable', sync)
            window.removeEventListener('beforeinstallprompt', onPrompt)
            window.removeEventListener('appinstalled', onInstalled)
        }
    }, [])

    if (hidden) return null

    const dismiss = () => {
        setHidden(true)
        try { localStorage.setItem(INSTALL_HINT_KEY, '1') } catch { /* private mode */ }
    }
    const install = async () => {
        if (!prompt) return
        try {
            await prompt.prompt()
            const { outcome } = await prompt.userChoice
            if (outcome === 'accepted') setHidden(true)
        } catch { setSteps(true) }
        // A prompt is good for one call only.
        ;(window as Window & { __dsInstallPrompt?: unknown }).__dsInstallPrompt = null
        setPrompt(null)
    }

    return (
        <div data-testid="install-hint" className={`relative rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left ${className}`}>
            <button onClick={dismiss} aria-label="Hide" className="absolute right-3 top-3 text-white opacity-40 transition-opacity hover:opacity-100">
                <X className="h-3.5 w-3.5" />
            </button>
            <p className="pr-6 font-mono text-[11px] uppercase tracking-widest text-white/60">Play it like an app</p>
            <p className="mt-2 text-xs leading-relaxed text-white/45">
                Add Droidz Survival to your Home Screen: it opens full screen, without the browser&apos;s bars.
            </p>
            {ios ? (
                <ol data-testid="install-steps-ios" className="mt-3 space-y-2 text-xs leading-relaxed text-white/70">
                    <li className="flex items-center gap-2">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/20 font-mono text-[10px]">1</span>
                        <span>In Safari tap Share <Share className="inline h-3.5 w-3.5 -translate-y-px text-white" /> (on newer iOS it is under ••• )</span>
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/20 font-mono text-[10px]">2</span>
                        <span>Add to Home Screen <SquarePlus className="inline h-3.5 w-3.5 -translate-y-px text-white" /> → Add</span>
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/20 font-mono text-[10px]">3</span>
                        <span>Open Droidz Survival from the Home Screen and sign in once there</span>
                    </li>
                </ol>
            ) : (
                <>
                    {/* Chrome's own prompt when it has offered one; the menu's way otherwise. */}
                    {prompt && (
                        <button
                            data-testid="install-app"
                            onClick={install}
                            className="mt-3 inline-flex h-[40px] items-center justify-center gap-2 rounded-full bg-white px-6 text-xs font-bold text-black transition-all duration-300 hover:bg-[#0069FF] hover:text-white"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Install app
                        </button>
                    )}
                    {(steps || !prompt) && (
                        <p data-testid="install-steps-android" className="mt-3 text-xs leading-relaxed text-white/45">
                            Browser menu ⋮ → Install app (or Add to Home screen), then open Droidz Survival
                            from the Home Screen and sign in once there.
                        </p>
                    )}
                </>
            )}
        </div>
    )
}
