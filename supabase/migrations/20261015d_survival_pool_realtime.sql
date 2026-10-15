-- The pool shows a new payment everywhere at once (owner, 15.10.2026: «как только в пул попадает новая
-- деньга он должен везде обновляться сразу же»). Until now every screen polled /api/survival/pool once a
-- minute through a 30 s edge cache, so a top-up took one to three minutes to show.
--
-- Every row booked into the ledger of the LIVE season broadcasts the season's fresh numbers on the
-- public Realtime channel `survival-pool` (event `pool`): the game and the site listen and redraw from
-- the message itself, with no request back. Public on purpose: only the totals the pool route already
-- shows to anyone, never a ledger row (no ref, no wallet).
--
-- The broadcast can never fail a booking: any error inside is swallowed, the payment stays booked and
-- the screens catch up on their next poll.
create or replace function public.survival_pool_ledger_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    s record;
    st record;
begin
    begin
        select id, payout_pct into s from survival_seasons where id = new.season_id and status = 'live';
        if not found then return null; end if;
        select * into st from survival_pool_stats(s.id);
        perform realtime.send(
            jsonb_build_object(
                'seasonId', s.id,
                'soloApe', st.solo_ape, 'coopApe', st.coop_ape,
                'players', st.players, 'games', st.games, 'soloGames', st.solo_games, 'coopGames', st.coop_games,
                'payoutPct', coalesce(s.payout_pct, 0.9)),
            'pool', 'survival-pool', false);
    exception when others then
        raise warning '[survival_pool_ledger_broadcast] %', sqlerrm;
    end;
    return null;
end $$;
revoke all on function public.survival_pool_ledger_broadcast() from public, anon, authenticated;

drop trigger if exists survival_pool_ledger_broadcast on survival_pool_ledger;
create trigger survival_pool_ledger_broadcast after insert on survival_pool_ledger
    for each row execute function public.survival_pool_ledger_broadcast();
