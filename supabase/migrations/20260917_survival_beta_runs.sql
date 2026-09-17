-- Droidz Survival — the beta's server-side runs (17.09.2026).
--
-- Additive on top of 20260912_survival_prize_pool.sql. What it adds:
--   * the pulse trail on survival_runs, so the envelope (src/lib/survivalEnvelope.ts) can check
--     that a run only ever moved forward and never ahead of the wall clock;
--   * a `flags` column for the soft review signals (never a rejection);
--   * the beta season itself — live, pays nothing, says so (pays_out = false), and cheap to
--     enter: runs in it need no credit (credit_id stays null), which is what a closed beta is.
--
-- Nothing here touches money: the ledger, payments and payouts are untouched.

alter table survival_runs
    add column if not exists last_pulse_at    timestamptz,
    add column if not exists last_pulse_wave  int,
    add column if not exists last_pulse_kills int,
    add column if not exists last_pulse_score int,
    add column if not exists pulse_count      int  not null default 0,
    add column if not exists client_duration_ms int,
    add column if not exists flags            jsonb not null default '[]';

-- One active run per wallet is a rule the routes enforce; this makes the lookup cheap.
create index if not exists survival_runs_wallet_started
    on survival_runs (wallet, started_at desc) where status = 'started';

insert into survival_seasons (id, name, starts_at, ends_at, status, entry_fee_ape, pays_out,
                              min_wallets, min_entry_pool_ape)
values ('beta-1', 'Closed Beta', now(), now() + interval '90 days', 'live', 0, false, 0, 0)
on conflict (id) do nothing;
