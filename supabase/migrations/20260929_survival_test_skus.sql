-- Droidz Survival, 29.09.2026 — TEST ITEMS: the owner checks a real payment on prod for pennies,
-- without feeding the prize pool (owner: «проверить настоящую оплату на проде очень дёшево, не
-- пополняя призовой пул»).
--
-- A catalog row whose sku starts with test_ stands in for the real item after the prefix
-- (test_ticket → ticket, test_run → run, test_season_pass → season_pass) at 0.01 APE — for the
-- wallets in SURVIVAL_TEST_WALLETS only (lib/survivalShop.ts catalogFor / resolveItem): nobody else
-- sees or can order them. The chain still takes a real payment through the cashier (0.01 APE, the
-- contract refuses 0), so the whole path is the real one: order → wallet → Paid event → booking.
--
-- What the database keeps apart (independent of the settle version, v6 or v7):
--   1. the pool ledger: no 'entry' row for a test order — the pool the game shows, the forecast and
--      the payout never see it (the cashier still sends 0.005 APE to the pool vault on chain; the
--      vault then holds a bit MORE than the ledger, which the alerts accept);
--   2. the ticket vault: a test ticket never takes a droid NFT — a drawn NFT becomes the usual
--      fallback (200 Ape Mini) and the token stays 'available' for players;
--   3. the pool field: a test pass gives the pass rewards in the game (to test them) but does NOT
--      make the wallet one of the pass holders who share the pool (survival_season_standings).
--
-- The rows go in INACTIVE, so this is safe to apply before or after the code: the code running
-- on prod today lists every active row to every player. Once the code with catalogFor is deployed,
-- switch them on (spltpnl → Catalog, or the UPDATE at the bottom). Off again the same way.
--
-- NOT APPLIED. Apply only with the owner's word.

begin;

-- 1. The test rows. Their own sale and holder discount are 0: the price is exactly 0.01 APE.
insert into survival_catalog (sku, kind, title, description, price_ape, credits, mode, grant_spec, active, sort,
                              holder_discount_pct, sale_pct, sale_until, updated_by) values
    ('test_ticket',      'ticket',      'TEST Lucky ticket', 'Test purchase (SURVIVAL_TEST_WALLETS only). Not counted in the prize pool.', 0.01, 0, 'solo', '{"count":1}', false, 905, 0, 0, null, 'test items 29.09'),
    ('test_run',         'runs',        'TEST 1 run',        'Test purchase (SURVIVAL_TEST_WALLETS only). Not counted in the prize pool.', 0.01, 1, 'solo', '{}',          false, 910, 0, 0, null, 'test items 29.09'),
    ('test_season_pass', 'season_pass', 'TEST Season pass',  'Test purchase (SURVIVAL_TEST_WALLETS only). Not in the pool field.',          0.01, 0, 'solo', '{}',          false, 930, 0, 0, null, 'test items 29.09')
on conflict (sku) do update set
    kind = excluded.kind, title = excluded.title, description = excluded.description, price_ape = excluded.price_ape,
    credits = excluded.credits, mode = excluded.mode, grant_spec = excluded.grant_spec,
    holder_discount_pct = 0, sale_pct = 0, sale_until = null, updated_at = now(), updated_by = excluded.updated_by;

-- 2. No pool ledger row for a test order. survival_settle_order marks the order paid (paid_at =
--    now(), the transaction's own clock) and then appends the pool share with ref = the tx hash;
--    the order being booked in THIS transaction is the one with that hash and paid_at = now(), so a
--    real order sharing the hash (an ERC-4337 bundle, settle v7) is never mistaken for it.
create or replace function public.survival_pool_ledger_skip_test() returns trigger
language plpgsql as $$
begin
    if new.source = 'entry' and exists (
        select 1 from survival_orders o
        where o.tx_hash = new.ref and o.status = 'paid' and o.paid_at = now() and o.sku like 'test\_%'
    ) then
        return null;
    end if;
    return new;
end $$;
drop trigger if exists survival_pool_ledger_skip_test on survival_pool_ledger;
create trigger survival_pool_ledger_skip_test before insert on survival_pool_ledger
    for each row execute function public.survival_pool_ledger_skip_test();

-- 3a. A test ticket's prize is never a droid NFT: the entitlement gets the usual fallback instead.
create or replace function public.survival_entitlement_test_no_nft() returns trigger
language plpgsql as $$
begin
    if new.sku like 'test\_%' and new.kind = 'ticket' and new.grant_spec->'prize'->>'kind' = 'nft' then
        new.grant_spec := jsonb_set(new.grant_spec, '{prize}',
            '{"id":"fallback","label":"200 Ape Mini","kind":"coins","spec":{"coins":200}}'::jsonb);
    end if;
    return new;
end $$;
drop trigger if exists survival_entitlement_test_no_nft on survival_entitlements;
create trigger survival_entitlement_test_no_nft before insert on survival_entitlements
    for each row execute function public.survival_entitlement_test_no_nft();

-- 3b. …and the token the draw picked stays in the vault (the reservation is skipped).
create or replace function public.survival_ticket_nft_not_for_test() returns trigger
language plpgsql as $$
begin
    if new.status = 'reserved' and old.status = 'available' and new.entitlement_id is not null
       and exists (select 1 from survival_entitlements e where e.id = new.entitlement_id and e.sku like 'test\_%') then
        return null;
    end if;
    return new;
end $$;
drop trigger if exists survival_ticket_nft_not_for_test on survival_ticket_nfts;
create trigger survival_ticket_nft_not_for_test before update on survival_ticket_nfts
    for each row execute function public.survival_ticket_nft_not_for_test();

-- 4. The pool field: a test pass is not a pass (as 20260925_survival_packs_pass_forecast, plus the sku).
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
        select distinct e.wallet from survival_entitlements e
        where e.season_id = p_season and e.kind = 'season_pass' and e.sku not like 'test\_%'
    )
    select b.wallet, b.best, exists (select 1 from pass p where p.wallet = b.wallet)
    from best b
    union all
    -- a pass holder without a run yet still counts toward «how many share the pool»
    select p.wallet, 0::bigint, true from pass p where not exists (select 1 from best b where b.wallet = p.wallet);
$function$;

commit;

-- AFTER the code is deployed (and SURVIVAL_TEST_WALLETS is set on Vercel), switch the test rows on:
--   update survival_catalog set active = true,  updated_at = now(), updated_by = 'owner: test on'  where sku like 'test\_%';
-- and off when done:
--   update survival_catalog set active = false, updated_at = now(), updated_by = 'owner: test off' where sku like 'test\_%';
