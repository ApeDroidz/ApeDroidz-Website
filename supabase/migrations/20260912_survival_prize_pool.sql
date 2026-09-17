-- Droidz Survival — призовой пул и серверный лидерборд.
-- Спецификация: "Droidz Survival on Ape"/game/docs/PRIZE_POOL.md §6.
--
-- Всё префиксовано survival_ и живёт в public, как locker_* и glitch_*: анонимный
-- ключ сайта уже видит public, а новую схему пришлось бы отдельно открывать в
-- настройках PostgREST — лишний ручной шаг между "применил" и "работает".
--
-- Два принципа из спеки, которые здесь становятся кодом, а не обещанием:
--   • Деньги append-only. Пул нигде не лежит числом, которое можно поправить;
--     пул = SUM по журналу, и триггер физически запрещает UPDATE/DELETE.
--   • Клиент не пишет ничего. RLS закрывает всё, анону оставлены четыре SELECT
--     на витрины. survival_runs.score недостижим для клиента ни через политику,
--     ни через RPC — только service-role из Edge Function.

-- ─────────────────────────────────────────────────────────────────────────────
-- Сезоны. Параметры кривой заморожены В СТРОКЕ, а не взяты из кода: правила
-- сезона публикуются заранее и не должны меняться задним числом при деплое.
-- ─────────────────────────────────────────────────────────────────────────────
create table survival_seasons (
    id                  text primary key,
    name                text        not null,
    starts_at           timestamptz not null,
    ends_at             timestamptz not null,
    status              text        not null default 'upcoming'
                        check (status in ('upcoming','live','lock','challenge','paid','voided')),

    entry_fee_ape       numeric(18,6) not null default 1.0,
    split               jsonb         not null default '{"pool":0.425,"mega":0.075,"vault":0.10,"dev":0.40}',

    -- Кривая «гармоника»: доля(r) = (1/r^s) / SUM(1/i^s).
    curve_s             numeric      not null default 1.0,
    paid_pct_of_field   numeric      not null default 0.10,
    min_places          int          not null default 3,
    max_places          int          not null default 100,
    payout_pct          numeric      not null default 0.90,

    -- Порог жизнеспособности (§3). Ниже него сезон не платит.
    min_wallets         int           not null default 250,
    min_entry_pool_ape  numeric(18,6) not null default 1000,

    -- Сид показывается целиком, но разблокируется пропорционально живым деньгам:
    -- unlocked = min(seed, ratio × пул_от_входов). Иначе сид — приманка.
    seed_ape            numeric(18,6) not null default 0,
    seed_unlock_ratio   numeric       not null default 0.25,

    -- Снапшот на момент LOCK. NULL, пока сезон живой.
    final_pool_ape      numeric(18,6),
    final_players       int,
    final_runs          int,

    -- Сезон-витрина: играем, считаем, борд живой — но выплат нет и это сказано
    -- заранее. Открытый вопрос №1 в PRIZE_POOL.md §8; до ответа владельца
    -- Сезон 0 стоит именно так.
    pays_out            boolean      not null default false,

    created_at          timestamptz  not null default now(),
    constraint survival_seasons_dates check (ends_at > starts_at)
);
comment on column survival_seasons.pays_out is
    'false = сезон-витрина без выплат (PRIZE_POOL.md §5.4). Ставить true только по решению владельца и ДО анонса сезона.';

-- Живой сезон должен быть один: иначе survival_menu_stats тихо покажет два.
create unique index survival_seasons_one_live on survival_seasons ((status)) where status = 'live';

-- ─────────────────────────────────────────────────────────────────────────────
-- Игроки.
-- ─────────────────────────────────────────────────────────────────────────────
create table survival_players (
    wallet          text primary key check (wallet = lower(wallet) and wallet ~ '^0x[0-9a-f]{40}$'),
    display_name    text,

    -- droid_token_id и nft_verified_at — КОСМЕТИКА. Решение владельца 12.09.2026:
    -- владеть NFT для приза не нужно. Ни один запрос, считающий ранги, доли или
    -- выплаты, не имеет права на них ссылаться. Проверяется грепом при ревью.
    droid_token_id  int,
    nft_verified_at timestamptz,

    first_seen      timestamptz not null default now(),
    last_seen       timestamptz not null default now(),

    banned          boolean     not null default false,
    ban_reason      text,
    flags           jsonb       not null default '{}',

    -- Сигналы триажа сибила перед выплатой (§5). Барьер экономический, поэтому
    -- граф фандинга — единственное, что отличает десять игроков от одного.
    funding_root    text,
    first_tx_at     timestamptz,
    device_hash     text
);
create index survival_players_funding_root on survival_players (funding_root) where funding_root is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Платежи — источник правды по деньгам.
-- ─────────────────────────────────────────────────────────────────────────────
create table survival_payments (
    id              uuid primary key default gen_random_uuid(),
    tx_hash         text not null unique,          -- защита от двойного зачёта
    wallet          text not null references survival_players (wallet),
    season_id       text not null references survival_seasons (id),
    amount_ape      numeric(18,6) not null check (amount_ape > 0),
    block_number    bigint,
    confirmed_at    timestamptz,                   -- зачисляем только после подтверждений
    credits_granted int not null default 0 check (credits_granted >= 0),
    created_at      timestamptz not null default now()
);

-- Оплаченные, ещё не потраченные входы. Отвязывают платёж от забега: пачка из
-- десяти игр покупается одной транзакцией.
create table survival_credits (
    id              uuid primary key default gen_random_uuid(),
    wallet          text not null references survival_players (wallet),
    season_id       text not null references survival_seasons (id),
    payment_id      uuid references survival_payments (id),
    source          text not null default 'purchase'
                    check (source in ('purchase','arcade','grant','free_daily')),
    consumed_by_run uuid,
    created_at      timestamptz not null default now()
);
create index survival_credits_free on survival_credits (wallet, season_id) where consumed_by_run is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Забеги. score/wave/kills пишет ТОЛЬКО сервер.
-- ─────────────────────────────────────────────────────────────────────────────
create table survival_runs (
    id                uuid primary key default gen_random_uuid(),
    season_id         text not null references survival_seasons (id),
    wallet            text not null references survival_players (wallet),
    credit_id         uuid references survival_credits (id),

    status            text not null default 'started'
                      check (status in ('started','finished','rejected','void')),

    -- Серверные, не клиентские. Клиентское время — это предложение, а не факт.
    started_at        timestamptz not null default now(),
    finished_at       timestamptz,
    server_duration_ms int,

    score             int not null default 0 check (score >= 0),
    wave              int not null default 0 check (wave  >= 0),
    kills             int not null default 0 check (kills >= 0),

    hero              text,
    weapon            text,
    rng_seed          bigint,                      -- выдан сервером в /run/start
    client_version    text,                        -- отсев старых и пропатченных билдов
    input_log_url     text,                        -- Storage, для реплея

    verified          text not null default 'none' check (verified in ('none','envelope','replay')),
    reject_reason     text
);
create index survival_runs_wallet_recent on survival_runs (wallet, finished_at desc);
create index survival_runs_top     on survival_runs (season_id, score desc) where status = 'finished';
create index survival_runs_verify  on survival_runs (season_id, verified)   where status = 'finished';

alter table survival_credits
    add constraint survival_credits_run_fk foreign key (consumed_by_run) references survival_runs (id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Призовой борд: ровно один зачётный результат на кошелёк.
-- ─────────────────────────────────────────────────────────────────────────────
create table survival_season_best (
    season_id   text not null references survival_seasons (id),
    wallet      text not null references survival_players (wallet),
    run_id      uuid not null references survival_runs (id),
    score       int  not null,
    wave        int  not null default 0,
    kills       int  not null default 0,
    achieved_at timestamptz not null,              -- тай-брейк: кто первым доехал
    runs_count  int  not null default 0,
    primary key (season_id, wallet)
);
create index survival_season_best_board on survival_season_best (season_id, score desc, achieved_at asc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Журнал пула. Append-only, без исключений.
-- ─────────────────────────────────────────────────────────────────────────────
create table survival_pool_ledger (
    id         bigserial primary key,
    season_id  text not null references survival_seasons (id),
    bucket     text not null check (bucket in ('season_pool','mega_pool')),
    source     text not null check (source in ('entry','seed','sponsor','rollover','payout')),
    amount_ape numeric(18,6) not null,             -- payout отрицательный
    ref        text,                               -- run_id / tx_hash
    created_at timestamptz not null default now(),
    -- Единственная арифметическая инвариант: только payout уменьшает пул.
    constraint survival_pool_ledger_sign
        check ((source = 'payout' and amount_ape < 0) or (source <> 'payout' and amount_ape > 0))
);
create index survival_pool_ledger_bucket on survival_pool_ledger (season_id, bucket);

create function survival_pool_ledger_append_only() returns trigger
language plpgsql as $$
begin
    raise exception 'survival_pool_ledger is append-only: % refused', tg_op;
end $$;

create trigger survival_pool_ledger_no_mutation
    before update or delete on survival_pool_ledger
    for each statement execute function survival_pool_ledger_append_only();

-- ─────────────────────────────────────────────────────────────────────────────
-- Конверт правдоподобия — по версии билда, потому что баланс меняется.
-- Билд без строк здесь к зачётным забегам не допускается.
-- ─────────────────────────────────────────────────────────────────────────────
create table survival_envelope_bounds (
    client_version text not null,
    metric         text not null check (metric in ('score_max','kills_max','wave_tolerance','min_duration_ms')),
    max_expr       text not null,
    calibrated_at  timestamptz not null default now(),
    notes          text,
    primary key (client_version, metric)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Выплаты.
-- ─────────────────────────────────────────────────────────────────────────────
create table survival_payouts (
    id         uuid primary key default gen_random_uuid(),
    season_id  text not null references survival_seasons (id),
    wallet     text not null references survival_players (wallet),
    rank       int  not null check (rank > 0),
    share_pct  numeric(10,8) not null,
    amount_ape numeric(18,6) not null,
    tx_hash    text,
    status     text not null default 'pending' check (status in ('pending','sent','confirmed','failed')),
    created_at timestamptz not null default now(),
    unique (season_id, wallet),
    unique (season_id, rank)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- season_best поддерживается триггером: клиент к нему не ходит, а Edge Function
-- не должна помнить правило тай-брейка в двух местах.
-- ─────────────────────────────────────────────────────────────────────────────
create function survival_apply_run_to_best() returns trigger
language plpgsql as $$
begin
    if new.status <> 'finished' then return new; end if;
    if tg_op = 'UPDATE' and old.status = 'finished' then return new; end if;

    insert into survival_season_best as b
        (season_id, wallet, run_id, score, wave, kills, achieved_at, runs_count)
    values
        (new.season_id, new.wallet, new.id, new.score, new.wave, new.kills,
         coalesce(new.finished_at, now()), 1)
    on conflict (season_id, wallet) do update set
        -- Строго больше: при равенстве побеждает тот результат, что доехал раньше.
        run_id      = case when excluded.score > b.score then excluded.run_id      else b.run_id      end,
        score       = greatest(b.score, excluded.score),
        wave        = case when excluded.score > b.score then excluded.wave        else b.wave        end,
        kills       = case when excluded.score > b.score then excluded.kills       else b.kills       end,
        achieved_at = case when excluded.score > b.score then excluded.achieved_at else b.achieved_at end,
        runs_count  = b.runs_count + 1;

    return new;
end $$;

create trigger survival_runs_to_best
    after insert or update of status on survival_runs
    for each row execute function survival_apply_run_to_best();

-- ─────────────────────────────────────────────────────────────────────────────
-- Витрина для главной: один запрос — все числа блока.
--
-- View, а не materialized: pg_cron в проекте не стоит, а матвью без расписания
-- показывает вчерашний пул, что хуже лишнего SUM по журналу на десяток тысяч
-- строк. Появится pg_cron — заменить на матвью с refresh 10 с.
--
-- security_invoker НЕ включён намеренно: вью агрегирует survival_pool_ledger,
-- который анону закрыт, и отдаёт наружу только итоговые числа.
-- ─────────────────────────────────────────────────────────────────────────────
create view survival_menu_stats as
select
    s.id            as season_id,
    s.name          as season_name,
    s.starts_at,
    s.ends_at,
    s.entry_fee_ape,
    s.pays_out,
    s.seed_ape,
    s.seed_unlock_ratio,
    s.min_wallets,
    s.min_entry_pool_ape,

    coalesce((select sum(amount_ape) from survival_pool_ledger
               where season_id = s.id and bucket = 'season_pool'), 0)            as pool_ape,
    coalesce((select sum(amount_ape) from survival_pool_ledger
               where season_id = s.id and bucket = 'season_pool'
                 and source = 'entry'), 0)                                        as entry_pool_ape,
    coalesce((select sum(amount_ape) from survival_pool_ledger
               where bucket = 'mega_pool'), 0)                                    as mega_pool_ape,

    (select count(*) from survival_runs
      where season_id = s.id and status = 'finished')                             as total_runs,
    (select count(*) from survival_season_best where season_id = s.id)            as total_players,

    -- Платящих мест: clamp(ceil(N × pct), min, max). Считаем здесь, чтобы блок
    -- на главной и выплатный код брали одно число из одного места.
    greatest(s.min_places,
      least(s.max_places,
        ceil((select count(*) from survival_season_best where season_id = s.id)
             * s.paid_pct_of_field)::int))                                        as paying_places
from survival_seasons s
where s.status in ('live','lock','challenge');

-- Публичный борд. Кошелёк режется до 0x1234…abcd — полный адрес в открытой
-- таблице лидеров это подарок фишерам.
create view survival_board as
select
    b.season_id,
    rank() over (partition by b.season_id order by b.score desc, b.achieved_at asc) as rank,
    left(b.wallet, 6) || '…' || right(b.wallet, 4)  as wallet_short,
    p.display_name,
    p.droid_token_id,
    b.score, b.wave, b.kills, b.runs_count, b.achieved_at
from survival_season_best b
join survival_players p using (wallet)
where not p.banned;

-- ─────────────────────────────────────────────────────────────────────────────
-- Бета-доступ. Игра на сайте закрыта: сначала подключи кошелёк, потом кошелёк
-- должен быть в этом списке.
--
-- Таблица закрыта наглухо и наружу не отдаётся ни строкой. Список ранних
-- тестеров — это список людей, а публичная таблица «кто в бете» мгновенно
-- превращается в цель для фишинга и в повод для обид. Наружу торчит только
-- функция survival_has_access(wallet): спросить можно про КОНКРЕТНЫЙ адрес и
-- получить да/нет, перебрать список — нельзя.
-- ─────────────────────────────────────────────────────────────────────────────
create table survival_allowlist (
    wallet     text primary key check (wallet = lower(wallet) and wallet ~ '^0x[0-9a-f]{40}$'),
    note       text,                                -- кто это и откуда пришёл
    added_by   text,
    added_at   timestamptz not null default now(),
    revoked_at timestamptz                          -- доступ снимаем отзывом, а не удалением строки
);
create index survival_allowlist_active on survival_allowlist (wallet) where revoked_at is null;

create function survival_has_access(p_wallet text) returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from survival_allowlist
         where wallet = lower(trim(p_wallet)) and revoked_at is null
    );
$$;
comment on function survival_has_access is
    'Бета-гейт: да/нет по одному адресу. Единственная дверь к survival_allowlist снаружи.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: закрыто всё, наружу — четыре витрины.
-- ─────────────────────────────────────────────────────────────────────────────
alter table survival_seasons         enable row level security;
alter table survival_players         enable row level security;
alter table survival_payments        enable row level security;
alter table survival_credits         enable row level security;
alter table survival_runs            enable row level security;
alter table survival_season_best     enable row level security;
alter table survival_pool_ledger     enable row level security;
alter table survival_envelope_bounds enable row level security;
alter table survival_payouts         enable row level security;
alter table survival_allowlist       enable row level security;

create policy survival_seasons_read     on survival_seasons     for select to anon, authenticated using (true);
create policy survival_season_best_read on survival_season_best for select to anon, authenticated using (true);
create policy survival_payouts_read     on survival_payouts     for select to anon, authenticated using (true);

-- Ни одной политики на payments, credits, pool_ledger, players, runs,
-- envelope_bounds: RLS без политики = отказ всем, кроме service-role.
-- survival_runs.score недостижим клиенту по построению.

grant select on survival_menu_stats, survival_board to anon, authenticated;
grant execute on function survival_has_access(text) to anon, authenticated;

-- Пояс поверх подтяжек: Supabase по умолчанию раздаёт anon права на новые
-- таблицы public, и держит их только RLS. Забытая когда-нибудь политика не
-- должна открывать запись в деньги, поэтому право отбираем явно.
revoke insert, update, delete on
    survival_seasons, survival_players, survival_payments, survival_credits,
    survival_runs, survival_season_best, survival_pool_ledger,
    survival_envelope_bounds, survival_payouts, survival_allowlist
    from anon, authenticated;
revoke select on
    survival_payments, survival_credits, survival_pool_ledger,
    survival_players, survival_runs, survival_envelope_bounds, survival_allowlist
    from anon, authenticated;
