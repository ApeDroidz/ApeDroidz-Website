/**
 * Beta gate test for /droidz_survival.
 *
 * Asserts that the game build is actually unreachable without a valid play cookie — including
 * the .png and .json assets, which the site's main middleware matcher deliberately waves past
 * and which therefore need their own matcher entry. A gate that stops index.html but serves
 * every sprite is not a gate.
 */
const BASE = process.env.BASE ?? 'http://localhost:3737'
const SECRET = process.env.WALLET_SESSION_SECRET
if (!SECRET) throw new Error('WALLET_SESSION_SECRET missing')

const b64url = (bytes) => Buffer.from(bytes).toString('base64url')

async function hmac(payload) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))))
}

async function mint(claims) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)))
  return `${payload}.${await hmac(payload)}`
}

const WALLET = '0x' + '1'.repeat(40)
const hour = 60 * 60 * 1000

const good   = await mint({ w: WALLET, exp: Date.now() + hour })
const stale  = await mint({ w: WALLET, exp: Date.now() - hour })
const forged = (await mint({ w: WALLET, exp: Date.now() + hour })).split('.')[0] + '.' + b64url(new Uint8Array(32))

async function hit(path, cookie) {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: cookie ? { cookie: `survival_play=${cookie}` } : {},
  })
  return { status: res.status, location: res.headers.get('location') }
}

// Wait for the dev server to compile.
for (let i = 0; i < 90; i++) {
  try { const r = await fetch(BASE + '/droidz_survival', { redirect: 'manual' }); if (r.status < 500) break } catch {}
  await new Promise((r) => setTimeout(r, 1000))
}

// The media lives on R2 now (docs: game/docs/DEPLOY.md); what the site still serves under the
// gate is the page and the content-hashed JS bundle — so the bundle is the asset to check.
import { readdirSync } from 'node:fs'
const bundle = readdirSync('public/droidz_survival/play/assets').find((f) => f.endsWith('.js'))
const asset = `/droidz_survival/play/assets/${bundle}`
const atlas = '/droidz_survival/play/index.html'

const cases = [
  ['landing page is public',            await hit('/droidz_survival'),           (r) => r.status === 200],
  ['index.html blocked with no cookie', await hit(atlas),                        (r) => r.status === 307 || r.status === 308],
  ['index.html blocked when expired',   await hit(atlas, stale),                 (r) => r.status === 307 || r.status === 308],
  ['index.html blocked when forged',    await hit(atlas, forged),                (r) => r.status === 307 || r.status === 308],
  ['index.html served with a good one', await hit(atlas, good),                  (r) => r.status === 200],
  ['the JS bundle is blocked too',       await hit(asset),                        (r) => r.status === 307 || r.status === 308],
  ['and served with a good cookie',     await hit(asset, good),                  (r) => r.status === 200],
]

let pass = true
for (const [name, res, ok] of cases) {
  const good = ok(res)
  pass &&= good
  console.log(`${good ? 'PASS' : 'FAIL'}  ${name}  → ${res.status}${res.location ? ' → ' + res.location : ''}`)
}
console.log(pass ? '\n✅ GATE TEST PASS' : '\n❌ GATE TEST FAIL')
process.exit(pass ? 0 : 1)
