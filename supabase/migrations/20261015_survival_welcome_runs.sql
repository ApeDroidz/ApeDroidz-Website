-- Three free full runs for a new player (owner, 15.10.2026: «новым юзерам давать 3 бесплатные
-- полные игры, а потом уже платно»). Granted as ordinary run credits with their own source, so the
-- game plays them like paid runs (full run, board, season) and the money trail stays clean: a
-- welcome run pays nothing into the pool.
--   · "new" = a wallet with no run on the server yet (the free trial never reaches the server);
--   · once per wallet, ever: the advisory lock makes two parallel reads grant one batch.
alter table public.survival_credits drop constraint if exists survival_credits_source_check;
alter table public.survival_credits add constraint survival_credits_source_check
    check (source = any (array['purchase', 'arcade', 'grant', 'free_daily', 'welcome']));

create or replace function public.survival_grant_welcome(p_wallet text, p_n int default 3)
returns int language plpgsql security definer set search_path = public as $$
declare
    w text := lower(p_wallet);
    s text;
begin
    perform pg_advisory_xact_lock(hashtext('survival_welcome:' || w));
    if not exists (select 1 from survival_players where wallet = w) then return 0; end if;
    if exists (select 1 from survival_credits where wallet = w and source = 'welcome') then return 0; end if;
    if exists (select 1 from survival_runs where wallet = w) then return 0; end if;
    select id into s from survival_seasons where status = 'live' limit 1;
    insert into survival_credits (wallet, season_id, source, mode)
        select w, s, 'welcome', 'solo' from generate_series(1, greatest(0, least(p_n, 10)));
    return greatest(0, least(p_n, 10));
end $$;
revoke all on function public.survival_grant_welcome(text, int) from public, anon, authenticated;
