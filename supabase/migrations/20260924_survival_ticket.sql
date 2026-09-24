-- Droidz Survival — the lucky ticket (24.09.2026, owner: «билет за 1 APE, внутри призы, прокручивается
-- рулеткой: ресурсы, мини эйпы, бусты x2 на время, иногда бесплатный забег, очень редко — дроид»).
--
-- The draw happens HERE, when the payment is booked — never in the game. The game only spins the
-- wheel to the prize the server already chose (survival_entitlements.grant_spec.prize). Weights and
-- stock are edited in spltpnl; a prize with stock runs out and stops dropping. Free runs are
-- credited on the spot; an NFT is sent by the team by hand (fulfilled_at marks it done).

create table if not exists survival_ticket_prizes (
    id        text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
    label     text not null,
    kind      text not null check (kind in ('coins','resources','item','boost','runs','nft')),
    -- coins {"coins":500} · resources {"resources":{"scrap":10}} · item {"rarity":"epic"} (kind rolled
    -- by the game from the seed) · boost {"minutes":30} · runs {"runs":1} · nft {"collection":"ApeDroidz"}
    spec      jsonb not null default '{}',
    weight    int  not null check (weight >= 0),
    stock     int  check (stock is null or stock >= 0),   -- null = unlimited
    active    boolean not null default true,
    sort      int  not null default 0,
    updated_at timestamptz not null default now()
);
alter table survival_ticket_prizes enable row level security;

-- Weights out of 1 000 (see docs/ECONOMY.md): real-value prizes are ~6.5% free runs and 0.1% a droid.
insert into survival_ticket_prizes (id, label, kind, spec, weight, stock, sort) values
    ('mini_500',   '500 Ape Mini',            'coins',     '{"coins":500}',                        343, null, 10),
    ('mini_1500',  '1 500 Ape Mini',          'coins',     '{"coins":1500}',                       150, null, 20),
    ('mini_5000',  '5 000 Ape Mini',          'coins',     '{"coins":5000}',                        30, null, 30),
    ('salvage_s',  'Salvage crate',           'resources', '{"resources":{"scrap":10,"circuit":3}}',150, null, 40),
    ('salvage_l',  'Core crate',              'resources', '{"resources":{"cell":5,"core":2}}',      60, null, 50),
    ('item_rare',  'Rare gear',               'item',      '{"rarity":"rare"}',                     90, null, 60),
    ('item_epic',  'Epic gear',               'item',      '{"rarity":"epic"}',                     35, null, 70),
    ('item_leg',   'Legendary gear',          'item',      '{"rarity":"legendary"}',                 8, null, 80),
    ('x2_30',      'x2 Ape Mini · 30 min',    'boost',     '{"minutes":30}',                        70, null, 90),
    ('x2_120',     'x2 Ape Mini · 2 h',       'boost',     '{"minutes":120}',                       15, null, 100),
    ('run_1',      'Free run',                'runs',      '{"runs":1}',                            40, null, 110),
    ('run_3',      '3 free runs',             'runs',      '{"runs":3}',                             8, null, 120),
    ('droid',      'An ApeDroidz droid',      'nft',       '{"collection":"ApeDroidz"}',             1,    0, 130)
on conflict (id) do nothing;

alter table survival_catalog drop constraint if exists survival_catalog_kind_check;
alter table survival_catalog add constraint survival_catalog_kind_check check (kind in ('runs','season_pass','item','box','bundle','ticket'));
insert into survival_catalog (sku, kind, title, description, price_ape, active, sort)
    values ('ticket', 'ticket', 'Lucky ticket', 'Spin for Ape Mini, salvage, gear, x2 boosts, free runs — or a droid.', 1, true, 5)
on conflict (sku) do nothing;

alter table survival_entitlements add column if not exists fulfilled_at timestamptz;
alter table survival_entitlements add column if not exists fulfilled_note text;

-- One weighted draw among what is on and in stock; takes one from stock. Null if nothing can drop.
create or replace function survival_ticket_draw() returns survival_ticket_prizes
language plpgsql as $$
declare
    total int;
    pick  int;
    p     survival_ticket_prizes%rowtype;
begin
    select coalesce(sum(weight), 0) into total from survival_ticket_prizes
        where active and weight > 0 and (stock is null or stock > 0);
    if total = 0 then return null; end if;
    pick := floor(random() * total)::int;
    for p in select * from survival_ticket_prizes
             where active and weight > 0 and (stock is null or stock > 0)
             order by sort, id for update loop
        pick := pick - p.weight;
        if pick < 0 then
            if p.stock is not null then update survival_ticket_prizes set stock = stock - 1 where id = p.id; end if;
            return p;
        end if;
    end loop;
    return null;
end $$;
revoke all on function survival_ticket_draw() from public, anon, authenticated;

-- Booking v4: as v3, plus a ticket draws its prize here and records it in the entitlement.
create or replace function survival_settle_order(
    p_order uuid, p_wallet text, p_tx text, p_paid_wei numeric, p_to_pool_wei numeric, p_block bigint,
    p_platform text, p_mode text, p_payer text, p_via_hub boolean
) returns text
language plpgsql as $$
declare
    o survival_orders%rowtype;
    pay_id uuid;
    floor_wei numeric;
    prize survival_ticket_prizes%rowtype;
    runs int;
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
        prize := survival_ticket_draw();
        if prize.id is null then
            -- Nothing can drop (every prize off or out of stock): the ticket is worth its Ape Mini floor.
            prize.id := 'fallback'; prize.label := '500 Ape Mini'; prize.kind := 'coins'; prize.spec := '{"coins":500}';
        end if;
        if prize.kind = 'runs' then
            runs := greatest(1, least(10, coalesce((prize.spec->>'runs')::int, 1)));
            for i in 1..runs loop
                insert into survival_credits (wallet, season_id, payment_id, source, mode)
                    values (p_wallet, o.season_id, pay_id, 'grant', 'solo');
            end loop;
        end if;
        insert into survival_entitlements (wallet, order_id, sku, kind, grant_spec, season_id)
            values (p_wallet, o.id, o.sku, 'ticket',
                    jsonb_build_object('prize', jsonb_build_object('id', prize.id, 'label', prize.label, 'kind', prize.kind, 'spec', prize.spec)),
                    o.season_id);
    else
        insert into survival_entitlements (wallet, order_id, sku, kind, grant_spec, season_id)
            values (p_wallet, o.id, o.sku, o.kind, o.grant_spec, o.season_id);
    end if;
    if p_to_pool_wei > 0 then
        insert into survival_pool_ledger (season_id, bucket, source, amount_ape, ref)
            values (o.season_id, o.mode || '_pool', 'entry', round(p_to_pool_wei / 1e18, 6), p_tx);
    end if;
    return 'paid';
end $$;
revoke all on function survival_settle_order(uuid, text, text, numeric, numeric, bigint, text, text, text, boolean) from public, anon, authenticated;
