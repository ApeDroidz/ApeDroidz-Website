-- Droidz Survival — solo and co-op pools (24.09.2026, owner: «чтобы для каждого режима
-- формировался свой пул»).
--
-- The cashier (v2) pays the pool share of every purchase into the vault of the purchase's mode:
-- solo 0x84B7…, co-op 0xA7E5…; the rest to the team wallet 0xE794…. Here the books follow:
-- orders, credits, runs and payments carry the mode; a credit bought for solo is spent on a solo
-- run only; the pool ledger gets one bucket per mode. Additive apart from replacing the two
-- functions from 20260924_survival_orders / _settle with mode-aware versions.

alter table survival_orders   add column if not exists mode  text not null default 'solo';
alter table survival_credits  add column if not exists mode  text not null default 'solo';
alter table survival_runs     add column if not exists mode  text not null default 'solo';
alter table survival_payments add column if not exists mode  text;
alter table survival_payments add column if not exists payer text;

do $$ begin
    alter table survival_orders  add constraint survival_orders_mode_check  check (mode in ('solo','coop'));
    alter table survival_credits add constraint survival_credits_mode_check check (mode in ('solo','coop'));
    alter table survival_runs    add constraint survival_runs_mode_check    check (mode in ('solo','coop'));
exception when duplicate_object then null; end $$;

-- One bucket per mode (the old two stay valid for anything already written).
alter table survival_pool_ledger drop constraint if exists survival_pool_ledger_bucket_check;
alter table survival_pool_ledger add constraint survival_pool_ledger_bucket_check
    check (bucket in ('season_pool','mega_pool','solo_pool','coop_pool'));

drop function if exists survival_consume_credit(text, uuid);
create or replace function survival_consume_credit(p_wallet text, p_run uuid, p_mode text) returns uuid
language sql as $$
    update survival_credits set consumed_by_run = p_run
    where id = (
        select id from survival_credits
        where wallet = p_wallet and mode = p_mode and consumed_by_run is null
        order by created_at
        limit 1
        for update skip locked
    )
    returning id;
$$;
revoke all on function survival_consume_credit(text, uuid, text) from public, anon, authenticated;

-- Booking a paid order. New against _settle: the event's mode must be the order's mode, and the
-- price floor depends on the route the money took — through the Otherside Hub's FeeSplitter
-- (p_via_hub) the Hub has already taken its fee (default 1.5%, at most 10% by its contract), so
-- 90% of the price is accepted; paid directly, the full price is required.
drop function if exists survival_settle_order(uuid, text, text, numeric, numeric, bigint, text);
create or replace function survival_settle_order(
    p_order uuid, p_wallet text, p_tx text, p_paid_wei numeric, p_to_pool_wei numeric, p_block bigint,
    p_platform text, p_mode text, p_payer text, p_via_hub boolean
) returns text
language plpgsql as $$
declare
    o survival_orders%rowtype;
    pay_id uuid;
    floor_wei numeric;
begin
    select * into o from survival_orders where id = p_order for update;
    if not found or o.wallet <> p_wallet then return 'no_order'; end if;
    if o.status = 'paid' then
        return case when o.tx_hash = p_tx then 'paid' else 'used' end;
    end if;
    if o.mode <> p_mode then return 'wrong_mode'; end if;
    floor_wei := case when p_via_hub then trunc(o.min_wei * 9000 / 10000) else o.min_wei end;
    if p_paid_wei < floor_wei then return 'underpaid'; end if;
    if exists (select 1 from survival_payments where tx_hash = p_tx) then return 'used'; end if;

    update survival_orders set status = 'paid', tx_hash = p_tx, paid_wei = p_paid_wei, paid_at = now() where id = p_order;
    insert into survival_payments (tx_hash, wallet, season_id, amount_ape, block_number, confirmed_at, credits_granted,
                                   order_id, to_pool_ape, platform, mode, payer)
        values (p_tx, p_wallet, o.season_id, round(p_paid_wei / 1e18, 6), p_block, now(), o.credits,
                o.id, round(p_to_pool_wei / 1e18, 6), p_platform, o.mode, p_payer)
        returning id into pay_id;
    for i in 1..o.credits loop
        insert into survival_credits (wallet, season_id, payment_id, source, mode)
            values (p_wallet, o.season_id, pay_id, case when p_platform = 'otherside' then 'arcade' else 'purchase' end, o.mode);
    end loop;
    if p_to_pool_wei > 0 then
        insert into survival_pool_ledger (season_id, bucket, source, amount_ape, ref)
            values (o.season_id, o.mode || '_pool', 'entry', round(p_to_pool_wei / 1e18, 6), p_tx);
    end if;
    return 'paid';
end $$;
revoke all on function survival_settle_order(uuid, text, text, numeric, numeric, bigint, text, text, text, boolean) from public, anon, authenticated;
