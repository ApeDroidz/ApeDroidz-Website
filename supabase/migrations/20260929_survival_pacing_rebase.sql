-- Droidz Survival — the beta's savings rebased to the new progression pacing (29.09.2026).
--
-- The pacing patch (game config + lib/survivalEconomy.ts) makes a hero's CHASSIS branch 9 600 Ape Mini
-- instead of 31 800, a tier-4 node's first level core-free, a capstone and MARK IV one core, and adds
-- the DAILY BONUS. Savings made at the old rates would buy most of the new game on day one, so:
--   • Ape Mini × 0.2 (rounded down), at most 6 000 (variant C, owner 30.09.2026: run pay halved, the
--     chassis at ~0.2 of its old price — without the cap the richest beta save buys every branch at once);
--   • resources capped: scrap 400, circuit 100, cell 100, core 5 (below the cap: untouched);
--   • everything OPENED stays: heroes, tree levels, weapon tiers, items, cosmetics, bestiary, lifetime,
--     season XP and claims (the season row is not touched at all).
--
-- NOT APPLIED. Apply after the site + game build with the new pacing is live (see the rollout order),
-- with scripts/apply-survival-pacing-rebase.mjs (dry run by default, --commit to apply).
--
-- Reversible: every profile is copied to survival_profiles_pacing_backup BEFORE it is changed
-- (state, coins, updated_at as they were). Rollback at the end of this file.
-- One-shot: a wallet whose backup row carries rebased_at is never rebased again, so running the file a
-- second time changes nothing for it.
-- Live writers: updated_at moves to now(), so a server write in flight (withEcon's compare-and-set on
-- updated_at) conflicts and re-reads the rebased row; state.rev + 1, so an open tab's older save is
-- refused as stale and the tab adopts the server's economy.

create table if not exists survival_profiles_pacing_backup (
    wallet       text primary key,
    state        jsonb not null,
    coins        integer,
    updated_at   timestamptz,
    backed_up_at timestamptz not null default now(),
    rebased_at   timestamptz
);
alter table survival_profiles_pacing_backup enable row level security;

-- 1. The backup: every profile not backed up yet, as it is now.
insert into survival_profiles_pacing_backup (wallet, state, coins, updated_at)
select wallet, state, coins, updated_at from survival_profiles where state is not null
on conflict (wallet) do nothing;

-- 2. The rebase, of exactly the rows backed up and not yet rebased.
with todo as (
    select b.wallet from survival_profiles_pacing_backup b where b.rebased_at is null
), num as (
    select p.wallet,
        case when jsonb_typeof(p.state->'coins') = 'number' then greatest(0, (p.state->>'coins')::numeric) else 0 end as c0,
        coalesce(p.state->'resources', '{}'::jsonb) as r0,
        case when jsonb_typeof(p.state->'rev') = 'number' then (p.state->>'rev')::numeric else 0 end as rev0
    from survival_profiles p join todo t on t.wallet = p.wallet
), nxt as (
    select wallet, rev0,
        least(floor(c0 * 0.2), 6000)::bigint as coins,
        r0 || jsonb_build_object(
            'scrap',   least(case when jsonb_typeof(r0->'scrap')   = 'number' then greatest(0, floor((r0->>'scrap')::numeric))   else 0 end, 400),
            'circuit', least(case when jsonb_typeof(r0->'circuit') = 'number' then greatest(0, floor((r0->>'circuit')::numeric)) else 0 end, 100),
            'cell',    least(case when jsonb_typeof(r0->'cell')    = 'number' then greatest(0, floor((r0->>'cell')::numeric))    else 0 end, 100),
            'core',    least(case when jsonb_typeof(r0->'core')    = 'number' then greatest(0, floor((r0->>'core')::numeric))    else 0 end, 5)
        ) as resources
    from num
)
update survival_profiles p
set state = p.state || jsonb_build_object('coins', n.coins, 'resources', n.resources, 'rev', n.rev0 + 1),
    coins = n.coins::integer,
    updated_at = now()
from nxt n
where p.wallet = n.wallet;

update survival_profiles_pacing_backup set rebased_at = now() where rebased_at is null;

-- ── ROLLBACK (by hand; not run by this file) ─────────────────────────────────────────────────────
-- a) Right after applying (nobody has played since): put the rows back exactly as they were.
--      update survival_profiles p
--      set state = b.state || jsonb_build_object('rev', coalesce((p.state->>'rev')::numeric, 0) + 1),
--          coins = b.coins, updated_at = now()
--      from survival_profiles_pacing_backup b where b.wallet = p.wallet and b.rebased_at is not null;
--      update survival_profiles_pacing_backup set rebased_at = null;
-- b) Later (players have earned and spent since): give back only what the rebase took, on top of now.
--      update survival_profiles p
--      set state = p.state || jsonb_build_object(
--              'coins', coalesce((p.state->>'coins')::numeric, 0) + (coalesce((b.state->>'coins')::numeric, 0) - least(floor(coalesce((b.state->>'coins')::numeric, 0) * 0.2), 6000)),
--              'resources', coalesce(p.state->'resources', '{}'::jsonb) || jsonb_build_object(
--                  'scrap',   coalesce((p.state->'resources'->>'scrap')::numeric, 0)   + greatest(0, coalesce((b.state->'resources'->>'scrap')::numeric, 0)   - 400),
--                  'circuit', coalesce((p.state->'resources'->>'circuit')::numeric, 0) + greatest(0, coalesce((b.state->'resources'->>'circuit')::numeric, 0) - 100),
--                  'cell',    coalesce((p.state->'resources'->>'cell')::numeric, 0)    + greatest(0, coalesce((b.state->'resources'->>'cell')::numeric, 0)    - 100),
--                  'core',    coalesce((p.state->'resources'->>'core')::numeric, 0)    + greatest(0, coalesce((b.state->'resources'->>'core')::numeric, 0)    - 5)),
--              'rev', coalesce((p.state->>'rev')::numeric, 0) + 1),
--          updated_at = now()
--      from survival_profiles_pacing_backup b where b.wallet = p.wallet and b.rebased_at is not null;
--      update survival_profiles p set coins = (p.state->>'coins')::numeric::integer
--      from survival_profiles_pacing_backup b where b.wallet = p.wallet and b.rebased_at is not null;
--      update survival_profiles_pacing_backup set rebased_at = null;
-- The backup table is dropped by hand once the rebase is settled: drop table survival_profiles_pacing_backup;
