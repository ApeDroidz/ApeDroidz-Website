-- Droidz Survival — orders, the cashier contract, credits that carry over (24.09.2026).
--
-- A payment is no longer "some APE sent to the treasury": the player buys an ORDER the server
-- created (what, for whom, the least the cashier must receive), pays it through the cashier
-- contract (contracts/src/DroidzCashier.sol) which emits Paid(player, order, payer, amount,
-- toPool) and splits the money on the spot, and the server credits the order only when that
-- event is on chain for that player and that order. That works the same from the site
-- (thirdweb, player's own wallet) and from the Otherside cabinet (Glyph wallet, via the Hub's
-- FeeSplitter — where neither tx.from nor tx.to is ours and the 1.5% Hub fee is taken first).
--
-- Additive only: nothing existing changes meaning. Runs stay free until SURVIVAL_PAID_RUNS=1.

create table if not exists survival_orders (
    id           uuid primary key default gen_random_uuid(),
    wallet       text        not null references survival_players (wallet),
    season_id    text        not null references survival_seasons (id),
    sku          text        not null,
    credits      int         not null default 0 check (credits >= 0),
    price_ape    numeric(18,6) not null check (price_ape > 0),
    -- The least the cashier must receive: the price net of the Otherside Hub fee (1.5%).
    min_wei      numeric(78,0) not null check (min_wei > 0),
    -- A continue belongs to one run.
    run_id       uuid,
    platform     text        not null default 'site' check (platform in ('site','otherside')),
    -- The chain height when the order was made: where to start looking for its Paid event if the
    -- client never came back with the hash (tab closed mid-payment).
    from_block   bigint,
    status       text        not null default 'pending' check (status in ('pending','paid')),
    tx_hash      text unique,
    paid_wei     numeric(78,0),
    created_at   timestamptz not null default now(),
    paid_at      timestamptz
);
create index if not exists survival_orders_wallet on survival_orders (wallet, created_at desc);
create index if not exists survival_orders_pending on survival_orders (wallet) where status = 'pending';
alter table survival_orders enable row level security; -- no policies: service role only

alter table survival_payments add column if not exists order_id    uuid references survival_orders (id);
alter table survival_payments add column if not exists to_pool_ape numeric(18,6);
alter table survival_payments add column if not exists platform    text;

-- One credit, atomically, for one run. Credits carry over between seasons (a run bought is a
-- run owed), so the season a credit was bought in is not a filter here. SKIP LOCKED: two
-- simultaneous starts can never take the same credit.
create or replace function survival_consume_credit(p_wallet text, p_run uuid) returns uuid
language sql as $$
    update survival_credits set consumed_by_run = p_run
    where id = (
        select id from survival_credits
        where wallet = p_wallet and consumed_by_run is null
        order by created_at
        limit 1
        for update skip locked
    )
    returning id;
$$;
revoke all on function survival_consume_credit(text, uuid) from public, anon, authenticated;
