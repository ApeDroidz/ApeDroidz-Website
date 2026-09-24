-- Droidz Survival — settling a paid order, all or nothing (24.09.2026).
--
-- The route has already found the cashier's Paid event for this player and this order on chain;
-- this function books it in ONE transaction: the order is marked paid, the payment is recorded,
-- the credits are issued, and the pool's share is appended to the ledger. There is no state in
-- which the money arrived but the credits did not, or the credits exist twice.
--
-- Returns: 'paid' (booked now, or already booked by this same tx), 'used' (the order or the tx
-- was booked by something else), 'underpaid', 'no_order'.

create or replace function survival_settle_order(
    p_order uuid, p_wallet text, p_tx text, p_paid_wei numeric, p_to_pool_wei numeric, p_block bigint, p_platform text
) returns text
language plpgsql as $$
declare
    o survival_orders%rowtype;
    pay_id uuid;
begin
    select * into o from survival_orders where id = p_order for update;
    if not found or o.wallet <> p_wallet then return 'no_order'; end if;
    if o.status = 'paid' then
        return case when o.tx_hash = p_tx then 'paid' else 'used' end;
    end if;
    if p_paid_wei < o.min_wei then return 'underpaid'; end if;
    if exists (select 1 from survival_payments where tx_hash = p_tx) then return 'used'; end if;

    update survival_orders set status = 'paid', tx_hash = p_tx, paid_wei = p_paid_wei, paid_at = now() where id = p_order;
    insert into survival_payments (tx_hash, wallet, season_id, amount_ape, block_number, confirmed_at, credits_granted, order_id, to_pool_ape, platform)
        values (p_tx, p_wallet, o.season_id, round(p_paid_wei / 1e18, 6), p_block, now(), o.credits, o.id, round(p_to_pool_wei / 1e18, 6), p_platform)
        returning id into pay_id;
    for i in 1..o.credits loop
        insert into survival_credits (wallet, season_id, payment_id, source)
            values (p_wallet, o.season_id, pay_id, case when p_platform = 'otherside' then 'arcade' else 'purchase' end);
    end loop;
    if p_to_pool_wei > 0 then
        insert into survival_pool_ledger (season_id, bucket, source, amount_ape, ref)
            values (o.season_id, 'season_pool', 'entry', round(p_to_pool_wei / 1e18, 6), p_tx);
    end if;
    return 'paid';
end $$;
revoke all on function survival_settle_order(uuid, text, text, numeric, numeric, bigint, text) from public, anon, authenticated;
