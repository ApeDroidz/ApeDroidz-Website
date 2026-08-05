-- ApeDroidz Honorary (ERC-1155, contract 0x427ff4...2514).
--
-- Mirrors the static metadata that lives in R2 (apedroidz_honorary/metadata/)
-- plus the two pieces of state the site owns:
--   has_gif       — whether an animated version actually exists in R2. The JSON
--                   metadata's animation_url is NOT reliable here (some tokens
--                   have a gif file but no animation_url), so the gif folder is
--                   the source of truth and gets mirrored into this column.
--   display_pref  — the holder's saved default view for the previewer.
create table if not exists honorary_droidz (
  token_id                 integer primary key,
  name                     text,
  description              text,
  external_url             text,
  traits                   jsonb default '[]'::jsonb,
  has_gif                  boolean not null default false,
  display_pref             text,
  display_pref_updated_at  timestamptz,
  last_updated             timestamptz default now(),
  constraint honorary_display_pref_valid
    check (display_pref is null or display_pref in ('pixel', 'animated'))
);

-- Owners are read from the indexer, not stored; only lookups by id happen here.
create index if not exists honorary_droidz_has_gif_idx on honorary_droidz (has_gif);
