import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer } from '@/lib/survivalRuns'
import { ensurePlayer, NO_STORE, playerRow } from '@/lib/survivalMe'
import { uploadUrl, type UploadAvatar } from '@/lib/survivalNfts'
import { MAX_UPLOAD_BYTES, pathFor, pruneUploads, storeAvatar, toAvatarWebp, UPLOAD_TYPES } from '@/lib/survivalAvatars'

/**
 * POST /api/survival/me/avatar/upload — the player's own picture as the avatar (owner, 03.10.2026).
 *
 *   body: the image itself, raw, Content-Type image/png | image/jpeg | image/webp | image/gif, ≤ 5 MB
 *         (the game shrinks it to ~512 px first). Raw and not multipart on purpose: an image/* body is
 *         not a CORS «simple» request, so another site cannot send one without a preflight — the
 *         middleware lets exactly this path through its JSON-only rule for it (middleware.ts).
 *
 *   → { ok: true, avatar: { kind: 'upload', image, path } }
 *   → 400 { error: 'invalid' }   — not one of the four types / empty body
 *   → 400 { error: 'too_big' }   — over 5 MB
 *   → 400 { error: 'bad_image' } — does not decode as a picture of that kind
 *   → 401 { ok: false, state }   — no signed session / no play access (authCaller)
 *   → 503 { ok: false, state: 'no_server' } — storage or the database did not answer
 *
 * The picture is decoded and re-encoded here (lib/survivalAvatars.ts): a centred square, 256×256,
 * WebP q80, no metadata. Stored at avatars/<wallet>/<content hash>.webp in the public bucket
 * `survival-avatars`; every other file of the wallet is removed once the row points at the new one.
 * Rate: 6 uploads in 10 minutes per IP (middleware LIMITS).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const bad = (error: 'invalid' | 'too_big' | 'bad_image') => NextResponse.json({ error }, { status: 400, headers: NO_STORE })

/** The body, up to `cap` bytes; 'too_big' as soon as it is over. */
async function readCapped(req: NextRequest, cap: number): Promise<Buffer | 'too_big' | null> {
    if (!req.body) return null
    const reader = req.body.getReader()
    const parts: Uint8Array[] = []
    let total = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > cap) { try { await reader.cancel() } catch { /* gone */ } return 'too_big' }
        parts.push(value)
    }
    return total ? Buffer.concat(parts) : null
}

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const wallet = caller.wallet

    const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!UPLOAD_TYPES.has(type)) return bad('invalid')
    const declared = Number(req.headers.get('content-length') ?? '0')
    if (declared > MAX_UPLOAD_BYTES) return bad('too_big')
    let body: Buffer | 'too_big' | null
    try { body = await readCapped(req, MAX_UPLOAD_BYTES) } catch { return bad('invalid') }
    if (body === 'too_big') return bad('too_big')
    if (!body) return bad('invalid')

    const webp = await toAvatarWebp(body)
    if (!webp) return bad('bad_image')
    const path = pathFor(wallet, webp)

    if (!(await ensurePlayer(wallet))) return noServer('me.avatar_upload', 'player row')
    if (!(await storeAvatar(path, webp))) return noServer('me.avatar_upload', 'storage')

    const avatar: UploadAvatar = { kind: 'upload', image: uploadUrl(path), path }
    const { error } = await supabaseAdmin.from('survival_players')
        .update({ avatar }).eq('wallet', wallet)
    if (error) {
        // The row still points at the old picture (or an NFT): the new file is not kept — unless it is
        // the very one the row already has (the same picture sent again).
        const now = await playerRow(wallet)
        const cur = now.row?.avatar as { kind?: unknown; path?: unknown } | null | undefined
        await pruneUploads(wallet, cur?.kind === 'upload' && typeof cur.path === 'string' ? cur.path : null)
        return noServer('me.avatar_upload', error.message)
    }
    // The previous picture (and any left over from a race) goes; the new one stays.
    await pruneUploads(wallet, path)
    return NextResponse.json({ ok: true, avatar }, { headers: NO_STORE })
}
