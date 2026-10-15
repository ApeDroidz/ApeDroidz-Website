-- Droidz Survival — co-op runs (game/docs/COOP.md, «Решения 15.10»; owner, 15.10.2026).
--
-- A co-op run is ONE team (2–4 wallets) and one survival_runs row per member, mode 'coop', tied
-- by coop_id. The room's START (the relay → api/survival/coop/start) opens them all in one
-- transaction: every member's run is spent or none is — survival_coop_open below. Each member's
-- run then lives exactly like a solo one (pulses, finish, the envelope, the pay), so everything
-- that keeps a solo result honest keeps a co-op one honest too.
--
--   Which credit: the same run a solo game spends, the welcome gift first (owner: «тот же забег,
--   что в соло, подарочные тоже считаются»). A continue in co-op spends one the same way.
--   The solo board: a co-op run is not a solo result — the trigger leaves it out of season_best.
--   The co-op board: one row per team (survival_coop_runs), its score the members' sum, its wave
--   the furthest a member reached; filled as the members' finishes land (api/survival/run/finish).
--
-- Additive: one table, one column, two functions replaced (the best-run trigger, the continue).

create table if not exists survival_coop_runs (
    id            uuid primary key default gen_random_uuid(),
    season_id     text not null references survival_seasons (id),
    room_id       text not null,
    host_wallet   text,
    wallets       text[] not null,
    status        text not null default 'started' check (status in ('started','finished','void')),
    started_at    timestamptz not null default now(),
    finished_at   timestamptz,
    score         bigint not null default 0 check (score >= 0),
    wave          int not null default 0 check (wave >= 0),
    kills         int not null default 0 check (kills >= 0),
    -- The members as counted: [{wallet, run_id, status, score, wave, kills, hero}] (the board's «who did what»).
    members       jsonb not null default '[]'::jsonb,
    flags         jsonb not null default '[]'::jsonb
);
create index if not exists survival_coop_runs_top on survival_coop_runs (season_id, score desc) where status = 'finished';
alter table survival_coop_runs enable row level security;

alter table survival_runs add column if not exists coop_id uuid references survival_coop_runs (id);
create index if not exists survival_runs_coop on survival_runs (coop_id) where coop_id is not null;

-- The solo board is solo: a co-op member's run never lands in survival_season_best.
create or replace function survival_apply_run_to_best() returns trigger
language plpgsql as $$
begin
    if new.status <> 'finished' then return new; end if;
    if new.mode = 'coop' then return new; end if;
    if tg_op = 'UPDATE' and old.status = 'finished' then return new; end if;

    insert into survival_season_best as b
        (season_id, wallet, run_id, score, wave, kills, achieved_at, runs_count)
    values
        (new.season_id, new.wallet, new.id, new.score, new.wave, new.kills,
         coalesce(new.finished_at, now()), 1)
    on conflict (season_id, wallet) do update set
        run_id      = case when excluded.score > b.score then excluded.run_id      else b.run_id      end,
        score       = greatest(b.score, excluded.score),
        wave        = case when excluded.score > b.score then excluded.wave        else b.wave        end,
        kills       = case when excluded.score > b.score then excluded.kills       else b.kills       end,
        achieved_at = case when excluded.score > b.score then excluded.achieved_at else b.achieved_at end,
        runs_count  = b.runs_count + 1;

    return new;
end $$;

-- A co-op run spends a SOLO credit (the same run); a co-op credit bought before this, if any, after.
create or replace function survival_continue_run(p_wallet text, p_run uuid) returns text
language plpgsql as $$
declare
    r survival_runs%rowtype;
    credit uuid;
begin
    select * into r from survival_runs where id = p_run for update;
    if not found or r.wallet <> p_wallet or r.status <> 'started' then return 'no_run'; end if;
    if r.continues >= 1 then return 'already'; end if;
    select survival_consume_credit(p_wallet, p_run, case when r.mode = 'coop' then 'solo' else r.mode end) into credit;
    if credit is null and r.mode = 'coop' then
        select survival_consume_credit(p_wallet, p_run, 'coop') into credit;
    end if;
    if credit is null then return 'no_credit'; end if;
    update survival_runs set continues = continues + 1 where id = p_run;
    return 'ok';
end $$;
revoke all on function survival_continue_run(text, uuid) from public, anon, authenticated;

-- START: the team's runs, all or none. One survival_runs row per member (mode 'coop', coop_id),
-- and — when runs are paid — one credit spent per member, oldest welcome credit first. If any
-- member has none, the whole transaction is undone and the error names him: 'no_credit:<wallet>'.
create or replace function survival_coop_open(
    p_season text, p_room text, p_host text,
    p_wallets text[], p_heroes text[], p_weapons text[], p_versions text[],
    p_seed bigint, p_paid boolean
) returns table (o_wallet text, o_run uuid, o_coop uuid)
language plpgsql as $$
declare
    cid uuid;
    i int;
    rid uuid;
    credit uuid;
begin
    insert into survival_coop_runs (season_id, room_id, host_wallet, wallets)
        values (p_season, p_room, p_host, p_wallets)
        returning id into cid;
    for i in 1 .. coalesce(array_length(p_wallets, 1), 0) loop
        insert into survival_runs (season_id, wallet, status, hero, weapon, client_version, mode, rng_seed, coop_id)
            values (p_season, p_wallets[i], 'started', p_heroes[i], p_weapons[i], p_versions[i], 'coop', p_seed, cid)
            returning id into rid;
        if p_paid then
            select survival_consume_credit(p_wallets[i], rid, 'solo') into credit;
            if credit is null then select survival_consume_credit(p_wallets[i], rid, 'coop') into credit; end if;
            if credit is null then
                raise exception 'no_credit:%', p_wallets[i] using errcode = 'P0001';
            end if;
            update survival_runs set credit_id = credit where id = rid;
        end if;
        o_wallet := p_wallets[i];
        o_run := rid;
        o_coop := cid;
        return next;
    end loop;
end $$;
revoke all on function survival_coop_open(text, text, text, text[], text[], text[], text[], bigint, boolean) from public, anon, authenticated;
