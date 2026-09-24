-- The menu's pool panel, counted in the database (24.09.2026). The route used to pull every run of
-- the season into the function to count them — ~1 MB a call at 10k runs, from a panel every menu
-- polls. One row out instead.
create or replace function survival_pool_stats(p_season text) returns table (
    solo_ape numeric, coop_ape numeric, players bigint, games bigint, solo_games bigint, coop_games bigint
) language sql stable as $$
    select
        coalesce((select sum(amount_ape) from survival_pool_ledger where season_id = p_season and bucket in ('solo_pool','season_pool')), 0),
        coalesce((select sum(amount_ape) from survival_pool_ledger where season_id = p_season and bucket = 'coop_pool'), 0),
        (select count(distinct wallet) from survival_runs where season_id = p_season and status = 'finished'),
        (select count(*) from survival_runs where season_id = p_season and status = 'finished'),
        (select count(*) from survival_runs where season_id = p_season and status = 'finished' and mode = 'solo'),
        (select count(*) from survival_runs where season_id = p_season and status = 'finished' and mode = 'coop');
$$;
revoke all on function survival_pool_stats(text) from public, anon, authenticated;
create index if not exists survival_runs_season_status on survival_runs (season_id, status);
