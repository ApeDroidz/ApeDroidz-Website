-- Droidz Survival, 03.10.2026 — the player's OWN picture as the avatar (owner: «чтобы люди могли
-- загрузить свою картинку и могли её менять; сжимать в WebP; старая удаляется»).
--
-- Storage bucket `survival-avatars`:
--   * public = true      — anyone reads a picture by its URL (the game, the leaderboard, the board API);
--   * WebP only, ≤ 1 MB  — the site re-encodes every upload to 256×256 WebP q80 (~10–30 KB);
--   * NO storage.objects policy is created for it: anon / authenticated cannot list, write or delete
--     there; only the service role (the site's api/survival/me/avatar/upload) writes and removes.
--
-- Optional: the route also creates the bucket with these same settings on its first upload when it
-- is missing (lib/survivalAvatars.ts ensureBucket). Running this first just makes it explicit.
--
-- Safe to re-run. NOT APPLIED — the owner applies it himself.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('survival-avatars', 'survival-avatars', true, 1048576, array['image/webp'])
on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

-- Check (read-only): no policy on storage.objects may let anon / authenticated write into this
-- bucket. A policy without a bucket_id condition applies to EVERY bucket — look for one:
--   select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage';
