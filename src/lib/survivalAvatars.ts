import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { supabaseAdmin } from '@/lib/supabase'
import { AVATAR_BUCKET, UPLOAD_PATH_RE } from '@/lib/survivalNfts'

/**
 * The player's OWN picture as the Droidz Survival avatar (owner, 03.10.2026: «чтобы люди могли
 * загрузить свою картинку и могли её менять; сжимать в WebP; старая удаляется оттуда, где хранится»).
 *
 * Kept in Supabase Storage, bucket `survival-avatars` (public read; written only with the service
 * key — the bucket has no storage.objects policy for anon/authenticated). One file per wallet in use:
 * `avatars/<wallet>/<16 hex of the file's sha256>.webp` — the name changes with the content, so the
 * public URL can be cached for good, and every other file in the wallet's folder is removed whenever
 * the avatar changes (a new upload, an NFT picked, the avatar taken off).
 *
 * The picture is decoded here (sharp), never trusted as sent: PNG / JPEG / WebP / GIF (the first
 * frame) only, turned upright by its EXIF orientation, cropped to a centred square, 256×256, WebP
 * q80, no metadata kept (sharp drops EXIF / ICC / XMP unless asked to keep them) — ~10–30 KB.
 */

export const AVATAR_SIZE = 256
/** What the route accepts as sent (the game sends ~512 px, ~50–150 KB). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const FORMATS = new Set(['png', 'jpeg', 'webp', 'gif'])
/** A decompression-bomb guard: 40 MP is a 48 MP phone photo's worth less a margin, far over 512 px. */
const MAX_PIXELS = 40_000_000

/** The square WebP, or null when the bytes are not a picture of the allowed kinds. */
export async function toAvatarWebp(input: Buffer): Promise<Buffer | null> {
    try {
        const img = sharp(input, { limitInputPixels: MAX_PIXELS, animated: false, failOn: 'error' })
        const meta = await img.metadata()
        if (!meta.format || !FORMATS.has(meta.format) || !meta.width || !meta.height) return null
        return await img
            .rotate() // EXIF orientation applied before it is dropped
            .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
            .webp({ quality: 80, effort: 4 })
            .toBuffer()
    } catch {
        return null
    }
}

export function pathFor(wallet: string, webp: Buffer): string {
    const h = createHash('sha256').update(webp).digest('hex').slice(0, 16)
    return `avatars/${wallet}/${h}.webp`
}

let bucketChecked = false

/**
 * Creates the bucket when it is not there yet (public read, WebP only, 1 MB a file). Writes need the
 * service key: no storage.objects policy is made for anon / authenticated. The owner can create it
 * beforehand instead (supabase/migrations/20261003_survival_avatar_bucket.sql) — then this only reads.
 */
async function ensureBucket(): Promise<boolean> {
    if (bucketChecked) return true
    const { data } = await supabaseAdmin.storage.getBucket(AVATAR_BUCKET)
    if (data) { bucketChecked = true; return true }
    const { error } = await supabaseAdmin.storage.createBucket(AVATAR_BUCKET, {
        public: true, fileSizeLimit: '1MB', allowedMimeTypes: ['image/webp'],
    })
    if (error && !/already exists/i.test(error.message)) {
        console.error('[survival/avatar] bucket', error.message)
        return false
    }
    bucketChecked = true
    return true
}

/** Stores the picture; false when storage refused. Same content = same name: an upsert, no copy. */
export async function storeAvatar(path: string, webp: Buffer): Promise<boolean> {
    const put = () => supabaseAdmin.storage.from(AVATAR_BUCKET).upload(path, webp, {
        contentType: 'image/webp', cacheControl: '31536000', upsert: true,
    })
    let { error } = await put()
    if (error && /not.?found/i.test(error.message)) {
        bucketChecked = false
        if (await ensureBucket()) ({ error } = await put())
    }
    if (error) console.error('[survival/avatar] upload', error.message)
    return !error
}

/**
 * Removes every picture of this wallet but `keep` (null = all of them). Never fails the request: a
 * file left over is a few KB, the next change sweeps it.
 */
export async function pruneUploads(wallet: string, keep: string | null): Promise<void> {
    try {
        const folder = `avatars/${wallet}`
        const { data, error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).list(folder, { limit: 100 })
        if (error) { if (!/not.?found/i.test(error.message)) console.error('[survival/avatar] list', error.message); return }
        const gone = ((data ?? []) as Array<{ name: string }>)
            .map((f) => `${folder}/${f.name}`)
            .filter((p) => p !== keep && UPLOAD_PATH_RE.test(p))
        if (!gone.length) return
        const { error: rmError } = await supabaseAdmin.storage.from(AVATAR_BUCKET).remove(gone)
        if (rmError) console.error('[survival/avatar] remove', rmError.message)
    } catch (e) {
        console.error('[survival/avatar] prune', e instanceof Error ? e.message : e)
    }
}

/** Whether a stored avatar (survival_players.avatar, raw) is an uploaded picture. */
export function isUploadAvatar(v: unknown): boolean {
    return !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'upload'
}
