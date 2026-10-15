import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/survivalFetchAll'
import { avatarOf } from '@/lib/survivalNfts'

/**
 * GET /api/survival/coop/board — the live season's CO-OP board (owner, 15.10.2026: one row per
 * team — who played, the wave, the team's score; opened, each member's own part).
 *
 *   { seasonId, seasonName, rows: [{ rank, score, wave, kills, timeMs, finishedAt,
 *       members: [{ wallet, nickname, x, avatar, hero, score, kills, pass, counted }] }] }
 *
 * Rows come from survival_coop_runs (lib/survivalCoop.ts settleCoop), only finished teams. A
 * member whose run was refused or made up a wave (`counted: false`) stays in the list of who
 * played, with nothing counted. `pass` marks who holds the season pass — only they share the
 * co-op pool. Public and read-only, cached for a few seconds like the solo board.
 */
export const dynamic = 'force-dynamic'

const LIMIT = 50
const HEADERS = { 'cache-control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=60' }
let memo: { until: number; body: Promise<Record<string, unknown> | null> } | null = null

interface TeamRow {
    id: string; score: number; wave: number; kills: number; started_at: string; finished_at: string | null
    members: { wallet: string; run_id: string; status: string; score: number; kills: number; hero: string | null }[]
    flags: string[] | null
}
interface PlayerRow { wallet: string; banned?: boolean; nickname?: string | null; avatar?: unknown }

export async function GET() {
    if (!supabaseAdmin) return new NextResponse(null, { status: 204 })
    const now = Date.now()
    if (!memo || memo.until < now) memo = { until: now + 10_000, body: build().catch(() => null) }
    const body = await memo.body
    if (!body) { memo = null; return new NextResponse(null, { status: 204 }) }
    return NextResponse.json(body, { headers: HEADERS })
}

async function build(): Promise<Record<string, unknown> | null> {
    const { data: season } = await supabaseAdmin.from('survival_seasons').select('id, name').eq('status', 'live').limit(1).maybeSingle()
    if (!season) return null
    const { data: teams, error } = await supabaseAdmin.from('survival_coop_runs')
        .select('id, score, wave, kills, started_at, finished_at, members, flags')
        .eq('season_id', season.id).eq('status', 'finished')
        .order('score', { ascending: false }).order('finished_at', { ascending: true }).limit(LIMIT)
    if (error) { console.warn('[survival/coop/board]', error.message); return null }
    const rowsT = (teams ?? []) as TeamRow[]
    const wallets = [...new Set(rowsT.flatMap((t) => (t.members ?? []).map((m) => m.wallet)))]
    const [playersQ, xsQ, passQ] = await Promise.all([
        wallets.length ? supabaseAdmin.from('survival_players').select('*').in('wallet', wallets) : Promise.resolve({ data: [] }),
        wallets.length
            ? supabaseAdmin.from('glitch_users').select('wallet_address, x_handle').or(wallets.map((w) => `wallet_address.ilike.${w}`).join(','))
            : Promise.resolve({ data: [] }),
        fetchAll<{ wallet: string }>(() => supabaseAdmin.from('survival_entitlements').select('wallet')
            .eq('kind', 'season_pass').not('sku', 'like', 'test_%').or(`season_id.eq.${season.id},season_id.is.null`).order('id'), { cap: 20_000 }),
    ])
    const players = new Map(((playersQ.data ?? []) as PlayerRow[]).map((p) => [p.wallet, p]))
    const xOf = new Map<string, string>()
    for (const r of (xsQ.data ?? []) as { wallet_address: string; x_handle: string | null }[]) if (r.x_handle) xOf.set(r.wallet_address.toLowerCase(), r.x_handle)
    const pass = new Set(passQ.rows.map((p) => p.wallet))

    let rank = 0
    const rows = rowsT
        // A team with a banned member is not shown (the same rule as the solo board's).
        .filter((t) => !(t.members ?? []).some((m) => players.get(m.wallet)?.banned))
        .map((t) => {
            rank += 1
            const off = new Set((t.flags ?? []).filter((f) => f.startsWith('wave_outlier:')).map((f) => f.slice('wave_outlier:'.length)))
            return {
                rank, score: Number(t.score), wave: Number(t.wave), kills: Number(t.kills),
                timeMs: t.finished_at ? Date.parse(t.finished_at) - Date.parse(t.started_at) : null,
                finishedAt: t.finished_at,
                members: (t.members ?? []).map((m) => ({
                    wallet: `${m.wallet.slice(0, 6)}…${m.wallet.slice(-4)}`,
                    nickname: players.get(m.wallet)?.nickname ?? null,
                    x: xOf.get(m.wallet) ?? null,
                    avatar: avatarOf(players.get(m.wallet)?.avatar)?.image ?? null,
                    hero: m.hero, score: Number(m.score ?? 0), kills: Number(m.kills ?? 0),
                    pass: pass.has(m.wallet),
                    counted: m.status === 'finished' && !off.has(m.wallet),
                })),
            }
        })
    return { seasonId: season.id, seasonName: season.name, rows }
}
