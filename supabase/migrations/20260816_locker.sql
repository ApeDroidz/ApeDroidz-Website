-- Locker — permanent ("lifetime") locking of ApeDroidz in exchange for Gnanas freemints.
--
-- Design rule for this whole file: **the lock itself is chain state, these tables are a mirror.**
-- Every row is written by the server only after it has read the lock back out of
-- DroidLockRegistry on ApeChain, and every number derived from those rows (points, freemints) is
-- computed by a view rather than typed in by anyone.
--
-- That gives the reporting three properties:
--   1. Rows cannot be edited or deleted — triggers below reject UPDATE and DELETE outright.
--   2. Silent tampering is detectable — locker_events is a hash chain; break a link and
--      /api/admin/locker/reconcile says so.
--   3. Even a total loss of this database costs nothing but convenience, because which droids are
--      locked and by whom can be rebuilt entirely from the registry contract.
--
-- Two limits, stated plainly so nobody relies on more than is true.
--
-- First: a Postgres superuser can drop a trigger. What they cannot do is change history without it
-- showing up in the hash chain or in the comparison against the chain.
--
-- Second, and more important: **a droid's level is not chain state.** `droidz.level` and
-- `is_super` are ordinary columns, the token's metadata is served from this database, and nothing
-- on-chain records which droid a burned battery upgraded. So the *lock* is unforgeable while the
-- *multiplier applied to it* rests on our own record-keeping. `multiplier_x100` is therefore
-- snapshotted at lock time and frozen — a later change to a droid's level cannot rewrite what a
-- holder was already credited — but it is a snapshot of our data, not of a chain fact.

-- ── locks: one row per permanently locked droid ──────────────────────────────────────────────

create table if not exists locker_locks (
  token_id        integer primary key,
  wallet          text        not null,
  -- Level and super-ness are snapshotted at lock time: the multiplier a holder was promised
  -- must not drift if traits are ever recomputed.
  level           smallint    not null,
  is_super        boolean     not null default false,
  -- Multiplier stored as an integer hundredth (100 = 1.00x, 120 = 1.20x, 150 = 1.50x) so no
  -- float rounding can ever creep into a payout figure.
  multiplier_x100 smallint    not null,
  tx_hash         text        not null,
  block_number    bigint      not null,
  locked_at       timestamptz not null,
  verified_at     timestamptz not null default now(),

  constraint locker_locks_wallet_lower check (wallet = lower(wallet)),
  constraint locker_locks_tx_hash_form check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  constraint locker_locks_multiplier_known check (multiplier_x100 in (100, 120, 150)),
  constraint locker_locks_level_sane check (level between 1 and 10)
);

create index if not exists locker_locks_wallet_idx on locker_locks (wallet);
create index if not exists locker_locks_tx_idx on locker_locks (tx_hash);
create index if not exists locker_locks_locked_at_idx on locker_locks (locked_at desc);

-- ── batches: one row per lock transaction, for reporting ─────────────────────────────────────

create table if not exists locker_batches (
  tx_hash            text primary key,
  wallet             text        not null,
  token_ids          integer[]   not null,
  droid_count        smallint    not null,
  -- Points earned by this batch, and the wallet's running totals after it. Totals are recorded
  -- so a report can be read without recomputation, but they are always re-derivable from
  -- locker_locks — reconcile checks exactly that.
  points_x100        integer     not null,
  total_points_x100  integer     not null,
  freemints_before   integer     not null,
  freemints_after    integer     not null,
  block_number       bigint      not null,
  created_at         timestamptz not null default now(),

  constraint locker_batches_wallet_lower check (wallet = lower(wallet)),
  constraint locker_batches_tx_form check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  constraint locker_batches_count_matches check (droid_count = array_length(token_ids, 1)),
  constraint locker_batches_freemints_grow check (freemints_after >= freemints_before)
);

create index if not exists locker_batches_wallet_idx on locker_batches (wallet);
create index if not exists locker_batches_created_idx on locker_batches (created_at desc);

-- ── events: append-only, hash-chained audit log ──────────────────────────────────────────────
--
-- Every state change appends one row. `row_hash` = sha256(prev_hash || canonical payload), so
-- altering or removing any historical row breaks every hash after it.

create table if not exists locker_events (
  id         bigserial primary key,
  kind       text        not null,
  wallet     text,
  payload    jsonb       not null,
  prev_hash  text        not null,
  row_hash   text        not null,
  created_at timestamptz not null default now(),

  constraint locker_events_kind_known check (kind in ('lock', 'reconcile', 'note')),
  constraint locker_events_hash_form check (row_hash ~ '^[0-9a-f]{64}$' and prev_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists locker_events_wallet_idx on locker_events (wallet);
create index if not exists locker_events_created_idx on locker_events (created_at desc);

-- ── append-only enforcement ──────────────────────────────────────────────────────────────────

create or replace function locker_reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception
    'locker tables are append-only: % on % is not allowed. The chain is the source of truth; correct data by locking on-chain, not by editing rows.',
    tg_op, tg_table_name
    using errcode = 'raise_exception';
end;
$$;

drop trigger if exists locker_locks_no_mutate on locker_locks;
create trigger locker_locks_no_mutate
  before update or delete on locker_locks
  for each row execute function locker_reject_mutation();

drop trigger if exists locker_batches_no_mutate on locker_batches;
create trigger locker_batches_no_mutate
  before update or delete on locker_batches
  for each row execute function locker_reject_mutation();

drop trigger if exists locker_events_no_mutate on locker_events;
create trigger locker_events_no_mutate
  before update or delete on locker_events
  for each row execute function locker_reject_mutation();

-- ── the hash chain, computed in the database ─────────────────────────────────────────────────
--
-- Computed here rather than in the API so the chain stays intact even if a row is inserted by
-- some other path (psql, a future job). The caller cannot choose its own hash.

create or replace function locker_events_seal() returns trigger
language plpgsql as $$
declare
  last_hash text;
begin
  select row_hash into last_hash from locker_events order by id desc limit 1;
  if last_hash is null then
    -- genesis
    last_hash := repeat('0', 64);
  end if;

  new.prev_hash := last_hash;
  new.row_hash := encode(
    digest(
      last_hash || new.kind || coalesce(new.wallet, '') || new.payload::text,
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

-- digest() lives in pgcrypto.
create extension if not exists pgcrypto;

drop trigger if exists locker_events_seal_trg on locker_events;
create trigger locker_events_seal_trg
  before insert on locker_events
  for each row execute function locker_events_seal();

-- ── chain verification ───────────────────────────────────────────────────────────────────────
--
-- Recomputed inside Postgres on purpose. Verifying in the API would mean reproducing this exact
-- `payload::text` rendering in JavaScript, and any difference in key order or spacing would give
-- false alarms. Same expression in, same expression out.

create or replace function locker_verify_chain()
returns table (checked bigint, ok boolean, first_bad_id bigint)
language plpgsql stable as $$
declare
  r          record;
  running    text := repeat('0', 64);
  expected   text;
  seen       bigint := 0;
  bad        bigint := null;
begin
  for r in select * from locker_events order by id asc loop
    seen := seen + 1;
    expected := encode(
      digest(running || r.kind || coalesce(r.wallet, '') || r.payload::text, 'sha256'),
      'hex'
    );
    if r.prev_hash <> running or r.row_hash <> expected then
      bad := r.id;
      exit;
    end if;
    running := r.row_hash;
  end loop;

  return query select seen, bad is null, bad;
end;
$$;

comment on function locker_verify_chain is
  'Walks locker_events from the genesis hash and recomputes every link. Returns ok = false with '
  'the id of the first row whose hash does not follow from the one before it.';

-- ── derived views: the only numbers anyone should quote ──────────────────────────────────────

-- Per-wallet totals, recomputed from the locks themselves. Nothing to tamper with.
create or replace view locker_wallet_totals as
select
  wallet,
  count(*)::integer                                as droids_locked,
  count(*) filter (where level = 1)::integer       as lvl1_count,
  count(*) filter (where level >= 2 and not is_super)::integer as lvl2_count,
  count(*) filter (where level >= 2 and is_super)::integer     as lvl2_super_count,
  sum(multiplier_x100)::integer                    as points_x100,
  floor(sum(multiplier_x100) / 100.0)::integer     as freemints,
  min(locked_at)                                   as first_lock_at,
  max(locked_at)                                   as last_lock_at
from locker_locks
group by wallet;

comment on view locker_wallet_totals is
  'Freemint entitlement per wallet, derived from locker_locks. Sum of multipliers across the '
  'wallet''s whole history, floored — so splitting locks into batches can never earn more than '
  'doing them at once.';

-- ── RLS: nothing here is readable by the browser ─────────────────────────────────────────────
-- Reads go through server routes only; the anon key must not see holder-level data.

alter table locker_locks   enable row level security;
alter table locker_batches enable row level security;
alter table locker_events  enable row level security;
-- No policies are defined on purpose: with RLS on and no policy, the anon key gets nothing,
-- while the service role (server-side only) bypasses RLS as usual.
