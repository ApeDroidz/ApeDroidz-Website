-- Droidz Survival, 29.09.2026 — the economy's two rows written as ONE.
--
-- The server's economy lives in two rows: the save (survival_profiles — coins, items, heroes) and
-- the season row (survival_profile_seasons — daily streak, quests, claimed tiers, season XP).
-- lib/survivalEconomyStore.ts wrote them one after the other: the save by compare-and-set on its
-- updated_at, then the season row by a plain upsert. Two holes:
--   (a) a racing request that re-read between the two writes saw the NEW save and the OLD season
--       row — the claim marks not there yet — and paid claim_daily / claim_tier / claim_quest again;
--   (b) a season write that failed left the coins written and the claim unmarked: claim again.
-- Now both rows go in one transaction, each by compare-and-set on the updated_at it was read with;
-- either conflict writes nothing and answers 'conflict' (withEcon re-reads and tries again).
--
-- The site calls this and falls back to the two writes while it is not applied (saveEcon), so
-- this can go in at any time. APPLY ONLY WITH THE OWNER'S WORD.

create or replace function public.survival_econ_write(
    p_wallet text,
    p_prof_updated_at timestamptz,   -- null: the save row does not exist yet
    p_profile jsonb,                 -- { state, coins, runs, best_score, selected_hero, save_version }
    p_season_id text,                -- null: no live season, only the save is written
    p_season_updated_at timestamptz, -- null: the season row does not exist yet
    p_season jsonb,
    p_daily jsonb,
    p_sxp int,
    p_tier int,
    p_now timestamptz
)
 returns text
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
    n int;
begin
    insert into survival_players (wallet, last_seen) values (p_wallet, p_now)
        on conflict (wallet) do update set last_seen = excluded.last_seen;

    begin
        if p_prof_updated_at is not null then
            update survival_profiles set
                state = p_profile->'state',
                coins = (p_profile->>'coins')::int,
                runs = (p_profile->>'runs')::int,
                best_score = (p_profile->>'best_score')::int,
                selected_hero = p_profile->>'selected_hero',
                save_version = coalesce((p_profile->>'save_version')::int, 1),
                updated_at = p_now
            where wallet = p_wallet and updated_at = p_prof_updated_at;
            get diagnostics n = row_count;
            if n = 0 then return 'conflict'; end if;
        else
            insert into survival_profiles (wallet, state, coins, runs, best_score, selected_hero, save_version, updated_at)
            values (p_wallet, p_profile->'state', (p_profile->>'coins')::int, (p_profile->>'runs')::int,
                    (p_profile->>'best_score')::int, p_profile->>'selected_hero',
                    coalesce((p_profile->>'save_version')::int, 1), p_now);
        end if;

        if p_season_id is not null then
            if p_season_updated_at is not null then
                update survival_profile_seasons set season = p_season, daily = p_daily, sxp = p_sxp, tier = p_tier, updated_at = p_now
                where wallet = p_wallet and season_id = p_season_id and updated_at = p_season_updated_at;
                get diagnostics n = row_count;
            else
                insert into survival_profile_seasons (wallet, season_id, season, daily, sxp, tier, updated_at)
                values (p_wallet, p_season_id, p_season, p_daily, p_sxp, p_tier, p_now)
                on conflict (wallet, season_id) do nothing;
                get diagnostics n = row_count;
            end if;
            -- The save row is already written in this block: raising undoes it with the season's.
            if n = 0 then raise exception 'survival_econ_conflict'; end if;
        end if;
    exception
        when unique_violation then return 'conflict';
        when raise_exception then
            if sqlerrm = 'survival_econ_conflict' then return 'conflict'; end if;
            raise;
    end;
    return 'ok';
end
$function$;

revoke execute on function public.survival_econ_write(text, timestamptz, jsonb, text, timestamptz, jsonb, jsonb, int, int, timestamptz) from public, anon, authenticated;
grant execute on function public.survival_econ_write(text, timestamptz, jsonb, text, timestamptz, jsonb, jsonb, int, int, timestamptz) to service_role;
