-- Бета-доступ на срок (владелец, 19.09.2026): в панели рядом с кошельком
-- выбирается, на сколько он получает доступ — от часа до «навсегда». Когда
-- срок вышел, гейт закрывается сам, кошелёк в списке серый, и чтобы пустить
-- снова — его активируют заново с новым сроком.
--
-- Аддитивно: одна колонка (null = навсегда, как было у всех до этого) и
-- та же функция survival_has_access с учётом срока.

alter table survival_allowlist add column if not exists expires_at timestamptz;
comment on column survival_allowlist.expires_at is
    'Когда доступ истекает; null — бессрочно. Истёкший кошелёк остаётся в списке (серым), активируется заново.';

create or replace function survival_has_access(p_wallet text) returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from survival_allowlist
         where wallet = lower(trim(p_wallet))
           and revoked_at is null
           and (expires_at is null or expires_at > now())
    );
$$;
