-- Droidz Survival — server-side progress and the event journal (18.09.2026).
--
-- Progress lives in two tables so a season can end without taking anything a player OWNS
-- with it (the owner: «чтобы у них не сбросился полностью прогресс после сезона»):
--   survival_profiles          what is theirs for good — Ape Mini, heroes, weapons, the Lab,
--                              the bestiary, lifetime numbers, settings
--   survival_profile_seasons   what belongs to a season — season XP, tier, claimed tiers, daily
-- Both keep the whole client state as JSON (the game's own MetaState shape, versioned) plus a
-- few extracted columns for analytics, so the panel can count without parsing.
--
-- survival_events is the journal: client errors, server rejections, verdicts, anything worth
-- looking at later. Append-only by convention; the panel and scripts/survival-log.mjs read it.

create table if not exists survival_profiles (
    wallet          text primary key references survival_players (wallet),
    state           jsonb       not null default '{}',
    save_version    int         not null default 1,
    coins           int         not null default 0 check (coins >= 0),
    runs            int         not null default 0,
    best_score      int         not null default 0,
    selected_hero   text,
    client_version  text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table if not exists survival_profile_seasons (
    wallet          text        not null references survival_players (wallet),
    season_id       text        not null references survival_seasons (id),
    season          jsonb       not null default '{}',
    daily           jsonb       not null default '{}',
    sxp             int         not null default 0,
    tier            int         not null default 0,
    updated_at      timestamptz not null default now(),
    primary key (wallet, season_id)
);

create table if not exists survival_events (
    id              bigserial primary key,
    at              timestamptz not null default now(),
    wallet          text,
    source          text        not null default 'client' check (source in ('client','server')),
    level           text        not null default 'info' check (level in ('debug','info','warn','error')),
    kind            text        not null,
    message         text        not null default '',
    data            jsonb       not null default '{}',
    run_id          uuid,
    client_version  text,
    ip_hash         text
);
create index if not exists survival_events_at      on survival_events (at desc);
create index if not exists survival_events_level   on survival_events (level, at desc);
create index if not exists survival_events_wallet  on survival_events (wallet, at desc);
create index if not exists survival_events_kind    on survival_events (kind, at desc);

alter table survival_profiles        enable row level security;
alter table survival_profile_seasons enable row level security;
alter table survival_events          enable row level security;
