import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { logEvent } from '@/lib/survivalLog'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }
const OPENSEA = 'https://api.opensea.io/api/v2'

/**
 * The clan registry from the panel.
 *
 *   GET  /api/admin/survival/clans                          → every clan, active or not
 *   POST /api/admin/survival/clans { action: 'add', contract, chain?, name? }
 *        The owner pastes the NFT contract address; chain is 'ape_chain' (33139, the default)
 *        or 'ethereum' (1). OpenSea resolves the collection from it (slug), then the collection
 *        gives the name and PFP. The name can be overridden, the image is the collection's own.
 *   POST /api/admin/survival/clans { action: 'add', openseaSlug, name? }
 *        The older way in, still valid: by slug alone. A 0x… pasted as the slug is treated as
 *        a contract, because that is what people do.
 *   POST /api/admin/survival/clans { action: 'refresh', slug }   — re-read OpenSea (by contract if the row has one)
 *   POST /api/admin/survival/clans { action: 'delete', slug }    — the row is gone (the owner: deleted clans are gone,
 *        not greyed out); a player who flew that flag keeps the name in survival_players.clan,
 *        the picker just no longer offers it
 *   POST /api/admin/survival/clans { action: 'remove', slug }    — hide from the picker, keep the row
 *   POST /api/admin/survival/clans { action: 'restore', slug }
 */
interface OsCollection { collection?: string; name?: string; image_url?: string | null; contracts?: Array<{ address: string; chain: string }> }
interface OsContract { address?: string; chain?: string; collection?: string; name?: string }

const CONTRACT_RE = /^0x[0-9a-f]{40}$/
const SLUG_RE = /^[a-z0-9-]{1,80}$/
/** OpenSea chain names, and the chain ids people paste instead. */
const CHAINS: Record<string, string> = { ape_chain: 'ape_chain', apechain: 'ape_chain', '33139': 'ape_chain', ethereum: 'ethereum', eth: 'ethereum', '1': 'ethereum' }

const osHeaders = (): Record<string, string> => {
    const key = process.env.OPENSEA_API_KEY
    return key ? { 'x-api-key': key, accept: 'application/json' } : { accept: 'application/json' }
}
async function osGet<T>(path: string): Promise<T | null> {
    try {
        const r = await fetch(`${OPENSEA}${path}`, { headers: osHeaders(), cache: 'no-store' })
        if (!r.ok) return null
        return (await r.json()) as T
    } catch { return null }
}
const lookupCollection = (openseaSlug: string) => osGet<OsCollection>(`/collections/${encodeURIComponent(openseaSlug)}`)
const lookupContract = (chain: string, contract: string) => osGet<OsContract>(`/chain/${encodeURIComponent(chain)}/contract/${contract}`)

/** Resolve a collection by contract first, by slug second. Null if OpenSea knows neither. */
async function resolve(input: { contract: string | null; chain: string; openseaSlug: string | null }): Promise<{ os: OsCollection; openseaSlug: string; contract: string | null; chain: string | null } | null> {
    if (input.contract) {
        const c = await lookupContract(input.chain, input.contract)
        // An unknown contract is not a 404 on OpenSea: it is a 200 placeholder whose "collection"
        // is the address itself. That is not a clan, so it counts as not found.
        if (c?.collection && !CONTRACT_RE.test(c.collection)) {
            const os = await lookupCollection(c.collection)
            if (os) return { os, openseaSlug: c.collection, contract: input.contract, chain: c.chain ?? input.chain }
            // The collection endpoint failed but the contract answered: enough for a row.
            return { os: { name: c.name, image_url: null }, openseaSlug: c.collection, contract: input.contract, chain: c.chain ?? input.chain }
        }
    }
    if (input.openseaSlug) {
        const os = await lookupCollection(input.openseaSlug)
        if (os) {
            const c = os.contracts?.[0]
            return { os, openseaSlug: input.openseaSlug, contract: c?.address?.toLowerCase() ?? input.contract, chain: c?.chain ?? (input.contract ? input.chain : null) }
        }
    }
    return null
}

export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const { data } = await supabaseAdmin.from('survival_clans').select('*').order('name', { ascending: true })
    return NextResponse.json({ clans: data ?? [] }, { headers })
}

export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action ?? '')
    const now = new Date().toISOString()
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

    if (action === 'add' || action === 'refresh') {
        let slug = str(body.slug)
        let contract: string | null = null
        let openseaSlug: string | null = null
        let chain = CHAINS[str(body.chain).toLowerCase()] ?? 'ape_chain'

        if (action === 'refresh') {
            const { data: cur } = await supabaseAdmin.from('survival_clans').select('opensea_slug, contract, chain').eq('slug', slug).maybeSingle()
            const row = cur as { opensea_slug: string | null; contract: string | null; chain: string | null } | null
            if (!row) return NextResponse.json({ error: `No clan "${slug}"` }, { status: 404, headers })
            contract = row.contract; openseaSlug = row.opensea_slug; chain = row.chain ?? chain
        } else {
            // Either field may carry the contract: the form has one box, and a 0x… is a contract wherever it lands.
            const raw = [str(body.contract), str(body.openseaSlug)].map((s) => s.toLowerCase())
            contract = raw.find((s) => CONTRACT_RE.test(s)) ?? null
            openseaSlug = raw.find((s) => s && !CONTRACT_RE.test(s)) ?? null
            if (!contract && !openseaSlug) return NextResponse.json({ error: 'Paste the collection contract (0x…) or its OpenSea slug' }, { status: 400, headers })
            if (openseaSlug && !SLUG_RE.test(openseaSlug)) return NextResponse.json({ error: 'Not an OpenSea collection slug' }, { status: 400, headers })
        }

        const found = await resolve({ contract, chain, openseaSlug })
        if (!found) {
            const what = contract ? `contract ${contract} on ${chain}` : `"${openseaSlug}"`
            return NextResponse.json({ error: `OpenSea does not know ${what}` }, { status: 404, headers })
        }
        if (!slug) slug = found.openseaSlug
        const name = str(body.name) ? str(body.name).slice(0, 40) : (found.os.name ?? found.openseaSlug).slice(0, 40)
        const row = {
            slug, name, opensea_slug: found.openseaSlug, chain: found.chain, contract: found.contract,
            image_url: found.os.image_url ?? null, active: true, updated_at: now,
        }
        const { error } = await supabaseAdmin.from('survival_clans').upsert(row, { onConflict: 'slug' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
        logEvent({ level: 'info', kind: `clan.${action}`, message: name, data: { slug, openseaSlug: found.openseaSlug, contract: found.contract, chain: found.chain, image: !!row.image_url, by: 'spltpnl' } })
        return NextResponse.json({ ok: true, clan: row }, { headers })
    }
    if (action === 'delete') {
        const slug = str(body.slug)
        if (!slug) return NextResponse.json({ error: 'No slug' }, { status: 400, headers })
        const { data, error } = await supabaseAdmin.from('survival_clans').delete().eq('slug', slug).select('slug, name')
        if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
        if (!data?.length) return NextResponse.json({ error: `No clan "${slug}"` }, { status: 404, headers })
        logEvent({ level: 'info', kind: 'clan.delete', message: (data[0] as { name: string }).name, data: { slug, by: 'spltpnl' } })
        return NextResponse.json({ ok: true, deleted: slug }, { headers })
    }
    if (action === 'remove' || action === 'restore') {
        const slug = str(body.slug)
        const { error } = await supabaseAdmin.from('survival_clans').update({ active: action === 'restore', updated_at: now }).eq('slug', slug)
        if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
        logEvent({ level: 'info', kind: `clan.${action}`, message: slug, data: { by: 'spltpnl' } })
        return NextResponse.json({ ok: true }, { headers })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers })
}
