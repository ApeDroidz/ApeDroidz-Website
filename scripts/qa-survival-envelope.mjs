/**
 * The plausibility envelope, checked at the edges (src/lib/survivalEnvelope.ts).
 *
 * The owner's condition for this code: it must never reject a legitimate run. So the honest
 * cases here are deliberately awkward — a run paused in drafts for minutes, a background tab,
 * pulses dropped by a bad network, a boss-heavy score, a wave-1 death — and every one of them
 * must come back `ok`. Then the lies: a forged score, a wave ahead of the clock, a fast client,
 * kills nobody spawned, a trail that runs backwards — every one `cheat`.
 *
 *   node scripts/qa-survival-envelope.mjs
 */
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The site is a CommonJS package, so node cannot import the .ts module directly; transpile it
// (it has no imports of its own) and load the result as ESM.
const src = readFileSync('src/lib/survivalEnvelope.ts', 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const dir = join(tmpdir(), 'survival-envelope-test'); mkdirSync(dir, { recursive: true })
const out = join(dir, 'survivalEnvelope.mjs'); writeFileSync(out, js)
const { checkFinish, checkPulse, scoreCap, killsCap, waveCap, MSG } = await import(pathToFileURL(out).href)

const s = (ms) => ms * 1000
const cases = []
const t = (name, got, want) => cases.push([name, got.verdict === want, `${got.verdict}${got.reason ? ':' + got.reason : ''} flags=${got.flags.join(',') || '-'}`])

// ── honest runs ────────────────────────────────────────────────────────────────────────────
t('wave-1 death after 40 s, 3 kills', checkFinish({ serverDurationMs: s(40), lastPulse: null, pulseCount: 0 }, { wave: 1, kills: 3, score: 40, durationMs: s(38) }), 'ok')
t('long run, exact 30 s waves, every pulse', checkFinish({ serverDurationMs: s(30 * 19 + 5), lastPulse: { wave: 20, kills: 3200, score: 300000 }, pulseCount: 19 }, { wave: 20, kills: 3300, score: 320000, durationMs: s(30 * 19 + 4) }), 'ok')
t('paused in drafts: 10 min of wall time for wave 6', checkFinish({ serverDurationMs: s(600), lastPulse: { wave: 6, kills: 700, score: 40000 }, pulseCount: 5 }, { wave: 6, kills: 760, score: 42000, durationMs: s(170) }), 'ok')
t('background tab: 2 h of wall time, wave 9', checkFinish({ serverDurationMs: s(7200), lastPulse: null, pulseCount: 0 }, { wave: 9, kills: 1000, score: 60000, durationMs: s(250) }), 'ok')
t('pulses dropped by the network (0 of 11)', checkFinish({ serverDurationMs: s(340), lastPulse: null, pulseCount: 0 }, { wave: 12, kills: 1800, score: 150000, durationMs: s(335) }), 'ok')
t('boss-heavy score: 3 bosses, elites, top multiplier', checkFinish({ serverDurationMs: s(460), lastPulse: null, pulseCount: 0 }, { wave: 16, kills: 2900, score: 900000, durationMs: s(455) }), 'ok')
t('splitters everywhere: 280 kills a wave', checkFinish({ serverDurationMs: s(300), lastPulse: null, pulseCount: 0 }, { wave: 11, kills: 3080, score: 200000, durationMs: s(298) }), 'ok')
t('continue after death: same run, later finish', checkFinish({ serverDurationMs: s(500), lastPulse: { wave: 8, kills: 900, score: 50000 }, pulseCount: 7 }, { wave: 15, kills: 2100, score: 140000, durationMs: s(440) }), 'ok')
t('client clock a few seconds ahead of the server (request latency at start)', checkFinish({ serverDurationMs: s(120), lastPulse: null, pulseCount: 0 }, { wave: 4, kills: 300, score: 9000, durationMs: s(124) }), 'ok')
t('wave boundary: 30.0 s on the client, 29.5 s on the server', checkFinish({ serverDurationMs: 29_500, lastPulse: null, pulseCount: 0 }, { wave: 2, kills: 60, score: 800, durationMs: 30_000 }), 'ok')
t('pulse: first heartbeat at wave 2 after 30 s', checkPulse(null, { wave: 2, kills: 40, score: 600 }, s(30)), 'ok')
t('pulse: same wave twice (client retried)', checkPulse({ wave: 5, kills: 400, score: 9000 }, { wave: 5, kills: 400, score: 9000 }, s(140)), 'ok')

// ── not runs ───────────────────────────────────────────────────────────────────────────────
t('misclick: 6 s, no kills → void, not cheat', checkFinish({ serverDurationMs: s(6), lastPulse: null, pulseCount: 0 }, { wave: 1, kills: 0, score: 0, durationMs: s(5) }), 'void')
t('AFK: 3 min, zero kills → void', checkFinish({ serverDurationMs: s(180), lastPulse: null, pulseCount: 0 }, { wave: 6, kills: 0, score: 0, durationMs: s(175) }), 'void')

// ── lies ───────────────────────────────────────────────────────────────────────────────────
t('score: 999999999', checkFinish({ serverDurationMs: s(200), lastPulse: null, pulseCount: 0 }, { wave: 7, kills: 500, score: 999_999_999, durationMs: s(198) }), 'cheat')
t('wave 30 after 90 s', checkFinish({ serverDurationMs: s(90), lastPulse: null, pulseCount: 0 }, { wave: 30, kills: 400, score: 20000, durationMs: s(88) }), 'cheat')
t('client played 20 min in 2 min of wall time', checkFinish({ serverDurationMs: s(120), lastPulse: null, pulseCount: 0 }, { wave: 4, kills: 300, score: 9000, durationMs: s(1200) }), 'cheat')
t('kills nobody spawned: 9000 by wave 3', checkFinish({ serverDurationMs: s(95), lastPulse: null, pulseCount: 0 }, { wave: 3, kills: 9000, score: 90000, durationMs: s(94) }), 'cheat')
t('finish below the last pulse', checkFinish({ serverDurationMs: s(300), lastPulse: { wave: 9, kills: 900, score: 50000 }, pulseCount: 8 }, { wave: 9, kills: 900, score: 49000, durationMs: s(298) }), 'cheat')
t('pulse: wave went backwards', checkPulse({ wave: 6, kills: 500, score: 9000 }, { wave: 5, kills: 520, score: 9500 }, s(200)), 'cheat')
t('pulse: wave 12 after 40 s', checkPulse(null, { wave: 12, kills: 100, score: 3000 }, s(40)), 'cheat')
t('pulse: negative kills', checkPulse(null, { wave: 2, kills: -3, score: 10 }, s(40)), 'cheat')
t('forged score inside the first 15 s is still cheat', checkFinish({ serverDurationMs: s(6), lastPulse: null, pulseCount: 0 }, { wave: 1, kills: 2, score: 999_999_999, durationMs: s(5) }), 'cheat')
t('finish: non-integer score', checkFinish({ serverDurationMs: s(60), lastPulse: null, pulseCount: 0 }, { wave: 2, kills: 10, score: 12.5, durationMs: s(58) }), 'cheat')

// ── the caps themselves stay above anything the game can produce ──────────────────────────
cases.push(['waveCap(0) allows wave 2 (the boundary)', waveCap(0) === 2, String(waveCap(0))])
cases.push(['killsCap(1) ≥ 200 + summons', killsCap(1) >= 300, String(killsCap(1))])
cases.push(['scoreCap grows with kills', scoreCap(100, 5) < scoreCap(200, 5), ''])
cases.push(['messages are the ones the player reads', MSG.cheat.includes('CHEATING DETECTED') && MSG.short.includes('TOO SHORT'), ''])

let pass = true
for (const [n, ok, info] of cases) { if (!ok) pass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}   (${info})`) }
console.log(pass ? '\n✅ ENVELOPE TEST PASS' : '\n❌ ENVELOPE TEST FAIL')
process.exit(pass ? 0 : 1)
