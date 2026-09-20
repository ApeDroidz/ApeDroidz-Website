-- Droidz Survival — отзыв о закрытой бете за Ape Mini (20.09.2026).
--
-- Решения владельца этого дня, закреплённые здесь кодом, а не договорённостью:
--   • форму видит только тот, кто отыграл 3+ засчитанных забега — мнение после трёх
--     смертей стоит дороже, чем первое впечатление, а за один забег никто не успевает
--     увидеть ни Лабораторию, ни героев;
--   • звёзды дают 200 Ape Mini, комментарий от 50 символов — ещё 800 сверху, максимум 1000;
--   • отзыв один на кошелёк, править можно бесплатно: дописал мысль — доплачиваем
--     недостающее до максимума, стёр комментарий — уже выданное не забираем.
--
-- Почему начисление живёт в RPC, а не в роуте. Ape Mini принадлежат клиенту:
-- systems/CloudSave.ts на буте заменяет локальную копию серверной, а дальше каждые 2 с
-- пушит свою. Значит «выдать монеты» — это не UPDATE, а согласованная пара: сервер
-- прибавляет столько же, сколько клиент прибавил себе через Save.addCoins(), и обе
-- стороны сходятся в одном числе независимо от того, чей пуш придёт последним.
-- Двойного начисления не будет при любом числе повторов: выдаётся РАЗНИЦА между
-- заработанным и уже выданным, и считается она внутри одной транзакции.

create table if not exists survival_feedback (
    wallet          text primary key references survival_players (wallet),
    rating          int         not null check (rating between 1 and 5),
    comment         text        check (comment is null or length(comment) <= 2000),
    -- Сколько забегов было за плечами в момент ПЕРВОЙ отправки: отзыв после трёх
    -- забегов и после тридцати — разные по весу, и панель должна их различать.
    runs_at_submit  int         not null default 0,
    coins_awarded   int         not null default 0 check (coins_awarded >= 0),
    client_version  text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    edited_count    int         not null default 0
);
create index if not exists survival_feedback_recent on survival_feedback (updated_at desc);
create index if not exists survival_feedback_rating on survival_feedback (rating);

comment on table survival_feedback is
    'Отзывы о закрытой бете. Одна строка на кошелёк; coins_awarded — сколько Ape Mini уже выдано, потолок 1000.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Приём отзыва и начисление — одной транзакцией.
--
-- Возвращает jsonb:
--   { ok: true,  awarded, total_awarded, rating, comment, mirrored }
--   { ok: false, error: 'not_eligible' | 'bad_rating', runs }
--
-- `awarded` — сколько клиенту прибавить у себя. Ровно это число и только оно;
-- на повторной отправке того же отзыва там будет 0.
-- `mirrored` = false означает, что профиля на сервере ещё нет и монеты держит
-- только клиент — это нормально и не ошибка (см. ниже, почему строку не создаём).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function survival_submit_feedback(
    p_wallet         text,
    p_rating         int,
    p_comment        text default null,
    p_client_version text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    -- Тариф живёт здесь же, где начисление: ставка и выдача не должны разъезжаться
    -- между кодом сайта, кодом игры и базой.
    c_rating_award  constant int := 200;
    c_comment_award constant int := 800;
    c_comment_min   constant int := 50;
    c_min_runs      constant int := 3;

    v_wallet  text := lower(trim(p_wallet));
    v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
    v_runs    int;
    v_earned  int;
    v_already int;
    v_delta   int;
    v_new     int;
    v_first   boolean;
    v_mirror  boolean := false;
begin
    if p_rating is null or p_rating < 1 or p_rating > 5 then
        return jsonb_build_object('ok', false, 'error', 'bad_rating');
    end if;

    -- Засчитанные забеги, а не lifetime.runs из клиентского сейва: клиентское число
    -- правится в консоли за секунду, а этим числом открывается дверь к монетам.
    select count(*) into v_runs
      from survival_runs
     where wallet = v_wallet and status = 'finished';

    -- Блокируем строку отзыва на время расчёта: два параллельных POST (двойной клик,
    -- ретрай сети) иначе оба увидят coins_awarded = 0 и оба выдадут по 1000.
    select coins_awarded into v_already
      from survival_feedback where wallet = v_wallet for update;
    v_first := v_already is null;

    -- Порог проверяем только у тех, кто ещё не отправлял: однажды заслуженное право
    -- дописать мысль не должно зависеть от того, что забеги пересчитали.
    if v_first and v_runs < c_min_runs then
        return jsonb_build_object('ok', false, 'error', 'not_eligible', 'runs', v_runs);
    end if;

    v_comment := left(v_comment, 2000);
    v_earned  := c_rating_award
               + case when v_comment is not null and length(v_comment) >= c_comment_min
                      then c_comment_award else 0 end;

    if v_first then
        insert into survival_feedback (wallet, rating, comment, runs_at_submit, coins_awarded, client_version)
        values (v_wallet, p_rating, v_comment, v_runs, v_earned, p_client_version);
        v_delta := v_earned;
        v_new   := v_earned;
    else
        -- greatest, а не присваивание: убрать комментарий и потерять 800 — не наказание,
        -- которое кто-то заказывал. Выданное остаётся выданным.
        v_delta := greatest(0, v_earned - v_already);
        v_new   := greatest(v_already, v_earned);
        update survival_feedback
           set rating         = p_rating,
               comment        = v_comment,
               coins_awarded  = v_new,
               client_version = coalesce(p_client_version, client_version),
               edited_count   = edited_count + 1,
               updated_at     = now()
         where wallet = v_wallet;
    end if;

    -- Зеркалим выдачу в серверный профиль — и в колонку, и внутрь state, потому что на
    -- буте игра читает именно state.coins, а колонка живёт для панели.
    --
    -- Строку НЕ создаём, если её нет. Профиль на буте побеждает локальный сейв целиком:
    -- строка вида {"coins": 1000} заменила бы игроку героев, оружие и Лабораторию на
    -- дефолты. У кошелька без профиля монеты держит клиент, и его же пуш их и сохранит.
    if v_delta > 0 then
        update survival_profiles
           set coins      = coins + v_delta,
               state      = jsonb_set(state, '{coins}',
                                to_jsonb(coalesce(nullif(state->>'coins','')::int, 0) + v_delta), true),
               updated_at = now()
         where wallet = v_wallet;
        v_mirror := found;
    end if;

    return jsonb_build_object(
        'ok', true, 'awarded', v_delta, 'total_awarded', v_new,
        'rating', p_rating, 'comment', v_comment, 'runs', v_runs, 'mirrored', v_mirror
    );
end $$;

comment on function survival_submit_feedback is
    'Принимает отзыв и выдаёт разницу между заработанным и уже выданным. Идемпотентна: повтор даёт awarded = 0.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: как и у всей survival_* — закрыто наглухо, ходит только service-role.
-- Отзывы это персональные тексты бета-тестеров; публичной витрины у них нет.
-- ─────────────────────────────────────────────────────────────────────────────
alter table survival_feedback enable row level security;

revoke insert, update, delete, select on survival_feedback from anon, authenticated;
revoke execute on function survival_submit_feedback(text, int, text, text) from anon, authenticated;
