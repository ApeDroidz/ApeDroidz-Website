/**
 * The Droidz Survival journal, from the terminal (survival_events).
 *
 *   node --env-file=.env.local scripts/survival-log.mjs                 # last 40 lines
 *   node --env-file=.env.local scripts/survival-log.mjs errors          # warn+error, last 60
 *   node --env-file=.env.local scripts/survival-log.mjs tail 100        # last N
 *   node --env-file=.env.local scripts/survival-log.mjs wallet 0xabc…   # one wallet, with their runs
 *   node --env-file=.env.local scripts/survival-log.mjs kind run.rejected
 *   node --env-file=.env.local scripts/survival-log.mjs since 2h        # 30m / 2h / 3d
 *   node --env-file=.env.local scripts/survival-log.mjs stats           # counts by level/kind/day
 *   node --env-file=.env.local scripts/survival-log.mjs runs            # last 30 runs with verdicts
 *   node --env-file=.env.local scripts/survival-log.mjs show <id>       # one event, full data
 */
import pg from 'pg'

const [cmd = 'tail', arg] = process.argv.slice(2)
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const rows = async (q, p) => (await client.query(q, p)).rows
const short = (w) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : '—')
const when = (d) => new Date(d).toISOString().replace('T', ' ').slice(5, 19)
const line = (e) => {
    const lvl = { error: '\x1b[31mERR \x1b[0m', warn: '\x1b[33mWARN\x1b[0m', info: 'info', debug: 'dbg ' }[e.level] ?? e.level
    const data = e.data && Object.keys(e.data).length ? ' ' + JSON.stringify(e.data).slice(0, 160) : ''
    return `${String(e.id).padStart(6)} ${when(e.at)} ${lvl} ${e.source === 'client' ? 'C' : 'S'} ${short(e.wallet).padEnd(11)} ${e.kind.padEnd(18)} ${(e.message || '').slice(0, 80)}${data}`
}
const print = (list) => { if (!list.length) console.log('(nothing)'); for (const e of [...list].reverse()) console.log(line(e)) }
const sinceMs = (s) => { const m = /^(\d+)([mhd])$/.exec(s ?? ''); if (!m) return 24 * 3600e3; return Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]] }

try {
    if (cmd === 'tail') print(await rows('select * from survival_events order by at desc limit $1', [Number(arg) || 40]))
    else if (cmd === 'errors') print(await rows("select * from survival_events where level in ('warn','error') order by at desc limit $1", [Number(arg) || 60]))
    else if (cmd === 'kind') print(await rows('select * from survival_events where kind = $1 order by at desc limit 60', [arg]))
    else if (cmd === 'since') print(await rows('select * from survival_events where at > now() - ($1::bigint * interval \'1 millisecond\') order by at desc limit 200', [sinceMs(arg)]))
    else if (cmd === 'show') { const [e] = await rows('select * from survival_events where id = $1', [Number(arg)]); console.log(JSON.stringify(e, null, 2)) }
    else if (cmd === 'wallet') {
        const w = String(arg).toLowerCase()
        console.log('— player —'); console.log(JSON.stringify((await rows('select * from survival_players where wallet=$1', [w]))[0] ?? null))
        console.log('— profile —'); const [p] = await rows('select coins, runs, best_score, selected_hero, updated_at from survival_profiles where wallet=$1', [w]); console.log(JSON.stringify(p ?? null))
        console.log('— runs —'); for (const r of await rows('select id, status, reject_reason, score, wave, kills, started_at, server_duration_ms from survival_runs where wallet=$1 order by started_at desc limit 20', [w])) console.log(`${when(r.started_at)} ${r.status.padEnd(8)} ${(r.reject_reason || '').padEnd(24)} score ${r.score} wave ${r.wave} kills ${r.kills} ${Math.round((r.server_duration_ms || 0) / 1000)}s  ${r.id}`)
        console.log('— events —'); print(await rows('select * from survival_events where wallet=$1 order by at desc limit 40', [w]))
    }
    else if (cmd === 'runs') for (const r of await rows('select id, wallet, status, reject_reason, score, wave, kills, started_at, server_duration_ms, client_version from survival_runs order by started_at desc limit $1', [Number(arg) || 30])) console.log(`${when(r.started_at)} ${short(r.wallet)} ${r.status.padEnd(8)} ${(r.reject_reason || '').padEnd(24)} score ${String(r.score).padStart(7)} wave ${String(r.wave).padStart(2)} kills ${String(r.kills).padStart(4)} ${String(Math.round((r.server_duration_ms || 0) / 1000)).padStart(4)}s ${r.client_version || ''}`)
    else if (cmd === 'stats') {
        console.log('by level (7d):'); console.table(await rows("select level, count(*)::int as n from survival_events where at > now() - interval '7 days' group by level order by n desc"))
        console.log('by kind (7d):'); console.table(await rows("select kind, count(*)::int as n from survival_events where at > now() - interval '7 days' group by kind order by n desc limit 20"))
        console.log('runs by status:'); console.table(await rows('select status, count(*)::int as n from survival_runs group by status order by n desc'))
        console.log('per day:'); console.table(await rows("select to_char(at, 'MM-DD') as day, count(*) filter (where level='error')::int as errors, count(*) filter (where level='warn')::int as warns, count(*)::int as total from survival_events where at > now() - interval '14 days' group by 1 order by 1 desc"))
    }
    else console.log('commands: tail [n] | errors [n] | kind <kind> | since <30m|2h|3d> | show <id> | wallet <0x…> | runs [n] | stats')
} finally { await client.end() }
