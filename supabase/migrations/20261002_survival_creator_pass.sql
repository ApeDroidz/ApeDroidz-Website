-- Droidz Survival, 02.10.2026 — CREATOR MODE: the owner opens the season pass and the ladder for free
-- to look at them before Season 1, while every player still sees them sealed (owner: «бесплатно
-- открыть и посмотреть сезонный пропуск и лестницу сезона, а для остальных всё закрыто»).
--
-- The code (api/survival/creator-pass) grants the creator a TEST pass: an entitlement with sku
-- 'test_creator_pass' and grant_spec {"source":"creator"}, made from a closed 'paid' order with no
-- payment. Being test_*, it is kept out of the pool by what 20260929_survival_test_skus already put in
-- survival_season_standings (`sku not like 'test\_%'`) — the board and the admin views filter the same
-- sku in code.
--
-- So this file is a SAFETY NET, not a requirement: it re-states survival_season_standings with the
-- test_* filter AND an explicit `source = 'creator'` filter, so the creator's pass is out of the pool
-- field even if 20260929_survival_test_skus has not been applied. Re-applying it is harmless; with
-- 20260929 applied it changes nothing that exists today (no entitlement has source 'creator' yet).
--
-- NOT APPLIED. Apply only with the owner's word.

begin;

create or replace function public.survival_season_standings(p_season text)
 returns table(wallet text, best bigint, has_pass boolean)
 language sql
 stable
as $function$
    with best as (
        -- the same numbers the season board shows (survival_season_best), banned wallets out
        select b.wallet, b.score::bigint as best
        from survival_season_best b
        where b.season_id = p_season and coalesce(b.score, 0) > 0
          and not exists (select 1 from survival_players p where p.wallet = b.wallet and p.banned)
    ), pass as (
        -- a test pass (test_* sku: the 0.01 APE test pass, the creator's free pass) is not a pass here
        select distinct e.wallet from survival_entitlements e
        where e.season_id = p_season and e.kind = 'season_pass' and e.sku not like 'test\_%'
          and coalesce(e.grant_spec->>'source', '') <> 'creator'
    )
    select b.wallet, b.best, exists (select 1 from pass p where p.wallet = b.wallet)
    from best b
    union all
    -- a pass holder without a run yet still counts toward «how many share the pool»
    select p.wallet, 0::bigint, true from pass p where not exists (select 1 from best b where b.wallet = p.wallet);
$function$;

commit;

-- Check after applying (expects 0 rows: no creator/test pass among the pool's pass holders):
--   select s.* from survival_seasons z, survival_season_standings(z.id) s
--   join survival_entitlements e on e.wallet = s.wallet and e.kind = 'season_pass' and e.sku like 'test\_%'
--   where z.status = 'live' and s.has_pass
--     and not exists (select 1 from survival_entitlements r where r.wallet = s.wallet and r.kind = 'season_pass' and r.sku not like 'test\_%');
