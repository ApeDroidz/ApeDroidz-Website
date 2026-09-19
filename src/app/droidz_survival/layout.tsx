import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The page itself is a client component (wallet hooks), so the link preview lives here.
// The image is the beta cover from the game folder (art/DS_Beta_cover.jpg, 16:9) — the
// owner, 19.09: «когда я скидываю ссылку на дроидз сервайвал, поставить картинку-заглушку».
const TITLE = 'Droidz Survival — BETA is LIVE | ApeDroidz'
const DESCRIPTION = 'Pixel roguelite on ApeChain. Pick a droid, survive the waves, climb the season board. Closed beta for ApeDroidz holders.'
const COVER = { url: '/droidz_survival/DS_Beta_cover.jpg', width: 1200, height: 675, alt: 'Droidz Survival — a droid raising its blade' }

export const metadata: Metadata = {
    title: TITLE,
    description: DESCRIPTION,
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

export default function DroidzSurvivalLayout({ children }: { children: ReactNode }) {
    return children
}
