import type { Metadata } from 'next'

/**
 * Search and answer-engine facts in one place (owner, 10.10.2026: «оптимизируй SEO и GEO для дроидов,
 * игры, коллекции — чтобы мы максимально пушились в поиске»). Search Console reported pages as
 * «Duplicate without user-selected canonical»: every route shared the root's title and description
 * and none named its canonical URL. Now the two real pages (the collection home, the game) carry
 * their own title, description and canonical, and the wallet tools say noindex — they are apps
 * behind a wallet with nothing for a search result to show.
 *
 * Everything said here is what the site itself shows (the home page, the game's landing); keep the
 * two in step — an answer engine quoting a number the page does not have is worse than no number.
 */
export const SITE_URL = 'https://www.apedroidz.com'
export const SITE_NAME = 'ApeDroidz'
export const X_HANDLE = '@ApeDroidz'

export const SAME_AS = [
    'https://x.com/ApeDroidz',
    'https://opensea.io/collection/apedroidz',
]

export const HOME_TITLE = 'ApeDroidz — 3333 Animated NFT Droids on ApeChain'
export const HOME_DESCRIPTION =
    '3333 glitch-born Droidz on ApeChain: pixel art that upgrades into fully animated NFTs, each with a 3D body for Otherside. Upgrades, merges, holder tools and the Droidz Survival game.'

export const GAME_TITLE = 'Droidz Survival — Pixel Roguelite on ApeChain | ApeDroidz'
export const GAME_DESCRIPTION =
    'Droidz Survival is a free-to-try pixel roguelite on ApeChain: pick a droid hero, survive the waves, climb the season leaderboard and play for a real APE prize pool. Desktop and mobile.'

/** A wallet tool or a gate: kept out of the index, its links still followed; no canonical of its own. */
export function toolMeta(title: string): Metadata {
    return {
        title: `${title} | ApeDroidz`,
        robots: { index: false, follow: true },
        alternates: { canonical: null },
    }
}

/** Organization + WebSite, on every page (the root layout). */
export function siteJsonLd(): object {
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'Organization',
                '@id': `${SITE_URL}/#org`,
                name: SITE_NAME,
                url: SITE_URL,
                logo: `${SITE_URL}/icon.png`,
                sameAs: SAME_AS,
                description: HOME_DESCRIPTION,
            },
            {
                '@type': 'WebSite',
                '@id': `${SITE_URL}/#website`,
                name: SITE_NAME,
                url: SITE_URL,
                publisher: { '@id': `${SITE_URL}/#org` },
                inLanguage: 'en',
            },
            {
                // The collection itself, as the home page presents it.
                '@type': 'CreativeWorkSeries',
                '@id': `${SITE_URL}/#collection`,
                name: 'ApeDroidz',
                url: SITE_URL,
                description:
                    'An NFT collection of 3333 Droidz on ApeChain. Every Droid starts as pixel art, upgrades into a fully animated version and ships with a 3D body made for Otherside.',
                creator: { '@id': `${SITE_URL}/#org` },
                sameAs: ['https://opensea.io/collection/apedroidz'],
                keywords: 'ApeDroidz, NFT, ApeChain, animated NFT, pixel art, Otherside, 3D avatar',
            },
        ],
    }
}

export interface FaqItem { q: string; a: string }

/** The game's own FAQ, as plain text — the landing's FAQ block says the same (survival/landing.tsx). */
export const GAME_FAQ: FaqItem[] = [
    { q: 'What is Droidz Survival?', a: 'A pixel roguelite by ApeDroidz on ApeChain. You pick a droid hero, fight wave after wave, level up with a choice of upgrade cards each level, and climb the season leaderboard.' },
    { q: 'Is it free to play?', a: 'Your first run is a free 3-wave trial. After that, runs are bought in the game in APE; half of every payment goes into the season prize pool.' },
    { q: 'Which wallet do I need?', a: 'Any of MetaMask, Coinbase Wallet or Rainbow. You sign one free message to prove the wallet is yours — no transaction, no gas.' },
    { q: 'Why ApeChain?', a: 'Runs, lucky tickets and the prize pool are in APE on ApeChain. Ape Mini, the game’s own coin, is not APE: it cannot be withdrawn, sold or swapped.' },
    { q: 'Can I play on my phone?', a: 'Yes — iPhone and Android, held sideways. Added to the Home Screen it opens full screen as an app.' },
    { q: 'Who gets the prize pool?', a: 'Season-pass holders share it by their best score of the season.' },
]

/** The game page: a VideoGame and its FAQ. */
export function gameJsonLd(): object {
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'VideoGame',
                '@id': `${SITE_URL}/droidz_survival#game`,
                name: 'Droidz Survival',
                url: `${SITE_URL}/droidz_survival`,
                description: GAME_DESCRIPTION,
                image: `${SITE_URL}/droidz_survival/DS_Beta_cover.jpg`,
                genre: ['Roguelite', 'Action', 'Survival', 'Pixel art'],
                gamePlatform: ['Web browser', 'iOS', 'Android'],
                applicationCategory: 'Game',
                operatingSystem: 'Any (web browser)',
                playMode: 'SinglePlayer',
                author: { '@id': `${SITE_URL}/#org` },
                publisher: { '@id': `${SITE_URL}/#org` },
                offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free 3-wave trial; further runs are bought in APE.' },
                isPartOf: { '@id': `${SITE_URL}/#collection` },
            },
            {
                '@type': 'FAQPage',
                '@id': `${SITE_URL}/droidz_survival#faq`,
                mainEntity: GAME_FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
            },
        ],
    }
}

/** A JSON-LD <script> body: `<` escaped so nothing in the data can close the tag. */
export function jsonLd(data: object): string {
    return JSON.stringify(data).replace(/</g, '\\u003c')
}
