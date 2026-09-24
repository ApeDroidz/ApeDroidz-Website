-- Droidz Survival — a price list the owner edits, and purchases beyond runs (25.09.2026).
--
-- Owner: «цену забега хочу менять; подготовить систему, чтобы брать оплату за внутренние покупки —
-- пропуск сезона, доп. предметы, боксы и т.д.; продление после смерти = цена запуска новой игры».
--
--   survival_catalog      what can be bought, at what price, feeding which pool. Edited in spltpnl;
--                         an order copies the row, so a price change never touches an order in flight.
--   survival_entitlements what a paid order that is NOT runs gave the player (a pass, an item, a box,
--                         a bundle) — issued by the server, applied by the game (the save is the
--                         client's: currencies and bag are never written server-side), claimed once.
--   a continue is a run credit spent on the run already going — one per run, enforced here.

create table if not exists survival_catalog (
    sku          text primary key check (sku ~ '^[a-z0-9_]{2,32}$'),
    kind         text not null check (kind in ('runs','season_pass','item','box','bundle')),
    title        text not null,
    description  text not null default '',
    price_ape    numeric(18,6) not null check (price_ape > 0 and price_ape <= 10000),
    credits      int  not null default 0 check (credits >= 0 and credits <= 1000),
    mode         text not null default 'solo' check (mode in ('solo','coop')),
    -- What the game grants: season_pass {} · item {"kind":"servo","rarity":"epic"} ·
    -- box {"box":"basic","rolls":3} · bundle {"coins":5000,"resources":{"scrap":50}}.
    grant_spec   jsonb not null default '{}',
    active       boolean not null default false,
    sort         int not null default 0,
    updated_at   timestamptz not null default now(),
    updated_by   text,
    constraint survival_catalog_runs_have_credits check (kind <> 'runs' or credits > 0)
);
alter table survival_catalog enable row level security; -- service role only

insert into survival_catalog (sku, kind, title, description, price_ape, credits, active, sort) values
    ('run',   'runs', '1 run',   'One run.',                  2,  1,  true, 10),
    ('run10', 'runs', '10 runs', 'Ten runs, one free.',       18, 10, true, 20)
on conflict (sku) do nothing;
insert into survival_catalog (sku, kind, title, description, price_ape, active, sort) values
    ('season_pass', 'season_pass', 'Season pass', 'Unlocks the PASS rewards of the current season.', 10, false, 30)
on conflict (sku) do nothing;

alter table survival_orders add column if not exists kind       text not null default 'runs';
alter table survival_orders add column if not exists grant_spec jsonb not null default '{}';
alter table survival_runs   add column if not exists continues  int  not null default 0;

create table if not exists survival_entitlements (
    id          uuid primary key default gen_random_uuid(),
    wallet      text not null references survival_players (wallet),
    order_id    uuid not null unique references survival_orders (id),
    sku         text not null,
    kind        text not null,
    grant_spec  jsonb not null default '{}',
    season_id   text,
    -- For a box: the server's dice. The game derives the contents from it, so reopening the game
    -- can never reroll what was bought.
    seed        bigint not null default (floor(random() * 9007199254740991))::bigint,
    created_at  timestamptz not null default now(),
    claimed_at  timestamptz
);
create index if not exists survival_entitlements_open on survival_entitlements (wallet) where claimed_at is null;
alter table survival_entitlements enable row level security;

-- Booking v3: runs → credits (as before); anything else → one entitlement. Mode, price floor,
-- idempotency and the pool share exactly as in 20260924_survival_modes.
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
    if o.kind = 'runs' then
        for i in 1..o.credits loop
            insert into survival_credits (wallet, season_id, payment_id, source, mode)
                values (p_wallet, o.season_id, pay_id, case when p_platform = 'otherside' then 'arcade' else 'purchase' end, o.mode);
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
end $$;
revoke all on function survival_settle_order(uuid, text, text, numeric, numeric, bigint, text, text, text, boolean) from public, anon, authenticated;

-- A continue: one run credit spent on the run already going, at most once per run.
-- Returns 'ok' | 'no_run' | 'already' | 'no_credit'.
create or replace function survival_continue_run(p_wallet text, p_run uuid) returns text
language plpgsql as $$
declare
    r survival_runs%rowtype;
    credit uuid;
begin
    select * into r from survival_runs where id = p_run for update;
    if not found or r.wallet <> p_wallet or r.status <> 'started' then return 'no_run'; end if;
    if r.continues >= 1 then return 'already'; end if;
    select survival_consume_credit(p_wallet, p_run, r.mode) into credit;
    if credit is null then return 'no_credit'; end if;
    update survival_runs set continues = continues + 1 where id = p_run;
    return 'ok';
end $$;
revoke all on function survival_continue_run(text, uuid) from public, anon, authenticated;

-- Claiming what the game has applied. Only the owner's, only once.
create or replace function survival_claim_entitlements(p_wallet text, p_ids uuid[]) returns int
language sql as $$
    with done as (
        update survival_entitlements set claimed_at = now()
        where wallet = p_wallet and id = any(p_ids) and claimed_at is null
        returning 1
    ) select count(*)::int from done;
$$;
revoke all on function survival_claim_entitlements(text, uuid[]) from public, anon, authenticated;
