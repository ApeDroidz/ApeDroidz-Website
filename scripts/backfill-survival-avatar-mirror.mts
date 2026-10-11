/**
 * One-off (10.10.2026): every NFT avatar picked before the copy-to-bucket change gets its copy in
 * `survival-avatars` (lib/survivalAvatars.ts mirrorNftImage), so the game can draw it whatever its
 * host answers about CORS. Rows that already have a copy, uploads and empty avatars are skipped.
 * A picture that cannot be fetched or is not an image keeps its original URL.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-survival-avatar-mirror.mts          # dry run
 *   npx tsx --env-file=.env.local scripts/backfill-survival-avatar-mirror.mts --apply  # writes
 */
import { supabaseAdmin } from '../src/lib/supabase'
import { mirrorNftImage } from '../src/lib/survivalAvatars'
import { uploadUrl } from '../src/lib/survivalNfts'

const apply = process.argv.includes('--apply')
const { data, error } = await supabaseAdmin!.from('survival_players').select('wallet, avatar').not('avatar', 'is', null)
if (error) throw new Error(error.message)
let copied = 0, kept = 0, skipped = 0
for (const row of data ?? []) {
    const a = row.avatar as Record<string, unknown> | null
    if (!a || a.kind === 'upload' || typeof a.path === 'string' || typeof a.image !== 'string') { skipped++; continue }
    if (!apply) { console.log('would copy', row.wallet, a.image); copied++; continue }
    const path = await mirrorNftImage(row.wallet, a.image)
    if (!path) { console.log('kept original', row.wallet, a.image); kept++; continue }
    const next = { ...a, kind: 'nft', image: uploadUrl(path), path, source: a.image }
    const { error: e } = await supabaseAdmin!.from('survival_players').update({ avatar: next }).eq('wallet', row.wallet)
    if (e) { console.log('write failed', row.wallet, e.message); kept++; continue }
    console.log('copied', row.wallet, '→', path)
    copied++
}
console.log(`${apply ? 'copied' : 'to copy'}: ${copied} · kept original: ${kept} · skipped: ${skipped}`)
