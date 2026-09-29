import { randomInt } from 'node:crypto'
import ECON from './survivalEconomy.json'

/**
 * Droidz Survival's economy, run on the server (owner, 26.09.2026: «с фронта убрать важные данные,
 * накопления, экономику — чтобы игра была защищённая и честная»).
 *
 * The game's save used to be the ledger: the browser added its own Ape Mini, unlocked its own
 * heroes and rolled its own crafts, and the profile route stored whatever it was sent. Now the
 * save's ECONOMY fields are written only here, by named actions that check a price against the
 * stored state, and by the run's own finish (runReward), which pays from the run the server has
 * already verified. The client sends only what is its business (settings, keys, which owned hero
 * it picked) — mergeClientState() is the gate.
 *
 * Every number comes from survivalEconomy.json, which the game exports from its own configs
 * (tools/export-economy.ts): one source for prices and rewards, the game shows them, this applies
 * them. Pure functions: state in, state out, no database — the routes do the reading and writing,
 * scripts/qa-survival-economy.mjs tests these.
 */

type Bag = Partial<Record<ResourceId, number>>
type ResourceId = 'scrap' | 'circuit' | 'cell' | 'core'
type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
export interface Item { uid: string; kind: string; rarity: Rarity }
type Reward =
    | { kind: 'coins'; coins: number }
    | { kind: 'resources'; bag: Bag }
    | { kind: 'item'; item: string; rarity: Rarity }
    | { kind: 'cosmetic'; id: string }
    | { kind: 'boost'; minutes: number }

/** The save as the server keeps it — the whole blob; only ECONOMY_FIELDS are ours to write. */
export type SaveState = Record<string, unknown>
export interface SeasonPart { seasonId: string; sxp: number; tier: number; claimed: number[]; claimedPass: number[]; pass: boolean }
export interface Quest { id: string; type: string; text: string; target: number; progress: number; sxp: number; bag: Bag; mode: 'sum' | 'max'; claimed: boolean }
export interface DailyPart { lastClaimDay: string; streak: number; questDay: string; quests: Quest[] }
export interface Econ { state: SaveState; season: SeasonPart; daily: DailyPart }

const RES: ResourceId[] = ECON.resources as ResourceId[]
const RARITIES = ECON.items.rarities as Rarity[]

/** The fields only the server writes. Everything else in the save is the client's (mergeClientState). */
export const ECONOMY_FIELDS = [
    'coins', 'resources', 'items', 'unlockedHeroes', 'unlockedWeapons', 'weaponTiers', 'heroTrees', 'lab',
    'boosts', 'bestiary', 'lifetime', 'appliedPurchases', 'cosmetics', 'epoch',
] as const

// ---- reading a stored save -------------------------------------------------------------------

const int = (v: unknown, max = 1e12): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const numMap = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {}
    if (v && typeof v === 'object') for (const [k, n] of Object.entries(v as Record<string, unknown>)) { const x = int(n, 1e6); if (x > 0) out[k] = x }
    return out
}
const isItem = (v: unknown): v is Item => !!v && typeof v === 'object' && typeof (v as Item).uid === 'string'
    && typeof (v as Item).kind === 'string' && (v as Item).kind in ECON.items.kinds && RARITIES.includes((v as Item).rarity)

/** The economy fields of a stored save, cleaned; defaults where missing (a new player). */
export function economyOf(state: SaveState): SaveState {
    const res = (state.resources ?? {}) as Record<string, unknown>
    const heroes = new Set(strArr(state.unlockedHeroes).filter((h) => h in ECON.heroes))
    for (const [id, h] of Object.entries(ECON.heroes)) if (h.free) heroes.add(id)
    const weapons = new Set(strArr(state.unlockedWeapons).filter((w) => w in ECON.weapons))
    for (const [id, w] of Object.entries(ECON.weapons)) if (w.free) weapons.add(id)
    const trees: Record<string, Record<string, number>> = {}
    for (const [hero, levels] of Object.entries((state.heroTrees ?? {}) as Record<string, unknown>)) if (hero in ECON.trees) trees[hero] = numMap(levels)
    const life = (state.lifetime ?? {}) as Record<string, unknown>
    return {
        coins: int(state.coins),
        resources: Object.fromEntries(RES.map((r) => [r, int(res[r], 1e7)])),
        items: (Array.isArray(state.items) ? state.items.filter(isItem) : []).slice(0, ECON.items.bagSize),
        unlockedHeroes: [...heroes],
        unlockedWeapons: [...weapons],
        weaponTiers: numMap(state.weaponTiers),
        heroTrees: trees,
        lab: numMap(state.lab),
        boosts: (Array.isArray(state.boosts) ? state.boosts : []).filter((b): b is { kind: 'coins_x2'; until: number } =>
            !!b && typeof b === 'object' && (b as { kind?: unknown }).kind === 'coins_x2' && typeof (b as { until?: unknown }).until === 'number'),
        bestiary: numMap(state.bestiary),
        lifetime: { runs: int(life.runs), bestScore: int(life.bestScore), kills: int(life.kills) },
        appliedPurchases: strArr(state.appliedPurchases).slice(-500),
        cosmetics: [...new Set(['spark_white', ...strArr(state.cosmetics)])],
        epoch: typeof state.epoch === 'string' ? state.epoch : '',
    }
}

/** A fresh economy — what a wipe (a new epoch) leaves: nothing earned, the free heroes and weapons. */
export function freshEconomy(epoch: string): SaveState {
    return { ...economyOf({}), epoch }
}

/**
 * The client's save merged over the server's: the client may set only its own business, and only to
 * things it owns — a hero it has unlocked, gear it has, a spark it won. Everything economic stays as
 * the server has it, whatever the client sent.
 */
export function mergeClientState(stored: SaveState, client: SaveState): SaveState {
    const econ = economyOf(stored)
    const out: SaveState = { ...client, ...econ }
    const heroes = econ.unlockedHeroes as string[]
    const weapons = econ.unlockedWeapons as string[]
    const items = econ.items as Item[]
    out.selectedHero = typeof client.selectedHero === 'string' && heroes.includes(client.selectedHero) ? client.selectedHero
        : (typeof stored.selectedHero === 'string' && heroes.includes(stored.selectedHero) ? stored.selectedHero : 'volt')
    out.selectedWeapon = typeof client.selectedWeapon === 'string' && weapons.includes(client.selectedWeapon) ? client.selectedWeapon
        : (typeof stored.selectedWeapon === 'string' && weapons.includes(stored.selectedWeapon) ? stored.selectedWeapon : 'sword_0')
    // Worn gear: owned items only, one of each kind, at most the rack's slots (empty slots stay '').
    const seen = new Set<string>()
    out.equipped = strArr(client.equipped).slice(0, ECON.items.equipSlots).map((uid) => {
        const it = items.find((i) => i.uid === uid)
        if (!it || seen.has(it.kind)) return ''
        seen.add(it.kind)
        return uid
    })
    out.cosmetic = typeof client.cosmetic === 'string' && (econ.cosmetics as string[]).includes(client.cosmetic) ? client.cosmetic : 'spark_white'
    // The season and the daily part live in their own row, written by us; a client copy is ignored.
    delete out.season
    delete out.daily
    return out
}

// ---- the season row --------------------------------------------------------------------------

export function seasonOf(raw: unknown, seasonId: string): SeasonPart {
    const r = (raw ?? {}) as Record<string, unknown>
    const nums = (v: unknown) => [...new Set(Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0 && n <= ECON.season.tierCount) : [])]
    const sxp = int(r.sxp)
    return { seasonId, sxp, tier: tierForSxp(sxp), claimed: nums(r.claimed), claimedPass: nums(r.claimedPass), pass: r.pass === true }
}

export function dailyOf(raw: unknown): DailyPart {
    const r = (raw ?? {}) as Record<string, unknown>
    const quests = Array.isArray(r.quests) ? (r.quests as Quest[]).filter((q) => q && typeof q.id === 'string' && typeof q.target === 'number') : []
    return {
        lastClaimDay: typeof r.lastClaimDay === 'string' ? r.lastClaimDay : '',
        streak: int(r.streak, 10_000),
        questDay: typeof r.questDay === 'string' ? r.questDay : '',
        quests,
    }
}

export function tierForSxp(sxp: number): number {
    let tier = 0, total = 0
    const costs = ECON.season.tierCosts
    while (tier < costs.length && total + costs[tier] <= sxp) { total += costs[tier]; tier += 1 }
    return tier
}

// ---- helpers ---------------------------------------------------------------------------------

export const dayKey = (now: number): string => new Date(now).toISOString().slice(0, 10)

function canAfford(e: SaveState, cost: Bag & { coins?: number }): boolean {
    if ((cost.coins ?? 0) > (e.coins as number)) return false
    const res = e.resources as Record<ResourceId, number>
    return RES.every((r) => (cost[r] ?? 0) <= res[r])
}
function spend(e: SaveState, cost: Bag & { coins?: number }): void {
    e.coins = (e.coins as number) - (cost.coins ?? 0)
    const res = e.resources as Record<ResourceId, number>
    for (const r of RES) res[r] -= cost[r] ?? 0
}
function addBag(e: SaveState, bag: Bag): void {
    const res = e.resources as Record<ResourceId, number>
    for (const r of RES) res[r] += Math.max(0, Math.floor(bag[r] ?? 0))
}
function newUid(rand: () => number): string {
    return `s${Date.now().toString(36)}${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0')}`
}
function extendBoost(e: SaveState, minutes: number, now: number): void {
    const boosts = e.boosts as Array<{ kind: 'coins_x2'; until: number }>
    const cur = boosts.find((b) => b.until > now)
    const until = (cur ? cur.until : now) + Math.max(1, Math.floor(minutes)) * 60_000
    e.boosts = [{ kind: 'coins_x2', until }]
}
function grant(e: SaveState, r: Reward, now: number, rand: () => number): void {
    switch (r.kind) {
        case 'coins': e.coins = (e.coins as number) + r.coins; break
        case 'resources': addBag(e, r.bag); break
        case 'item': {
            const items = e.items as Item[]
            if (items.length < ECON.items.bagSize) items.push({ uid: newUid(rand), kind: r.item, rarity: r.rarity })
            else addBag(e, { scrap: 6 }) // a full bag: scrapped for parts, not lost — as the game did
            break
        }
        case 'cosmetic': { const c = e.cosmetics as string[]; if (!c.includes(r.id)) c.push(r.id); break }
        case 'boost': extendBoost(e, r.minutes, now); break
    }
}
/** A die from the platform's CSPRNG — a craft's rarity is rolled here, never in the browser. */
export const serverRand = (): number => randomInt(0, 1_000_000_000) / 1_000_000_000
function rollRarity(odds: number[], rand: () => number): Rarity {
    const total = odds.reduce((a, b) => a + b, 0)
    let r = rand() * total
    for (let i = 0; i < odds.length; i++) { r -= odds[i]; if (r < 0) return RARITIES[i] }
    return 'common'
}

/** The day's three quests — the game's own generator (config/quests.ts questsForDay), same seed. */
export function questsForDay(day: string): Quest[] {
    let h = 2166136261
    for (let i = 0; i < day.length; i++) { h ^= day.charCodeAt(i); h = Math.imul(h, 16777619) }
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000 }
    const pool = [...ECON.quests] as Array<{ type: string; text: string; one?: string; targets: number[]; sxp: number[]; bag: Bag[]; mode: 'sum' | 'max' }>
    const out: Quest[] = []
    for (let step = 0; step < 3 && pool.length; step++) {
        const i = Math.floor(rnd() * pool.length)
        const [t] = pool.splice(i, 1)
        out.push({
            id: `${day}:${t.type}`, type: t.type, text: t.targets[step] === 1 && t.one ? t.one : t.text.replace('#', String(t.targets[step])),
            target: t.targets[step], progress: 0, sxp: t.sxp[step], bag: t.bag[step], mode: t.mode, claimed: false,
        })
    }
    return out
}
/** Today's quests, rolled fresh on a new day (yesterday's are gone). */
function todaysQuests(d: DailyPart, day: string): Quest[] {
    if (d.questDay !== day || d.quests.length === 0) { d.questDay = day; d.quests = questsForDay(day) }
    return d.quests
}

// ---- actions ---------------------------------------------------------------------------------

export type Action =
    | { type: 'unlock_hero'; hero: string }
    | { type: 'unlock_weapon'; weapon: string }
    | { type: 'upgrade_weapon'; weapon: string }
    | { type: 'tree_level'; hero: string; node: string }
    | { type: 'craft'; kind: string; core: boolean }
    | { type: 'dismantle'; uid: string }
    | { type: 'merge'; uid: string }
    | { type: 'claim_daily' }
    | { type: 'claim_quest'; id: string }
    | { type: 'claim_tier'; tier: number }
    | { type: 'claim_pass_tier'; tier: number }
    | { type: 'continue_mini' }

export type ActResult = { ok: true; econ: Econ; result: Record<string, unknown> } | { ok: false; error: string }

const clone = (e: Econ): Econ => JSON.parse(JSON.stringify(e)) as Econ

/**
 * One economy action against the stored state. Checks it the way the game's button did — owned,
 * affordable, open, not maxed — and returns the new state, or why not. Nothing the client sends
 * sets a number: it only names what it wants.
 */
export function act(before: Econ, a: Action, ctx: { now: number; rand?: () => number }): ActResult {
    const rand = ctx.rand ?? serverRand
    const x = clone(before)
    x.state = { ...x.state, ...economyOf(x.state) }
    const e = x.state
    const fail = (error: string): ActResult => ({ ok: false, error })
    switch (a.type) {
        case 'unlock_hero': {
            const h = (ECON.heroes as Record<string, { cost: number; free: boolean }>)[a.hero]
            if (!h) return fail('unknown_hero')
            if ((e.unlockedHeroes as string[]).includes(a.hero)) return fail('already_owned')
            if ((e.coins as number) < h.cost) return fail('not_enough_coins')
            e.coins = (e.coins as number) - h.cost;
            (e.unlockedHeroes as string[]).push(a.hero)
            return { ok: true, econ: x, result: { hero: a.hero, spent: h.cost } }
        }
        case 'unlock_weapon': {
            const w = (ECON.weapons as Record<string, { cost: number }>)[a.weapon]
            if (!w) return fail('unknown_weapon')
            if ((e.unlockedWeapons as string[]).includes(a.weapon)) return fail('already_owned')
            if ((e.coins as number) < w.cost) return fail('not_enough_coins')
            e.coins = (e.coins as number) - w.cost;
            (e.unlockedWeapons as string[]).push(a.weapon)
            return { ok: true, econ: x, result: { weapon: a.weapon, spent: w.cost } }
        }
        case 'upgrade_weapon': {
            if (!(e.unlockedWeapons as string[]).includes(a.weapon)) return fail('not_owned')
            const tiers = e.weaponTiers as Record<string, number>
            const cur = Math.max(1, tiers[a.weapon] ?? 1)
            const next = ECON.weaponTiers.find((t) => t.tier === cur + 1)
            if (!next) return fail('max_tier')
            if (!canAfford(e, next.cost as Bag)) return fail('not_enough_resources')
            spend(e, next.cost as Bag)
            tiers[a.weapon] = cur + 1
            return { ok: true, econ: x, result: { weapon: a.weapon, tier: cur + 1 } }
        }
        case 'tree_level': {
            const nodes = (ECON.trees as Record<string, Array<{ id: string; requires: string; maxLevel: number; costs: Array<Bag & { coins?: number }> }>>)[a.hero]
            const n = nodes?.find((k) => k.id === a.node)
            if (!n) return fail('unknown_node')
            if (!(e.unlockedHeroes as string[]).includes(a.hero)) return fail('hero_locked')
            const trees = e.heroTrees as Record<string, Record<string, number>>
            const levels = (trees[a.hero] ??= {})
            if (n.requires && !(levels[n.requires] > 0)) return fail('node_closed')
            const lvl = levels[n.id] ?? 0
            if (lvl >= n.maxLevel) return fail('max_level')
            const cost = n.costs[lvl]
            if (!canAfford(e, cost)) return fail('not_enough_resources')
            spend(e, cost)
            levels[n.id] = lvl + 1
            return { ok: true, econ: x, result: { node: n.id, level: lvl + 1 } }
        }
        case 'craft': {
            const kind = (ECON.items.kinds as Record<string, { cost: Bag }>)[a.kind]
            if (!kind) return fail('unknown_kind')
            const items = e.items as Item[]
            if (items.length >= ECON.items.bagSize) return fail('bag_full')
            const cost: Bag = a.core ? { ...kind.cost, core: (kind.cost.core ?? 0) + 1 } : { ...kind.cost }
            if (!canAfford(e, cost)) return fail('not_enough_resources')
            spend(e, cost)
            const item: Item = { uid: newUid(rand), kind: a.kind, rarity: rollRarity(a.core ? ECON.items.oddsCore : ECON.items.oddsPlain, rand) }
            items.push(item)
            return { ok: true, econ: x, result: { item } }
        }
        case 'dismantle': {
            const items = e.items as Item[]
            const it = items.find((i) => i.uid === a.uid)
            if (!it) return fail('not_owned')
            const refund = (ECON.items.kinds as Record<string, { refund: Record<Rarity, Bag> }>)[it.kind].refund[it.rarity]
            e.items = items.filter((i) => i.uid !== a.uid)
            addBag(e, refund)
            return { ok: true, econ: x, result: { refund } }
        }
        case 'merge': {
            const items = e.items as Item[]
            const it = items.find((i) => i.uid === a.uid)
            if (!it) return fail('not_owned')
            const up = RARITIES[RARITIES.indexOf(it.rarity) + 1]
            if (!up) return fail('max_rarity')
            const same = items.filter((i) => i.kind === it.kind && i.rarity === it.rarity)
            if (same.length < ECON.items.mergeCount) return fail('not_enough_items')
            // The picked one first, then the rest — the client decides nothing about which go.
            const gone = new Set([it, ...same.filter((i) => i.uid !== a.uid)].slice(0, ECON.items.mergeCount).map((i) => i.uid))
            const out: Item = { uid: newUid(rand), kind: it.kind, rarity: up }
            e.items = [...items.filter((i) => !gone.has(i.uid)), out]
            return { ok: true, econ: x, result: { item: out, consumed: [...gone] } }
        }
        case 'claim_daily': {
            const today = dayKey(ctx.now), yesterday = dayKey(ctx.now - 86_400_000)
            if (x.daily.lastClaimDay === today) return fail('already_claimed')
            const streak = x.daily.lastClaimDay === yesterday ? x.daily.streak + 1 : 1
            const table = ECON.daily.rewards
            const r = table[Math.min(streak, table.length) - 1]
            x.daily.lastClaimDay = today
            x.daily.streak = streak
            e.coins = (e.coins as number) + r.reward
            addBag(e, r.bag as Bag)
            return { ok: true, econ: x, result: { streak, reward: r.reward, bag: r.bag, milestone: r.milestone, day: today } }
        }
        case 'claim_quest': {
            const q = todaysQuests(x.daily, dayKey(ctx.now)).find((k) => k.id === a.id)
            if (!q) return fail('unknown_quest')
            if (q.claimed) return fail('already_claimed')
            if (q.progress < q.target) return fail('not_done')
            q.claimed = true
            addBag(e, q.bag)
            addSxp(x, q.sxp)
            return { ok: true, econ: x, result: { id: q.id, sxp: q.sxp, bag: q.bag } }
        }
        case 'claim_tier':
        case 'claim_pass_tier': {
            const pass = a.type === 'claim_pass_tier'
            const t = Math.floor(a.tier)
            if (t < 1 || t > x.season.tier) return fail('not_reached')
            if (pass && !x.season.pass) return fail('no_pass')
            const list = pass ? x.season.claimedPass : x.season.claimed
            if (list.includes(t)) return fail('already_claimed')
            const def = (ECON.season.tiers as Array<{ tier: number; free: Reward; pass: Reward }>).find((k) => k.tier === t)
            if (!def) return fail('unknown_tier')
            list.push(t)
            grant(e, pass ? def.pass : def.free, ctx.now, rand)
            return { ok: true, econ: x, result: { tier: t, reward: pass ? def.pass : def.free } }
        }
        case 'continue_mini': {
            if ((e.coins as number) < ECON.continueMini) return fail('not_enough_coins')
            e.coins = (e.coins as number) - ECON.continueMini
            return { ok: true, econ: x, result: { spent: ECON.continueMini } }
        }
    }
    return fail('unknown_action')
}

function addSxp(x: Econ, n: number): void {
    x.season.sxp += Math.max(0, Math.floor(n))
    x.season.tier = tierForSxp(x.season.sxp)
}

// ---- a run's pay -------------------------------------------------------------------------------

/**
 * What the client says happened in the run beyond what the envelope verified (score, wave, kills
 * are the run row's, already checked). Everything here is capped by those verified numbers — a
 * report can make a run pay less than it could, never more.
 */
export interface RunReport {
    hero?: string
    picked?: number                     // Ape Mini picked up in the run
    salvaged?: Bag                      // salvage carried out
    elites?: number; bosses?: number; charged?: number; breaks?: number; pickups?: number
    kinds?: Record<string, number>      // kills by enemy id (the bestiary)
}

/**
 * The run's pay, from the VERIFIED run (score, wave, kills from the run row) and the capped report.
 * Returns the new state and what was paid. Called once per run, on its finish.
 */
export function runReward(before: Econ, run: { score: number; wave: number; kills: number; durationMs: number }, rep: RunReport, ctx: { now: number }): { econ: Econ; paid: Record<string, unknown> } {
    const x = clone(before)
    x.state = { ...x.state, ...economyOf(x.state) }
    const e = x.state
    const { score, wave, kills } = run
    const mins = Math.max(0.25, run.durationMs / 60_000)
    const cap = (v: unknown, max: number): number => Math.min(Math.max(0, Math.floor(Number(v) || 0)), Math.max(0, Math.floor(max)))
    // The caps: generous for an honest run, a wall for a made-up one. A boss comes every 5th wave.
    const bosses = cap(rep.bosses, Math.floor(wave / 5) + 1)
    const elites = cap(rep.elites, kills)
    const charged = cap(rep.charged, kills + 10)
    const breaks = cap(rep.breaks, 6 + mins * 6 + wave * 2)
    const pickups = cap(rep.pickups, breaks * 4 + bosses * 25 + elites * 2 + 10)
    const picked = cap(rep.picked, kills * 2 + 50)
    const salvCap: Record<ResourceId, number> = {
        scrap: breaks * 3 + bosses * 12 + 10, circuit: breaks * 2 + bosses * 6 + 6, cell: breaks + bosses * 3 + 3, core: Math.floor(breaks * 0.2) + bosses * 2 + 1,
    }
    const bag: Bag = {}
    for (const r of RES) { const n = cap(rep.salvaged?.[r], salvCap[r]); if (n > 0) bag[r] = n }

    // Ape Mini: the game's formula, the hero's DATA SIPHON (its tree, as WE store it), a running x2.
    const hero = typeof rep.hero === 'string' && (e.unlockedHeroes as string[]).includes(rep.hero) ? rep.hero : 'volt'
    const yieldNode = ((ECON.trees as Record<string, Array<{ id: string; maxLevel: number }>>)[hero] ?? []).find((n) => n.id.endsWith(ECON.run.yieldSuffix))
    const yieldLvl = yieldNode ? Math.min(yieldNode.maxLevel, (e.heroTrees as Record<string, Record<string, number>>)[hero]?.[yieldNode.id] ?? 0) : 0
    const boost = (e.boosts as Array<{ until: number }>).some((b) => b.until > ctx.now) ? 2 : 1
    const C = ECON.run.coins
    const base = Math.floor(C.sqrtScore * Math.sqrt(Math.max(0, score)) + kills * C.kill + wave * C.wave)
    const coins = Math.floor(base * (1 + ECON.run.yieldPerLevel * yieldLvl) * boost) + picked
    const S = ECON.run.sxp
    const sxp = Math.floor(Math.sqrt(Math.max(0, score)) * S.sqrtScore + kills * S.kill + wave * S.wave)

    // The bestiary: species the server knows, no more kills than the run had; a first meeting pays.
    const best = e.bestiary as Record<string, number>
    let left = kills, discovered: string[] = []
    for (const [id, n0] of Object.entries(rep.kinds ?? {})) {
        if (!ECON.enemies.includes(id)) continue
        const n = cap(n0, left); left -= n
        if (n <= 0) continue
        if (!best[id]) discovered.push(id)
        best[id] = (best[id] ?? 0) + n
    }
    discovered = discovered.slice(0, 12)

    e.coins = (e.coins as number) + coins + discovered.length * ECON.discoveryBounty
    addBag(e, bag)
    addSxp(x, sxp)
    const life = e.lifetime as { runs: number; bestScore: number; kills: number }
    life.runs += 1; life.kills += kills; life.bestScore = Math.max(life.bestScore, score)

    // The day's quests, from the same verified-and-capped numbers.
    const qs = todaysQuests(x.daily, dayKey(ctx.now))
    const counts: Record<string, number> = { kills, wave, salvage: breaks, resources: pickups, charged, elites, boss: bosses, runs: 1 }
    for (const q of qs) {
        if (q.claimed || !(q.type in counts)) continue
        q.progress = Math.min(q.target, q.mode === 'max' ? Math.max(q.progress, counts[q.type]) : q.progress + counts[q.type])
    }
    return { econ: x, paid: { coins, sxp, bag, discovered, bounty: discovered.length * ECON.discoveryBounty, boost } }
}

// ---- purchases (lucky tickets, boxes, items, bundles, the pass) -------------------------------

/** Deterministic dice from the entitlement's server seed (mulberry32) — the game's own (Purchases.ts). */
function dice(seed: number): () => number {
    let a = (seed >>> 0) ^ 0x9e3779b9
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export interface Entitlement { id: string; kind: string; grant: Record<string, unknown>; seed: number }

/**
 * A purchase put into the economy, once — here, not in the browser (it used to be Save.applyPurchase).
 * The same contents the game would have made from the same seed: a box opens the same whoever opens
 * it. `already` when this id was applied before; `bag_full` leaves it for later (not claimed).
 */
export function applyEntitlement(before: Econ, ent: Entitlement, ctx: { now: number }): { econ: Econ; state: 'applied' | 'already' | 'bag_full'; gave: Record<string, unknown> } {
    const x = clone(before)
    x.state = { ...x.state, ...economyOf(x.state) }
    const e = x.state
    const applied = e.appliedPurchases as string[]
    if (applied.includes(ent.id)) return { econ: before, state: 'already', gave: {} }
    const g = ent.grant ?? {}
    const kinds = Object.keys(ECON.items.kinds)
    const isRarity = (r: unknown): r is Rarity => typeof r === 'string' && RARITIES.includes(r as Rarity)
    const uid = (i: number) => `p${ent.id.replace(/-/g, '').slice(0, 10)}${i}`
    let coins = 0, bag: Bag = {}, items: Item[] = [], boost = 0, pass = false
    switch (ent.kind) {
        case 'season_pass': pass = true; break
        case 'item': if (typeof g.kind === 'string' && kinds.includes(g.kind)) items = [{ uid: uid(0), kind: g.kind, rarity: isRarity(g.rarity) ? g.rarity : 'common' }]; break
        case 'box': {
            const rnd = dice(ent.seed)
            const odds = (ECON.boxOdds as Record<string, number[]>)[String(g.box)] ?? ECON.boxOdds.basic
            const rolls = Math.max(1, Math.min(10, Math.floor(Number(g.rolls ?? 3))))
            for (let i = 0; i < rolls; i++) {
                const kind = kinds[Math.floor(rnd() * kinds.length)]
                let r = rnd() * odds.reduce((a, b) => a + b, 0)
                let rarity: Rarity = 'common'
                for (let k = 0; k < odds.length; k++) { r -= odds[k]; if (r < 0) { rarity = RARITIES[k]; break } }
                items.push({ uid: uid(i), kind, rarity })
            }
            break
        }
        case 'bundle':
            if (typeof g.coins === 'number' && g.coins > 0) coins = Math.floor(g.coins)
            if (g.resources && typeof g.resources === 'object') bag = g.resources as Bag
            if (typeof g.boostMinutes === 'number' && g.boostMinutes > 0) boost = g.boostMinutes
            break
        case 'ticket': {
            const prize = (g.prize ?? {}) as { kind?: string; spec?: Record<string, unknown> }
            const spec = prize.spec ?? {}
            if (prize.kind === 'coins') coins = Math.floor(Number(spec.coins) || 0)
            else if (prize.kind === 'resources') bag = (spec.resources ?? {}) as Bag
            else if (prize.kind === 'boost') boost = Number(spec.minutes) || 0
            else if (prize.kind === 'item') items = [{ uid: uid(0), kind: kinds[Math.floor(dice(ent.seed)() * kinds.length)], rarity: isRarity(spec.rarity) ? spec.rarity : 'rare' }]
            // 'runs' were credited on the server when the ticket was paid; a droid is sent by the team.
            break
        }
    }
    if ((e.items as Item[]).length + items.length > ECON.items.bagSize) return { econ: before, state: 'bag_full', gave: {} }
    e.coins = (e.coins as number) + Math.max(0, coins)
    addBag(e, bag);
    (e.items as Item[]).push(...items)
    if (boost > 0) extendBoost(e, boost, ctx.now)
    if (pass) x.season.pass = true
    e.appliedPurchases = [...applied, ent.id].slice(-500)
    return { econ: x, state: 'applied', gave: { coins, bag, items, boost, pass } }
}
