import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// A tool page reached from the game's code (Settings → Wallets): nothing for a search engine.
export const metadata: Metadata = {
    title: 'Link a wallet — Droidz Survival',
    robots: { index: false, follow: false },
    alternates: { canonical: null },
}

export default function LinkLayout({ children }: { children: ReactNode }) {
    return children
}
