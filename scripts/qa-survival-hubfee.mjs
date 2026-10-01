/**
 * A payment through the Otherside Hub is booked only for the FULL price: the cashier's amount plus
 * the fee the Hub's own FeeCollected says it took (src/lib/survivalShop.ts hubFeeFor, used by
 * lib/survivalSettle.ts book()). The Hub's FeeSplitter takes calls from anyone with any fee, so a
 * payment of 90% of the price «through the Hub» with fee 0 must come out underpaid.
 *
 *   node scripts/qa-survival-hubfee.mjs
 */
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CASHIER = '0x' + 'c'.repeat(40)
process.env.SURVIVAL_CASHIER = CASHIER
// survivalShop.ts reads the catalog through supabase; the functions tested here do not.
const src = readFileSync('src/lib/survivalShop.ts', 'utf8').replace(/^import .*supabase'.*$/m, 'const supabaseAdmin = null as any')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const dir = join(tmpdir(), 'survival-hubfee-test'); mkdirSync(dir, { recursive: true })
const out = join(dir, 'survivalShop.mjs'); writeFileSync(out, js)
const { hubFeeFor, paidEvents, PAID_TOPIC, FEE_COLLECTED_TOPIC, HUB_FEE_SPLITTER, apeToWei } = await import(pathToFileURL(out).href)

const w = (n) => BigInt(n).toString(16).padStart(64, '0')
const addr = (a) => '0x' + a.slice(2).padStart(64, '0')
const player = '0x' + 'a'.repeat(40)
const order = '0x' + '1'.repeat(32) + '0'.repeat(32)
const paid = (amount, logIndex) => ({ address: CASHIER, topics: [PAID_TOPIC, addr(player), order, addr(HUB_FEE_SPLITTER)], data: '0x' + w(0) + w(amount) + w(amount / 2n), logIndex, blockNumber: 1n })
const fee = (f, logIndex, target = CASHIER) => ({ address: HUB_FEE_SPLITTER, topics: [FEE_COLLECTED_TOPIC, addr(player), addr(target)], data: '0x' + w(f) + w(150), logIndex })

const price = apeToWei(13.5)
const book = (logs) => {
    const ev = paidEvents(logs)[0]
    const f = hubFeeFor(logs, ev)
    return f === null || ev.amount + f < price ? 'underpaid' : 'paid'
}
const cases = [
    ['fee 0, 90% of the price → underpaid', book([paid(price * 9n / 10n, 0), fee(0n, 1)]), 'underpaid'],
    ['150 bps on the full price → paid', book([paid(price - price * 150n / 10000n, 0), fee(price * 150n / 10000n, 1)]), 'paid'],
    ['1000 bps on the full price → paid', book([paid(price - price / 10n, 0), fee(price / 10n, 1)]), 'paid'],
    ['no FeeCollected at all → underpaid', book([paid(price * 9n / 10n, 0)]), 'underpaid'],
    ['a FeeCollected for another target is not ours → underpaid', book([paid(price * 9n / 10n, 0), fee(price, 1, '0x' + 'd'.repeat(40))]), 'underpaid'],
    ['a FeeCollected BEFORE the Paid (another call) is not ours → underpaid', book([fee(price, 0), paid(price * 9n / 10n, 1)]), 'underpaid'],
    ['the nearest one after the Paid is taken', book([paid(price * 9n / 10n, 0), fee(0n, 1), fee(price, 2)]), 'underpaid'],
]
let bad = 0
for (const [name, got, want] of cases) { const ok = got === want; if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}   (${got})`) }
console.log(bad ? `\n❌ ${bad} FAILED` : '\n✅ HUB FEE TEST PASS')
process.exit(bad ? 1 : 0)
