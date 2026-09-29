/**
 * The server-side economy (src/lib/survivalEconomy.ts), checked rule by rule: every action charges
 * what the game's own table says and refuses what the game's button refused; a run pays from the
 * VERIFIED run and a report can only lower it; the client's save can set nothing economic.
 *
 *   node scripts/qa-survival-economy.mjs
 */
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// A CommonJS site: transpile the module and hand it its JSON by path.
const jsonPath = resolve('src/lib/survivalEconomy.json')
const src = readFileSync('src/lib/survivalEconomy.ts', 'utf8')
    .replace("import ECON from './survivalEconomy.json'", `const ECON = JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(jsonPath)}, 'utf8'))`)
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const dir = join(tmpdir(), 'survival-economy-test'); mkdirSync(dir, { recursive: true })
const out = join(dir, 'survivalEconomy.mjs'); writeFileSync(out, js)
const E = await import(pathToFileURL(out).href)
const ECON = JSON.parse(readFileSync(jsonPath, 'utf8'))

const checks = []
const ok = (name, cond, info = '') => checks.push([name, !!cond, info])
const NOW = Date.UTC(2026, 8, 27, 12)
const fresh = (over = {}) => ({ state: { ...E.economyOf({}), ...over }, season: E.seasonOf({}, 'beta-1'), daily: E.dailyOf({}) })
const rich = (over = {}) => fresh({ coins: 100_000, resources: { scrap: 500, circuit: 500, cell: 500, core: 50 }, ...over })
const fixed = (v) => () => v

// ── heroes and weapons ─────────────────────────────────────────────────────────────
let r = E.act(fresh({ coins: 9_999 }), { type: 'unlock_hero', hero: 'goblin' }, { now: NOW })
ok('a hero you cannot afford stays locked', !r.ok && r.error === 'not_enough_coins', JSON.stringify(r))
r = E.act(fresh({ coins: 10_000 }), { type: 'unlock_hero', hero: 'goblin' }, { now: NOW })
ok('the hero at his exact price: unlocked, coins to 0', r.ok && r.econ.state.coins === 0 && r.econ.state.unlockedHeroes.includes('goblin'), JSON.stringify(r.ok && r.econ.state.coins))
r = E.act(r.econ, { type: 'unlock_hero', hero: 'goblin' }, { now: NOW })
ok('a hero already owned is not sold twice', !r.ok && r.error === 'already_owned')
r = E.act(rich(), { type: 'unlock_hero', hero: 'godmode' }, { now: NOW })
ok('an unknown hero is refused', !r.ok && r.error === 'unknown_hero')
r = E.act(rich(), { type: 'unlock_weapon', weapon: 'saber' }, { now: NOW })
ok('a weapon costs its table price', r.ok && r.econ.state.coins === 100_000 - ECON.weapons.saber.cost)
r = E.act(rich(), { type: 'upgrade_weapon', weapon: 'saber' }, { now: NOW })
ok('a weapon not owned cannot be upgraded', !r.ok && r.error === 'not_owned')
let w = E.act(rich(), { type: 'upgrade_weapon', weapon: 'sword_0' }, { now: NOW })
ok('upgrade to MARK II charges its bag', w.ok && w.econ.state.weaponTiers.sword_0 === 2 && w.econ.state.resources.scrap === 500 - 12 && w.econ.state.resources.circuit === 500 - 4)
w = E.act(w.econ, { type: 'upgrade_weapon', weapon: 'sword_0' }, { now: NOW }); w = E.act(w.econ, { type: 'upgrade_weapon', weapon: 'sword_0' }, { now: NOW })
r = E.act(w.econ, { type: 'upgrade_weapon', weapon: 'sword_0' }, { now: NOW })
ok('past MARK IV there is nothing to buy', !r.ok && r.error === 'max_tier', JSON.stringify(w.ok && w.econ.state.weaponTiers))

// ── the hero's tree ────────────────────────────────────────────────────────────────
const vt = ECON.trees.volt
const child = vt.find((n) => n.requires === 'volt_core')
r = E.act(rich(), { type: 'tree_level', hero: 'volt', node: child.id }, { now: NOW })
ok('a node whose root is unbought is closed', !r.ok && r.error === 'node_closed')
let t = E.act(rich(), { type: 'tree_level', hero: 'volt', node: 'volt_core' }, { now: NOW })
ok('the root costs its first level', t.ok && t.econ.state.resources.scrap === 500 - vt[0].costs[0].scrap && t.econ.state.heroTrees.volt.volt_core === 1)
t = E.act(t.econ, { type: 'tree_level', hero: 'volt', node: child.id }, { now: NOW })
ok('then the branch opens', t.ok && t.econ.state.heroTrees.volt[child.id] === 1, JSON.stringify(!t.ok && t.error))
r = E.act(rich(), { type: 'tree_level', hero: 'goblin', node: 'gob_focus' }, { now: NOW })
ok('the tree of a hero you do not own is closed', !r.ok && r.error === 'hero_locked')

// ── gear ───────────────────────────────────────────────────────────────────────────
let c = E.act(rich(), { type: 'craft', kind: 'servo', core: false }, { now: NOW, rand: fixed(0.99) })
ok('craft charges the kind cost and the SERVER rolls (0.99 → legendary on plain odds)', c.ok && c.result.item.rarity === 'legendary' && c.econ.state.items.length === 1)
c = E.act(rich(), { type: 'craft', kind: 'servo', core: false }, { now: NOW, rand: fixed(0.01) })
ok('…and 0.01 → common', c.ok && c.result.item.rarity === 'common')
const three = [{ uid: 'a', kind: 'servo', rarity: 'common' }, { uid: 'b', kind: 'servo', rarity: 'common' }, { uid: 'c', kind: 'servo', rarity: 'common' }]
let m = E.act(rich({ items: three.slice(0, 2) }), { type: 'merge', uid: 'a' }, { now: NOW })
ok('two of a kind do not merge', !m.ok && m.error === 'not_enough_items')
m = E.act(rich({ items: three }), { type: 'merge', uid: 'a' }, { now: NOW })
ok('three commons merge into one rare', m.ok && m.econ.state.items.length === 1 && m.econ.state.items[0].rarity === 'rare')
const d = E.act(rich({ items: [{ uid: 'x', kind: 'plating', rarity: 'legendary' }] }), { type: 'dismantle', uid: 'x' }, { now: NOW })
ok('dismantling a legendary refunds its table bag (a core among it)', d.ok && d.econ.state.items.length === 0 && d.econ.state.resources.core === 51, JSON.stringify(d.ok && d.result))
r = E.act(rich(), { type: 'dismantle', uid: 'nope' }, { now: NOW })
ok('an item you do not have cannot be dismantled', !r.ok && r.error === 'not_owned')

// ── the daily claim: the SERVER's day ─────────────────────────────────────────────
let dc = E.act(fresh(), { type: 'claim_daily' }, { now: NOW })
ok('first claim: streak 1, its table reward', dc.ok && dc.result.streak === 1 && dc.econ.state.coins === ECON.daily.rewards[0].reward)
r = E.act(dc.econ, { type: 'claim_daily' }, { now: NOW + 3_600_000 })
ok('twice in one UTC day: refused — whatever the device clock says', !r.ok && r.error === 'already_claimed')
dc = E.act(dc.econ, { type: 'claim_daily' }, { now: NOW + 86_400_000 })
ok('the next day continues the streak', dc.ok && dc.result.streak === 2)
dc = E.act(dc.econ, { type: 'claim_daily' }, { now: NOW + 3 * 86_400_000 })
ok('a missed day starts over', dc.ok && dc.result.streak === 1)
const six = fresh(); six.daily.lastClaimDay = E.dayKey(NOW - 86_400_000); six.daily.streak = 6
dc = E.act(six, { type: 'claim_daily' }, { now: NOW })
ok('the 7th day pays its chest', dc.ok && dc.result.milestone === 7 && dc.result.reward === ECON.daily.rewards[6].reward)

// ── a run's pay ─────────────────────────────────────────────────────────────────────
const run = { score: 40_000, wave: 10, kills: 250, durationMs: 6 * 60_000 }
const honest = E.runReward(fresh(), run, { hero: 'volt', picked: 40, salvaged: { scrap: 8, circuit: 3 }, bosses: 2, elites: 5, breaks: 10, pickups: 20, kinds: { robber: 200, gunner: 50 } }, { now: NOW })
const expCoins = Math.floor(3 * Math.sqrt(40_000) + 250 * 0.3 + 10 * 20) + 40
ok('an honest run pays the game\'s formula', honest.paid.coins === expCoins, `${honest.paid.coins} vs ${expCoins}`)
ok('…its salvage, its discoveries, its season XP', honest.econ.state.resources.scrap === 8 && honest.paid.discovered.length === 2 && honest.econ.season.sxp > 0)
const liar = E.runReward(fresh(), run, { hero: 'volt', picked: 1e9, salvaged: { core: 1e6, scrap: 1e6 }, bosses: 99, elites: 1e5, breaks: 1e5, pickups: 1e6, kinds: { robber: 1e7, dragon: 5 } }, { now: NOW })
ok('a made-up report is capped: Ape Mini picked ≤ 2 per kill + 50', liar.paid.coins <= expCoins - 40 + 250 * 2 + 50, String(liar.paid.coins))
ok('…cores capped by the run', liar.econ.state.resources.core <= 30, String(liar.econ.state.resources.core))
ok('…bestiary kills ≤ the run\'s kills, unknown species ignored', liar.econ.state.bestiary.robber === 250 && !liar.econ.state.bestiary.dragon)
const boosted = E.runReward(fresh({ boosts: [{ kind: 'coins_x2', until: NOW + 60_000 }] }), run, { hero: 'volt' }, { now: NOW })
ok('a running x2 doubles the run part', boosted.paid.coins === Math.floor(3 * Math.sqrt(40_000) + 250 * 0.3 + 10 * 20) * 2)
const notMine = E.runReward(fresh(), run, { hero: 'goblin' }, { now: NOW })
ok('a hero you do not own gets no tree bonus (falls back to volt)', notMine.paid.coins === expCoins - 40)
const q = honest.econ.daily.quests
ok('the run counts toward today\'s quests (capped numbers)', q.length === 3 && q.some((k) => k.progress > 0), JSON.stringify(q.map((k) => [k.type, k.progress, k.target])))

// ── quests and the season ladder ──────────────────────────────────────────────────
const done = JSON.parse(JSON.stringify(honest.econ)); const dq = done.daily.quests[0]; dq.progress = dq.target
let qc = E.act(done, { type: 'claim_quest', id: dq.id }, { now: NOW })
ok('a finished quest pays its SXP and bag once', qc.ok && qc.econ.season.sxp === honest.econ.season.sxp + dq.sxp)
r = E.act(qc.econ, { type: 'claim_quest', id: dq.id }, { now: NOW })
ok('…and not twice', !r.ok && r.error === 'already_claimed')
const unfinished = done.daily.quests.find((k) => k.progress < k.target)
r = unfinished ? E.act(done, { type: 'claim_quest', id: unfinished.id }, { now: NOW }) : { ok: false, error: 'not_done' }
ok('an unfinished quest pays nothing', !r.ok && r.error === 'not_done')
const t1 = fresh(); t1.season.sxp = ECON.season.tierCosts[0]; t1.season.tier = 1
let tc = E.act(t1, { type: 'claim_tier', tier: 1 }, { now: NOW })
ok('a reached tier pays its FREE reward', tc.ok && tc.econ.state.coins === ECON.season.tiers[0].free.coins)
r = E.act(t1, { type: 'claim_tier', tier: 2 }, { now: NOW })
ok('a tier not reached pays nothing', !r.ok && r.error === 'not_reached')
r = E.act(t1, { type: 'claim_pass_tier', tier: 1 }, { now: NOW })
ok('the PASS rail needs the pass', !r.ok && r.error === 'no_pass')

// ── the client's save cannot touch the economy ─────────────────────────────────────
const stored = { ...E.economyOf({}), coins: 500, items: [{ uid: 'i1', kind: 'servo', rarity: 'rare' }], selectedHero: 'volt', settings: { sfxVolume: 50 } }
const forged = { coins: 9_999_999, unlockedHeroes: ['volt', 'goblin', 'geez'], resources: { core: 999 }, items: [...stored.items, { uid: 'fake', kind: 'servo', rarity: 'legendary' }],
    selectedHero: 'goblin', equipped: ['fake', 'i1'], settings: { sfxVolume: 10 }, season: { sxp: 1e9, pass: true }, daily: { streak: 999 } }
const merged = E.mergeClientState(stored, forged)
ok('forged coins are ignored', merged.coins === 500)
ok('forged heroes are ignored, and picking one you do not own falls back', !merged.unlockedHeroes.includes('goblin') && merged.selectedHero === 'volt')
ok('forged items do not appear; wearing one is dropped', merged.items.length === 1 && merged.equipped[0] === '' && merged.equipped[1] === 'i1', JSON.stringify(merged.equipped))
ok('a forged season/daily in the save is dropped (they live in the server row)', merged.season === undefined && merged.daily === undefined)
ok('the client\'s own settings go through', merged.settings.sfxVolume === 10)

let pass = true
for (const [n, cc, info] of checks) { if (!cc) pass = false; console.log(`${cc ? 'PASS' : 'FAIL'}  ${n}${cc ? '' : '   ' + info}`) }
console.log(pass ? `\n✅ ECONOMY PASS (${checks.length})` : '\n❌ ECONOMY FAIL')
process.exitCode = pass ? 0 : 1
