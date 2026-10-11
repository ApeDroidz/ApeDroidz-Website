import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

/**
 * robots.txt (owner, 10.10.2026: SEO/GEO pass). Everything public is open to search and to the answer
 * engines' crawlers (named, so a blanket rule elsewhere can never shut them out); the API, the admin
 * panel and the embeds are not pages. The wallet tools are open to crawl but say noindex themselves.
 */
export default function robots(): MetadataRoute.Robots {
    const closed = ['/api/', '/spltpnl', '/embed/']
    return {
        rules: [
            { userAgent: '*', allow: '/', disallow: closed },
            ...['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'CCBot']
                .map((userAgent) => ({ userAgent, allow: '/', disallow: closed })),
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
        host: SITE_URL,
    }
}
