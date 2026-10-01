-- Droidz Survival, 29.09.2026 — settlement v7: two payments in ONE transaction.
--
-- In the Otherside cabinet a payment can come from an ERC-4337 account (DroidzCashier.sol header),
-- and a bundler may put several players' UserOperations into one handleOps transaction: one hash,
-- several Paid events. Uniqueness was on the hash alone (survival_payments.tx_hash,
-- survival_orders.tx_hash, and «exists a payment with this hash → used»), so the first order in
-- such a transaction was booked and every other one answered 'used' forever — money taken, nothing
-- given, no path in the panel either (it hits the same check).
--
-- Now a payment is unique per ORDER and per EVENT (hash + log index). Rows from before keep
-- log_index null (-1 in the index), which is what they were: one event per hash.
--
-- The site calls v7 with p_log_index and falls back to v6's signature while this is not applied
-- (lib/survivalSettle.ts settleRpc), so this can go in at any time. APPLY ONLY WITH THE OWNER'S WORD.

alter table survival_payments drop constraint if exists survival_payments_tx_hash_key;
alter table survival_orders   drop constraint if exists survival_orders_tx_hash_key;
create index if not exists survival_payments_tx on survival_payments (tx_hash);
create index if not exists survival_orders_tx   on survival_orders (tx_hash) where tx_hash is not null;

alter table survival_payments add column if not exists log_index int;
create unique index if not exists survival_payments_order_once on survival_payments (order_id) where order_id is not null;
create unique index if not exists survival_payments_event_once on survival_payments (tx_hash, (coalesce(log_index, -1)));

-- The signature changes: the v6 overload goes, or PostgREST would see two and call either.
drop function if exists public.survival_settle_order(uuid, text, text, numeric, numeric, bigint, text, text, text, boolean);

create or replace function public.survival_settle_order(p_order uuid, p_wallet text, p_tx text, p_paid_wei numeric, p_to_pool_wei numeric, p_block bigint, p_platform text, p_mode text, p_payer text, p_via_hub boolean, p_log_index int)
 returns text
 language plpgsql
as $function$
declare
    o survival_orders%rowtype;
    pay_id uuid;
    floor_wei numeric;
    prize survival_ticket_prizes%rowtype;
    runs int;
    nft survival_ticket_nfts%rowtype;
    ent_id uuid;
    prize_json jsonb;
    draws int;
begin
    select * into o from survival_orders where id = p_order for update;
    if not found or o.wallet <> p_wallet then return 'no_order'; end if;
    if o.status = 'paid' then
        return case when o.tx_hash = p_tx then 'paid' else 'used' end;
    end if;
    if o.mode <> p_mode then return 'wrong_mode'; end if;
    floor_wei := case when p_via_hub then trunc(o.min_wei * 9000 / 10000) else o.min_wei end;
    if p_paid_wei < floor_wei then return 'underpaid'; end if;
    -- One payment per order, and one Paid EVENT books one order: the same event (tx + log index)
    -- cannot pay twice, but a second event in the same transaction (an ERC-4337 bundle carrying
    -- two players' payments) pays its own order.
    if exists (select 1 from survival_payments
               where order_id = p_order
                  or (tx_hash = p_tx and coalesce(log_index, -1) = coalesce(p_log_index, -1))) then
        return 'used';
    end if;

    update survival_orders set status = 'paid', tx_hash = p_tx, paid_wei = p_paid_wei, paid_at = now() where id = p_order;
    insert into survival_payments (tx_hash, wallet, season_id, amount_ape, block_number, confirmed_at, credits_granted,
                                   order_id, to_pool_ape, platform, mode, payer, log_index)
        values (p_tx, p_wallet, o.season_id, round(p_paid_wei / 1e18, 6), p_block, now(), o.credits,
                o.id, round(p_to_pool_wei / 1e18, 6), p_platform, o.mode, p_payer, p_log_index)
        returning id into pay_id;
    if o.kind = 'runs' then
        for i in 1..o.credits loop
            insert into survival_credits (wallet, season_id, payment_id, source, mode)
                values (p_wallet, o.season_id, pay_id, case when p_platform = 'otherside' then 'arcade' else 'purchase' end, o.mode);
        end loop;
    elsif o.kind = 'ticket' then
        draws := greatest(1, least(50, coalesce((o.grant_spec->>'count')::int, 1)));
        for d in 1..draws loop
            nft := null;
            prize := survival_ticket_draw();
            if prize.id is null then
                prize.id := 'fallback'; prize.label := '200 Ape Mini'; prize.kind := 'coins'; prize.spec := '{"coins":200}';
            end if;
            prize_json := jsonb_build_object('id', prize.id, 'label', prize.label, 'kind', prize.kind, 'spec', prize.spec);
            if prize.kind = 'runs' then
                runs := greatest(1, least(10, coalesce((prize.spec->>'runs')::int, 1)));
                for i in 1..runs loop
                    insert into survival_credits (wallet, season_id, payment_id, source, mode)
                        values (p_wallet, o.season_id, pay_id, 'grant', 'solo');
                end loop;
            elsif prize.kind = 'nft' then
                select * into nft from survival_ticket_nfts where prize_id = prize.id and status = 'available'
                    order by added_at, id limit 1 for update skip locked;
                if nft.id is null then
                    prize_json := jsonb_build_object('id', 'fallback', 'label', '200 Ape Mini', 'kind', 'coins', 'spec', '{"coins":200}'::jsonb);
                else
                    prize_json := prize_json || jsonb_build_object('nft', jsonb_build_object(
                        'id', nft.id, 'contract', nft.contract, 'tokenId', nft.token_id, 'name', nft.name, 'image', nft.image_url));
                    if nft.name is not null then prize_json := jsonb_set(prize_json, '{label}', to_jsonb(nft.name)); end if;
                end if;
            end if;
            insert into survival_entitlements (wallet, order_id, sku, kind, grant_spec, season_id)
                values (p_wallet, o.id, o.sku, 'ticket', jsonb_build_object('prize', prize_json, 'n', d, 'of', draws), o.season_id)
                returning id into ent_id;
            if nft.id is not null then
                update survival_ticket_nfts set status = 'reserved', winner = p_wallet, entitlement_id = ent_id where id = nft.id;
            end if;
        end loop;
    else
        insert into survival_entitlements (wallet, order_id, sku, kind, grant_spec, season_id)
            values (p_wallet, o.id, o.sku, o.kind, o.grant_spec, o.season_id);
    end if;
    if p_to_pool_wei > 0 then
        insert into survival_pool_ledger (season_id, bucket, source, amount_ape, ref)
            values (o.season_id, o.mode || '_pool', 'entry', round(p_to_pool_wei / 1e18, 6), p_tx);
    end if;
    return 'paid';
end $function$;

revoke all on function public.survival_settle_order(uuid, text, text, numeric, numeric, bigint, text, text, text, boolean, int) from public, anon, authenticated;
grant execute on function public.survival_settle_order(uuid, text, text, numeric, numeric, bigint, text, text, text, boolean, int) to service_role;
