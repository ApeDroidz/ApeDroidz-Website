import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The cabinet page lives inside the Otherside Hub and has nothing to offer a search engine or a
// link preview — the public door is /droidz_survival.
export const metadata: Metadata = {
    title: 'Droidz Survival — Otherside cabinet',
    robots: { index: false, follow: false },
}

/**
 * The Hub posts `glyph:ready` exactly once. If it arrives before React has hydrated and the
 * GlyphSDK is listening, it is gone and the cabinet waits forever. This inline script runs as
 * the HTML is parsed — before any bundle — and keeps every `glyph:ready` with its origin; the SDK
 * replays the buffered ones from its own Hub origin only (lib/glyph-sdk.ts).
 */
const EARLY_READY = `window.__glyphEarly=[];window.addEventListener('message',function(e){var d=e.data;if(d&&d.type==='glyph:ready')window.__glyphEarly.push({origin:e.origin,data:d})});`

export default function OthersideLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <script dangerouslySetInnerHTML={{ __html: EARLY_READY }} />
            {children}
        </>
    )
}
