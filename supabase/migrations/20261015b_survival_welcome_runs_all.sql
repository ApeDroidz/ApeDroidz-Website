-- Three free runs for EVERY wallet, played before or not (owner, 15.10.2026: «для всех сделаем 3
-- бесплатные игры в начале, независимо играл человек или нет»). Still once per wallet.
create or replace function public.survival_grant_welcome(p_wallet text, p_n int default 3)
returns int language plpgsql security definer set search_path = public as $$
declare
    w text := lower(p_wallet);
    s text;
begin
    perform pg_advisory_xact_lock(hashtext('survival_welcome:' || w));
    if not exists (select 1 from survival_players where wallet = w) then return 0; end if;
    if exists (select 1 from survival_credits where wallet = w and source = 'welcome') then return 0; end if;
    select id into s from survival_seasons where status = 'live' limit 1;
    insert into survival_credits (wallet, season_id, source, mode)
        select w, s, 'welcome', 'solo' from generate_series(1, greatest(0, least(p_n, 10)));
    return greatest(0, least(p_n, 10));
end $$;
revoke all on function public.survival_grant_welcome(text, int) from public, anon, authenticated;
