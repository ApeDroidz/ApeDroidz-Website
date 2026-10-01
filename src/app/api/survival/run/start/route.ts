import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, closeAbandoned, flagsOf, noServer, readBody, refundRunCredits, REFUNDED_FLAG, RUN_COLUMNS, type RunRow } from '@/lib/survivalRuns'
import { RUN_TTL_MS } from '@/lib/survivalEnvelope'
import { economyOf, RETIRED_HEROES, type SaveState } from '@/lib/survivalEconomy'
import { currentEpoch } from '@/lib/survivalEconomyStore'
import { logEvent } from '@/lib/survivalLog'


/**
 * POST /api/survival/run/start  { hero, weapon, clientVersion }
 *
 * Opens a run ticket (PRIZE_POOL.md §5, layer 1). The server, not the client, owns the clock:
 * `started_at` is now(), and every later check measures against it. Replies:
 *   { ok: true,  runId, seed, seasonId }
 *   { ok: false, state: 'no_season' | 'banned' | 'rate_limited' | 'no_server' }
 *
 * One active run per wallet: a still-open ticket of THIS wallet is closed — `superseded`, or
 * `expired` when nothing was heard from it (last pulse, else start) for RUN_TTL (24 h). Closed, not
 * rejected, and not silently voided: a run that pulsed counts as far as its last pulse, a paid run
 * that never pulsed gets its credit back (lib/survivalRuns.ts closeAbandoned). Other wallets' runs
 * are never touched here — this used to void EVERY open run older than 6 h from its start, the
 * pulsing four-hour runs of other players included.
 *
 * The independent reads go out together: eight round trips in a row outlasted the game's 4 s
 * timeout, and a start the game gave up on is a run that is never recorded.
 *
 * Paid runs (SURVIVAL_PAID_RUNS=1): the run takes one of the player's credits (bought through
 * the cashier — api/survival/order) atomically, oldest first (survival_consume_credit, SKIP
 * LOCKED: two tabs can never spend one credit). No credit → the ticket is voided with reason
 * `no_credit` and the reply is { ok: false, state: 'no_credit' }. Off (the beta): free, as before.
 */
export const dynamic = 'force-dynamic'

const STARTS_PER_HOUR = 40

export async function POST(req: NextRequest) {
    // A new run asks the gate again: a ban or SURVIVAL_PUBLIC=0 reaches an open tab here.
    const caller = await authCaller(req, { recheck: true })
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    const str = (v: unknown, max = 40) => (typeof v === 'string' ? v.slice(0, max) : null)
    const now = Date.now()

    // The clan they fly (optional, from the game's own list — anything else is stored as none).
    const askedClan = typeof body.clan === 'string' && body.clan ? body.clan.slice(0, 40) : null
    const clanOf = async (): Promise<string | null> => {
        if (!askedClan) return null
        const { data: known } = await supabaseAdmin.from('survival_clans').select('name').eq('active', true).eq('name', askedClan).maybeSingle()
        return known ? (known as { name: string }).name : null
    }
    const since = new Date(now - 60 * 60 * 1000).toISOString()
    const [clan, playerQ, seasonQ, startsQ, openQ, profQ] = await Promise.all([
        clanOf(),
        // The player row: first seen / last seen, and the ban flag.
        supabaseAdmin.from('survival_players')
            .upsert({ wallet: caller.wallet, last_seen: new Date(now).toISOString() }, { onConflict: 'wallet' })
            .select('banned, clan').single(),
        supabaseAdmin.from('survival_seasons').select('id, ends_at').eq('status', 'live').limit(1).maybeSingle(),
        // Bot farms: more starts than a human could play.
        supabaseAdmin.from('survival_runs').select('id', { count: 'exact', head: true })
            .eq('wallet', caller.wallet).gte('started_at', since),
        // This wallet's tickets still open — closed below.
        supabaseAdmin.from('survival_runs').select(RUN_COLUMNS).eq('wallet', caller.wallet).eq('status', 'started'),
        // The save's heroes: a run is opened only with a hero the wallet owns (the save in the
        // browser is not the judge — the server's economy is).
        supabaseAdmin.from('survival_profiles').select('state').eq('wallet', caller.wallet).maybeSingle(),
    ])
    if (playerQ.error) { console.error('[survival/run/start] player', playerQ.error.message); return noServer('run.start.player', playerQ.error.message) }
    const player = playerQ.data as { banned?: boolean; clan?: string | null } | null
    if (player?.banned) return NextResponse.json({ ok: false, state: 'banned' })
    if (seasonQ.error) { console.error('[survival/run/start] season', seasonQ.error.message); return noServer('run.start.season', seasonQ.error.message) }
    const season = seasonQ.data as { id: string; ends_at: string | null } | null
    if (!season) return NextResponse.json({ ok: false, state: 'no_season' })
    // The season is over at its ends_at, whether or not its status was switched yet: a run
    // started after it would change the standings the pool is paid by.
    if (season.ends_at && Date.parse(season.ends_at) <= now) return NextResponse.json({ ok: false, state: 'season_over' })
    if (startsQ.error) { console.error('[survival/run/start] count', startsQ.error.message); return noServer('run.start.count', startsQ.error.message) }
    if ((startsQ.count ?? 0) >= STARTS_PER_HOUR) return NextResponse.json({ ok: false, state: 'rate_limited' })
    if (openQ.error) { console.error('[survival/run/start] open runs', openQ.error.message); return noServer('run.start.open_runs', openQ.error.message) }
    if (profQ.error) { console.error('[survival/run/start] profile', profQ.error.message); return noServer('run.start.profile', profQ.error.message) }
    const hero = str(body.hero)
    const saved = ((profQ.data as { state?: SaveState } | null)?.state ?? {}) as SaveState
    // A save from before the current epoch is wiped at its next read (survivalEconomyStore): it owns only the free heroes.
    const epoch = currentEpoch()
    const owned = economyOf(epoch && saved.epoch !== epoch ? {} : saved).unlockedHeroes as string[]
    if (!hero || !owned.includes(hero) || RETIRED_HEROES.includes(hero)) {
        // Refused before a credit is spent: nothing is lost, and the game says why.
        logEvent({ level: 'warn', kind: 'run.hero_not_owned', wallet: caller.wallet, message: String(hero), data: { owned } })
        return NextResponse.json({ ok: false, state: 'not_owned' }, { headers: { 'cache-control': 'no-store' } })
    }

    // Close what this wallet left open, write the clan, open the new ticket — together. Closing
    // finishes before a credit is spent below, so a paid run refunded here can pay for this one.
    const stale = now - RUN_TTL_MS
    const open = (openQ.data ?? []) as unknown as RunRow[]
    // The seed: handed out by the server so a future replay can reproduce the run.
    const seed = Number(BigInt.asUintN(52, BigInt('0x' + crypto.randomUUID().replace(/-/g, '').slice(0, 13))))
    const [, , inserted] = await Promise.all([
        Promise.all(open.map((r) => closeAbandoned(r, Date.parse(r.last_pulse_at ?? r.started_at) < stale ? 'expired' : 'superseded'))),
        (player?.clan ?? null) !== clan
            ? supabaseAdmin.from('survival_players').update({ clan }).eq('wallet', caller.wallet).then(({ error }: { error: { message: string } | null }) => {
                if (error) console.error('[survival/run/start] clan', error.message)
            })
            : null,
        supabaseAdmin
            .from('survival_runs')
            .insert({
                season_id: season.id, wallet: caller.wallet, status: 'started',
                hero, weapon: str(body.weapon), client_version: str(body.clientVersion, 64),
                // Co-op runs do not exist yet; everything is solo until the co-op server does.
                mode: 'solo',
                rng_seed: seed,
            })
            .select('id')
            .single(),
    ])
    const run = inserted.data as { id: string } | null
    if (inserted.error || !run) { console.error('[survival/run/start] insert', inserted.error?.message); return noServer('run.start.insert', inserted.error?.message) }
    if (process.env.SURVIVAL_PAID_RUNS === '1') {
        const { data: creditId, error: kErr } = await supabaseAdmin.rpc('survival_consume_credit', { p_wallet: caller.wallet, p_run: run.id, p_mode: 'solo' })
        if (kErr || !creditId) {
            if (kErr) console.error('[survival/run/start] credit', kErr.message)
            await supabaseAdmin.from('survival_runs').update({ status: 'void', reject_reason: 'no_credit' }).eq('id', run.id)
            return kErr ? noServer() : NextResponse.json({ ok: false, state: 'no_credit' }, { headers: { 'cache-control': 'no-store' } })
        }
        // Tied to the run only while it is still open. A start the game gave up on (timeout) and
        // asked again for is closed by that second start — possibly before this credit was spent,
        // when there was nothing to refund yet: then the credit goes back here, not lost with it.
        const { data: tied } = await supabaseAdmin.from('survival_runs').update({ credit_id: creditId }).eq('id', run.id).eq('status', 'started').select(RUN_COLUMNS)
        if (!tied?.length) {
            const { data: closed } = await supabaseAdmin.from('survival_runs').select(RUN_COLUMNS).eq('id', run.id).maybeSingle()
            const row = closed as unknown as RunRow | null
            if (row && row.pulse_count === 0 && !flagsOf(row).includes(REFUNDED_FLAG)) await refundRunCredits({ ...row, credit_id: String(creditId) }, 'closed_before_credit')
            return NextResponse.json({ ok: false, state: 'run_closed' }, { headers: { 'cache-control': 'no-store' } })
        }
    }

    return NextResponse.json(
        { ok: true, runId: run.id, seed, seasonId: season.id },
        { headers: { 'cache-control': 'no-store' } },
    )
}
