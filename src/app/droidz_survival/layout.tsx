import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

// The page itself is a client component (wallet hooks), so the link preview lives here.
// The image is the beta cover from the game folder (art/DS_Beta_cover.jpg, 16:9) — the
// owner, 19.09: «когда я скидываю ссылку на дроидз сервайвал, поставить картинку-заглушку».
const TITLE = 'Droidz Survival — OPEN BETA is LIVE | ApeDroidz'
const DESCRIPTION = 'Pixel roguelite on ApeChain. Pick a droid, survive the waves, climb the season board. Open beta — connect a wallet and play.'
const COVER = { url: '/droidz_survival/DS_Beta_cover.jpg', width: 1200, height: 675, alt: 'Droidz Survival — a droid raising its blade' }

/**
 * The home-screen app (owner, 02.10.2026: «важно сделать mobile native»). iPhone Safari has no
 * Fullscreen API for anything but video, so a page added to the Home Screen and opened as a web app
 * is the only way to the game without the browser's bars there. What makes the icon open as an app
 * and not as a Safari bookmark: the manifest (public/droidz_survival/manifest.webmanifest, start_url
 * /droidz_survival/play?app=1, scope /droidz_survival) and Apple's web-app tags below. The play page
 * (play/page.tsx) is only the door and the game; the landing (page.tsx) is for everyone else.
 *
 * The manifest and the icons are served past the middleware (the .webmanifest/.png escape in its
 * matcher), so neither the maintenance gate nor the beta gate stands in front of them.
 */
export const metadata: Metadata = {
    title: TITLE,
    description: DESCRIPTION,
    applicationName: 'Droidz Survival',
    manifest: '/droidz_survival/manifest.webmanifest',
    appleWebApp: {
        capable: true,
        title: 'Droidz Survival',
        // The page draws under the status bar; the app shell pads itself by the safe-area insets.
        statusBarStyle: 'black-translucent',
    },
    icons: {
        apple: [{ url: '/droidz_survival/pwa/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    },
    // Chrome on Android reads the manifest; this older tag is still what some Android browsers look for.
    other: { 'mobile-web-app-capable': 'yes' },
    openGraph: {
        type: 'website',
        url: 'https://www.apedroidz.com/droidz_survival',
        siteName: 'ApeDroidz',
        title: TITLE,
        description: DESCRIPTION,
        images: [COVER],
    },
    twitter: {
        card: 'summary_large_image',
        title: TITLE,
        description: DESCRIPTION,
        images: [COVER.url],
        creator: '@ApeDroidz',
    },
}

/** Into the notch (viewport-fit=cover, the shell pads by env(safe-area-inset-*)), and no pinch zoom over the game. */
export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: 'cover',
    themeColor: '#000000',
}

/**
 * Runs while the HTML is parsed, before any bundle:
 *  - the home-screen app opens on the play page (manifest start_url /droidz_survival/play?app=1);
 *    an app added before 03.10.2026 still opens /droidz_survival?app=1 (iOS keeps the URL it was
 *    added with), so the landing hands it on to /play at once, before anything is drawn (fullscreen
 *    counts only on a touch screen: a desktop browser on F11 reports display-mode fullscreen too);
 *  - keeps Android's `beforeinstallprompt` for the Install button (it can fire before React has
 *    hydrated and is not fired twice), on the landing and the play page only;
 *  - nothing else — the site's chrome is hidden in a home-screen app by the CSS below, which needs
 *    no script and so no flash of the header before hydration.
 */
const EARLY = `(function(){try{var p=location.pathname.replace(/\\/+$/,'');if(p==='/droidz_survival'){var q=new URLSearchParams(location.search).get('app')==='1';var m=function(x){return window.matchMedia&&window.matchMedia(x).matches};if(q||navigator.standalone===true||m('(display-mode: standalone)')||(m('(display-mode: fullscreen)')&&m('(pointer: coarse)'))){location.replace('/droidz_survival/play?app=1');return}}else if(p!=='/droidz_survival/play')return;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__dsInstallPrompt=e;window.dispatchEvent(new Event('ds:installable'))});window.addEventListener('appinstalled',function(){window.__dsInstallPrompt=null;window.__dsInstalled=true;window.dispatchEvent(new Event('ds:installable'))})}catch(e){}})()`

/** Opened from the Home Screen: none of the site's page shows, only what page.tsx draws for the app. */
const APP_CSS = `@media (display-mode: standalone), (display-mode: fullscreen) { .ds-site-only { display: none !important } html, body { background: #000 } }`

export default function DroidzSurvivalLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <script dangerouslySetInnerHTML={{ __html: EARLY }} />
            <style dangerouslySetInnerHTML={{ __html: APP_CSS }} />
            {children}
        </>
    )
}
