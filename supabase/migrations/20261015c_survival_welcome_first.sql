-- The welcome gift is played first (15.10.2026): a run spends a free welcome credit before a bought
-- one, so «N FREE RUNS» in the game is never shown while paid runs are what is being spent.
create or replace function public.survival_consume_credit(p_wallet text, p_run uuid, p_mode text) returns uuid
language sql as $$
    update survival_credits set consumed_by_run = p_run
    where id = (
        select id from survival_credits
        where wallet = p_wallet and mode = p_mode and consumed_by_run is null
        order by (source = 'welcome') desc, created_at
        limit 1
        for update skip locked
    )
    returning id;
$$;
revoke all on function public.survival_consume_credit(text, uuid, text) from public, anon, authenticated;
