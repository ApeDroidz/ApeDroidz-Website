-- Small editable site settings (key -> jsonb), first used by the Otherside arcade cabinet:
-- the owner swaps the cabinet's screen video from the admin panel without a deploy
-- (owner, 11.10.2026: «сделай так чтобы видос мы тоже могли менять на экране»).
-- Service role only: RLS on, no policies, anon/authenticated revoked.
create table if not exists public.site_settings (
    key        text primary key,
    value      jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    updated_by text
);
alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;

insert into public.site_settings (key, value, updated_by)
values ('otherside_arcade',
        jsonb_build_object('video_url', 'https://assets.apedroidz.com/apedroidz/droidz-survival/media/beta-announce.mp4'),
        'migration')
on conflict (key) do nothing;
