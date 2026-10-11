import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

/**
 * sitemap.xml: the pages meant for search — the collection's home and the game. The wallet tools,
 * the game's play screen and the admin are left out on purpose (they say noindex). llms.txt is the
 * same map for answer engines.
 */
export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date()
    return [
        { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
        { url: `${SITE_URL}/droidz_survival`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    ]
}
