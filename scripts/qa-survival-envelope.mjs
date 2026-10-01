/**
 * The plausibility envelope, checked at the edges (src/lib/survivalEnvelope.ts).
 *
 * The owner's condition for this code: it must never reject a legitimate run. So the honest
 * cases here are deliberately awkward — a run paused in drafts for minutes, a background tab,
 * pulses dropped by a bad network, a boss-heavy score, a wave-1 death — and every one of them
 * must come back `ok` — and so must the five honest runs the old «25 s a wave» rule refused after
 * waves became cleared, not timed (18.09). A wave ahead of the physical pace is only a flag. Then
 * the lies: a forged score, a wave no balance could reach, a fast client, kills nobody spawned, a
 * trail that runs backwards — every one `cheat`.
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
const { checkFinish, checkPulse, scoreCap, killsCap, waveCap, waveHardCap, waveReachSeconds, MSG } = await import(pathToFileURL(out).href)

const s = (ms) => ms * 1000
const cases = []
const t = (name, got, want) => cases.push([name, got.verdict === want, `${got.verdict}${got.reason ? ':' + got.reason : ''} flags=${got.flags.join(',') || '-'}`])
/** `want` and, besides, the soft flag that must be raised (a flag never rejects). */
const tf = (name, got, want, flag) => cases.push([name, got.verdict === want && got.flags.includes(flag), `${got.verdict}${got.reason ? ':' + got.reason : ''} flags=${got.flags.join(',') || '-'}`])

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
t('pulse: an older pulse overtaken on the network is stale, not a lie', checkPulse({ wave: 7, kills: 300, score: 12000 }, { wave: 6, kills: 250, score: 9000 }, s(200)), 'ok')
cases.push(['pulse: the stale one is marked so the route stores nothing', checkPulse({ wave: 7, kills: 300, score: 12000 }, { wave: 7, kills: 280, score: 11000 }, s(200)).stale === true, ''])

// ── cleared waves (since 18.09): the five honest runs the old «25 s a wave» rule refused ─────
// (production 20–28.09: wave 7 at 122 s, wave 5 at 74 s twice, wave 9 at 174 s, wave 7 at 117 s)
t('refused 7@122 s — accepted now, no flag', checkFinish({ serverDurationMs: s(122), lastPulse: { wave: 7, kills: 140, score: 9000 }, pulseCount: 6 }, { wave: 7, kills: 150, score: 9800, durationMs: s(121) }), 'ok')
t('refused 5@74 s — accepted now', checkFinish({ serverDurationMs: s(74), lastPulse: { wave: 5, kills: 70, score: 3500 }, pulseCount: 4 }, { wave: 5, kills: 76, score: 3900, durationMs: s(73) }), 'ok')
t('refused 5@74 s (the second one)', checkFinish({ serverDurationMs: s(74), lastPulse: null, pulseCount: 0 }, { wave: 5, kills: 74, score: 3600, durationMs: s(80) }), 'ok')
t('refused 9@174 s — accepted now', checkFinish({ serverDurationMs: s(174), lastPulse: { wave: 9, kills: 220, score: 16000 }, pulseCount: 8 }, { wave: 9, kills: 231, score: 17000, durationMs: s(172) }), 'ok')
t('refused 7@117 s — accepted now', checkFinish({ serverDurationMs: s(117), lastPulse: { wave: 7, kills: 130, score: 8000 }, pulseCount: 6 }, { wave: 7, kills: 135, score: 8400, durationMs: s(116) }), 'ok')
t('pulse on the fastest possible pace: wave 10 at 99 s', checkPulse({ wave: 9, kills: 200, score: 12000 }, { wave: 10, kills: 230, score: 14000 }, s(99)), 'ok')
t('pulse: wave 5 at 59 s (the model\'s floor)', checkPulse(null, { wave: 5, kills: 70, score: 3000 }, s(59)), 'ok')
t('free run: the arena ran 20 s before the ticket landed — wave 3 at 20 s of server time', checkPulse(null, { wave: 3, kills: 30, score: 900 }, s(20)), 'ok')
t('deep run on the fastest pace: wave 101 at 925 s', checkFinish({ serverDurationMs: s(925), lastPulse: { wave: 100, kills: 4300, score: 6_000_000 }, pulseCount: 99 }, { wave: 101, kills: 4350, score: 6_100_000, durationMs: s(920) }), 'ok')
t('start retried: client clock 12 s ahead of the server', checkFinish({ serverDurationMs: s(300), lastPulse: null, pulseCount: 0 }, { wave: 12, kills: 400, score: 30000, durationMs: s(312) }), 'ok')

// ── not runs ───────────────────────────────────────────────────────────────────────────────
t('misclick: 6 s, no kills → void, not cheat', checkFinish({ serverDurationMs: s(6), lastPulse: null, pulseCount: 0 }, { wave: 1, kills: 0, score: 0, durationMs: s(5) }), 'void')
t('AFK: 3 min, zero kills → void', checkFinish({ serverDurationMs: s(180), lastPulse: null, pulseCount: 0 }, { wave: 6, kills: 0, score: 0, durationMs: s(175) }), 'void')

// ── lies ───────────────────────────────────────────────────────────────────────────────────
t('score: 999999999', checkFinish({ serverDurationMs: s(200), lastPulse: null, pulseCount: 0 }, { wave: 7, kills: 500, score: 999_999_999, durationMs: s(198) }), 'cheat')
// A wave ahead of the physical pace is a FLAG for review (the pace is a balance number and drifts);
// only a wave no balance could reach is rejected.
tf('wave 30 after 90 s — flagged, not refused', checkFinish({ serverDurationMs: s(90), lastPulse: null, pulseCount: 0 }, { wave: 30, kills: 400, score: 20000, durationMs: s(88) }), 'ok', 'wave_ahead_of_clock')
t('wave 500 after 90 s — no balance gets there', checkFinish({ serverDurationMs: s(90), lastPulse: null, pulseCount: 0 }, { wave: 500, kills: 400, score: 20000, durationMs: s(88) }), 'cheat')
t('client played 20 min in 2 min of wall time', checkFinish({ serverDurationMs: s(120), lastPulse: null, pulseCount: 0 }, { wave: 4, kills: 300, score: 9000, durationMs: s(1200) }), 'cheat')
t('kills nobody spawned: 9000 by wave 3', checkFinish({ serverDurationMs: s(95), lastPulse: null, pulseCount: 0 }, { wave: 3, kills: 9000, score: 90000, durationMs: s(94) }), 'cheat')
t('finish below the last pulse', checkFinish({ serverDurationMs: s(300), lastPulse: { wave: 9, kills: 900, score: 50000 }, pulseCount: 8 }, { wave: 9, kills: 900, score: 49000, durationMs: s(298) }), 'cheat')
t('pulse: wave went backwards', checkPulse({ wave: 6, kills: 500, score: 9000 }, { wave: 5, kills: 520, score: 9500 }, s(200)), 'cheat')
tf('pulse: wave 12 after 40 s — flagged, not refused', checkPulse(null, { wave: 12, kills: 100, score: 3000 }, s(40)), 'ok', 'pulse_wave_ahead_of_clock')
t('pulse: wave 100 after 40 s', checkPulse(null, { wave: 100, kills: 100, score: 3000 }, s(40)), 'cheat')
t('pulse: back in waves, forward in score', checkPulse({ wave: 6, kills: 500, score: 9000 }, { wave: 5, kills: 520, score: 9500 }, s(200)), 'cheat')
t('pulse: negative kills', checkPulse(null, { wave: 2, kills: -3, score: 10 }, s(40)), 'cheat')
t('forged score inside the first 15 s is still cheat', checkFinish({ serverDurationMs: s(6), lastPulse: null, pulseCount: 0 }, { wave: 1, kills: 2, score: 999_999_999, durationMs: s(5) }), 'cheat')
t('finish: non-integer score', checkFinish({ serverDurationMs: s(60), lastPulse: null, pulseCount: 0 }, { wave: 2, kills: 10, score: 12.5, durationMs: s(58) }), 'cheat')

// ── the caps themselves stay above anything the game can produce ──────────────────────────
cases.push(['waveCap(0) allows wave 2 (the boundary)', waveCap(0) === 2, String(waveCap(0))])
// The model the pace is judged by stays at or under the fastest run the director allows (sim.mjs).
const SIM = { 2: 21.13, 3: 38.43, 5: 59.45, 7: 75.75, 10: 98.95, 15: 138.6, 17: 156.23, 20: 183.58, 30: 274.78, 50: 457.45, 101: 923.25, 170: 1553.45 }
for (const [w, sec] of Object.entries(SIM)) cases.push([`waveReachSeconds(${w}) ≤ the simulated fastest ${sec} s`, waveReachSeconds(Number(w)) <= sec, String(waveReachSeconds(Number(w)))])
for (const [w, sec] of Object.entries(SIM)) cases.push([`waveCap at the fastest pace for wave ${w} allows it`, waveCap(s(sec)) >= Number(w), String(waveCap(s(sec)))])
cases.push(['waveCap never decreases with time', Array.from({ length: 400 }, (_, i) => waveCap(s(i * 5))).every((v, i, a) => i === 0 || v >= a[i - 1]), ''])
cases.push(['the hard cap stays far above the flag line', Array.from({ length: 400 }, (_, i) => waveHardCap(s(i * 5)) >= 2 * waveCap(s(i * 5))).every(Boolean), ''])
cases.push(['killsCap(1) ≥ 200 + summons', killsCap(1) >= 300, String(killsCap(1))])
cases.push(['scoreCap grows with kills', scoreCap(100, 5) < scoreCap(200, 5), ''])
cases.push(['messages are the ones the player reads', MSG.cheat.includes('CHEATING DETECTED') && MSG.short.includes('TOO SHORT'), ''])

let pass = true
for (const [n, ok, info] of cases) { if (!ok) pass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}   (${info})`) }
console.log(pass ? '\n✅ ENVELOPE TEST PASS' : '\n❌ ENVELOPE TEST FAIL')
process.exit(pass ? 0 : 1)
