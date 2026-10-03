-- Droidz Survival, 03.10.2026 — the player's PROFILE and the landing FUNNEL (owner's decisions of
-- 03.10: a nickname set once, an X handle, any NFT of the wallet as the avatar; a simple funnel
-- landing → PLAY → wallet → signature → first run → first purchase in spltpnl).
--
-- 1. survival_players gets three columns:
--      nickname         — 3–16 of [A-Za-z0-9_], set ONCE by the player (api/survival/me/profile),
--                         unique without regard to case (the index below: «Bob» blocks «bob»).
--                         No word filter — the owner's call («разбираемся по факту»).
--      nickname_set_at  — when it was set.
--      avatar           — {contract, tokenId, name, image}: an NFT on ApeChain the wallet owned when
--                         it was picked (the route checks ownership via Insight / ownerOf). Cosmetic,
--                         like droid_token_id: nothing that ranks or pays may read it.
--    survival_players keeps its RLS with no policy and no anon/authenticated grants
--    (20260912_survival_prize_pool.sql): only the service role reads or writes these columns, as
--    every other column of the table. New columns inherit the table's grants, so nothing to add.
--
-- 2. Funnel dedup on survival_events: one line per (anonymous visitor, step) and per (wallet, step)
--    for the two server-side steps. The route also checks before inserting; the unique indexes are
--    what makes it exact across instances and races (a duplicate insert fails with 23505 and is
--    ignored by the code). Partial: no other journal line is touched.
--
-- Safe to re-run (if not exists everywhere). NOT APPLIED — the owner applies it himself.

begin;

alter table survival_players add column if not exists nickname        text;
alter table survival_players add column if not exists nickname_set_at timestamptz;
alter table survival_players add column if not exists avatar          jsonb;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'survival_players_nickname_format') then
        alter table survival_players add constraint survival_players_nickname_format
            check (nickname is null or nickname ~ '^[A-Za-z0-9_]{3,16}$');
    end if;
    if not exists (select 1 from pg_constraint where conname = 'survival_players_avatar_object') then
        alter table survival_players add constraint survival_players_avatar_object
            check (avatar is null or jsonb_typeof(avatar) = 'object');
    end if;
end $$;

create unique index if not exists survival_players_nickname_lower
    on survival_players (lower(nickname)) where nickname is not null;

-- Belt and braces, as in 20260912: the table stays the service role's alone.
revoke insert, update, delete, select on survival_players from anon, authenticated;

-- Funnel: landing_view / play_click / wallet_connected / signed_in are keyed by the visitor's
-- anonymous id (data->>'anon'); first_run / first_purchase by the wallet (written by the server).
create unique index if not exists survival_events_funnel_anon
    on survival_events (kind, (data->>'anon'))
    where kind in ('funnel.landing_view', 'funnel.play_click', 'funnel.wallet_connected', 'funnel.signed_in');
create unique index if not exists survival_events_funnel_wallet
    on survival_events (kind, wallet)
    where kind in ('funnel.first_run', 'funnel.first_purchase');

commit;
