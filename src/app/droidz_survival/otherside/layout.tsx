import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The cabinet page lives inside the Otherside Hub and has nothing to offer a search engine or a
// link preview — the public door is /droidz_survival.
export const metadata: Metadata = {
    title: 'Droidz Survival — Otherside cabinet',
    robots: { index: false, follow: false },
    alternates: { canonical: null },
}

/**
 * The Hub posts `glyph:ready` exactly once. If it arrives before React has hydrated and the
 * GlyphSDK is listening, it is gone and the cabinet waits forever. This inline script runs as
 * the HTML is parsed — before any bundle — and keeps every `glyph:ready` with its origin; the SDK
 * replays the buffered ones from its own Hub origin only (lib/glyph-sdk.ts).
 */
const EARLY_READY = `window.__glyphEarly=[];window.addEventListener('message',function(e){var d=e.data;if(d&&d.type==='glyph:ready')window.__glyphEarly.push({origin:e.origin,data:d})});`

/**
 * The game, downloading before the cabinet needs it (owner, 17.10.2026: «в Otherside захожу
 * дольше… чтобы конверсию не терять»). Inside the Hub the game frame starts with an EMPTY cache —
 * the browser keeps a separate cache per top site, so whatever apedroidz.com cached is not used
 * under otherside.xyz — and it used to start only after this page had hydrated, the Hub had
 * handed over the wallet and the session was checked. This script runs as the HTML is parsed: it
 * reads the build's own list (`warm.json`, written by the game's vite.config bootPreload: the
 * image pack, the fonts, the cover — on R2 — and the bundle's name) and fetches them, so they
 * land in the very cache the game frame below will read. The bundle is behind the play gate: for
 * a player who has no session yet that fetch is a redirect, not followed, and costs nothing.
 * Only when framed — opened directly the page sends people to the site and needs none of it.
 */
const WARM = `(function(){try{if(window.parent===window)return;var h=document.head,pc=function(o){var l=document.createElement('link');l.rel='preconnect';l.href=o;l.crossOrigin='anonymous';h.appendChild(l)};pc('https://assets.apedroidz.com');var dir=location.origin+'/droidz_survival/play/',get=function(u,o){return fetch(u,o).then(function(r){return r.type==='opaqueredirect'?null:r.arrayBuffer()}).catch(function(){})};fetch(dir+'warm.json',{cache:'no-cache'}).then(function(r){return r.ok?r.json():null}).then(function(w){if(!w)return;(w.assets||[]).forEach(function(u){get(new URL(u,dir).href,{mode:'cors',credentials:'same-origin'})});if(w.bundle)get(dir+w.bundle,{redirect:'manual'})}).catch(function(){})}catch(e){}})()`

export default function OthersideLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <script dangerouslySetInnerHTML={{ __html: EARLY_READY }} />
            <script dangerouslySetInnerHTML={{ __html: WARM }} />
            {children}
        </>
    )
}
