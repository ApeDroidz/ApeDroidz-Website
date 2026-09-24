-- Droidz Survival, 25.09.2026 — ticket packs, the pass discount for droid holders, the pool forecast.
--
-- The owner:
--   «тикет покупаешь как в Glitch Cards — выбираешь количество, чем больше, тем больше скидка»;
--   «цену бокса чуть поднимем»;
--   «пропуск 33 APE, с дроидом скидка 30%»;
--   «из пула сезона получают только те, кто покупает пасс; калькулятор — сколько ты сейчас
--    прогнозно получишь»; «сразу замораживать 10–15% пула на старт следующего сезона».
--
-- 50% of every purchase goes to the pool (the cashier's immutable split) — runs, tickets and the
-- pass alike; nothing here changes that.

-- 1. A discount for ApeDroidz holders, per catalog row (the order route checks the wallet).
alter table survival_catalog add column if not exists holder_discount_pct numeric(5,2) not null default 0
    check (holder_discount_pct >= 0 and holder_discount_pct <= 90);
update survival_catalog set holder_discount_pct = 30 where sku = 'season_pass';

-- 2. Tickets: 1 APE (owner, 25.09), and packs that get cheaper per ticket the bigger they are.
--    grant_spec.count = how many tickets the pack draws (each one its own prize).
update survival_catalog set price_ape = 1, grant_spec = '{"count":1}' where sku = 'ticket';
insert into survival_catalog (sku, kind, title, description, price_ape, credits, mode, grant_spec, active, sort) values
    ('ticket5',  'ticket', '5 Lucky Tickets',  '5 spins, 5% off',  4.75,  0, 'solo', '{"count":5}',  true, 41),
    ('ticket10', 'ticket', '10 Lucky Tickets', '10 spins, 10% off', 9, 0, 'solo', '{"count":10}', true, 42),
    ('ticket20', 'ticket', '20 Lucky Tickets', '20 spins, 15% off', 17, 0, 'solo', '{"count":20}', true, 43),
    ('ticket50', 'ticket', '50 Lucky Tickets', '50 spins, 20% off', 40,   0, 'solo', '{"count":50}', true, 44)
on conflict (sku) do nothing;

-- An order used to make at most one entitlement (unique order_id); a pack makes one per ticket.
-- Still unique per order AND per ticket number, so a replayed settlement cannot double a pack.
alter table survival_entitlements drop constraint if exists survival_entitlements_order_id_key;
create unique index if not exists survival_entitlements_order_n
    on survival_entitlements (order_id, (coalesce((grant_spec->>'n')::int, 1))) where order_id is not null;

-- 3. Settlement v6: a ticket order draws `count` prizes, one entitlement each (a pack of ten is
--    ten spins in the game). Everything else as in v5.
create or replace function public.survival_settle_order(p_order uuid, p_wallet text, p_tx text, p_paid_wei numeric, p_to_pool_wei numeric, p_block bigint, p_platform text, p_mode text, p_payer text, p_via_hub boolean)
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
    if exists (select 1 from survival_payments where tx_hash = p_tx) then return 'used'; end if;

    update survival_orders set status = 'paid', tx_hash = p_tx, paid_wei = p_paid_wei, paid_at = now() where id = p_order;
    insert into survival_payments (tx_hash, wallet, season_id, amount_ape, block_number, confirmed_at, credits_granted,
                                   order_id, to_pool_ape, platform, mode, payer)
        values (p_tx, p_wallet, o.season_id, round(p_paid_wei / 1e18, 6), p_block, now(), o.credits,
                o.id, round(p_to_pool_wei / 1e18, 6), p_platform, o.mode, p_payer)
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
                prize.id := 'fallback'; prize.label := '500 Ape Mini'; prize.kind := 'coins'; prize.spec := '{"coins":500}';
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
                    prize_json := jsonb_build_object('id', 'fallback', 'label', '500 Ape Mini', 'kind', 'coins', 'spec', '{"coins":500}'::jsonb);
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

-- 4. The forecast's raw material: every wallet with an accepted run this season, its best score,
--    and whether it holds the season pass (only pass holders share the pool — owner, 25.09).
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
        select distinct e.wallet from survival_entitlements e where e.season_id = p_season and e.kind = 'season_pass'
    )
    select b.wallet, b.best, exists (select 1 from pass p where p.wallet = b.wallet)
    from best b
    union all
    -- a pass holder without a run yet still counts toward «how many share the pool»
    select p.wallet, 0::bigint, true from pass p where not exists (select 1 from best b where b.wallet = p.wallet);
$function$;
