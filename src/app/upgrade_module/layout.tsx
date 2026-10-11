import type { ReactNode } from 'react'
import { toolMeta } from '@/lib/seo'

// A wallet tool, not a page for search: noindex, its own title, no canonical (lib/seo.ts toolMeta).
export const metadata = toolMeta('Upgrade Module')

export default function Layout({ children }: { children: ReactNode }) {
    return children
}
