-- ── Season 2 play-counter fix ────────────────────────────────────────────────
-- The legacy increment_season2_xp(p_wallet, p_xp) RPC only bumped season_xp
-- and never knew if a call was from Cards or Flight, so:
--   • glitch_season_2.flights_played stayed at 0 forever
--   • glitch_season_2.games_played was either stale or out-of-sync
--
-- Fix:
--   1. Add increment_season2_play(p_wallet, p_xp, p_game_type) that bumps
--      season_xp AND the right counter atomically.
--   2. Keep increment_season2_xp around for callers that just grant XP
--      (quests, streak claims) without any play counter side-effect.
--   3. Backfill games_played / flights_played from the source-of-truth logs.

-- ── 1. New RPC ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_season2_play(
    p_wallet text,
    p_xp integer,
    p_game_type text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_wallet text := LOWER(p_wallet);
BEGIN
    IF p_game_type NOT IN ('cards', 'flight') THEN
        RAISE EXCEPTION 'invalid p_game_type: %', p_game_type;
    END IF;

    -- Use INSERT ON CONFLICT so the row is created on first play and the
    -- right counter is bumped on every subsequent play in one statement.
    INSERT INTO glitch_season_2 (wallet_address, season_xp, games_played, flights_played, updated_at)
    VALUES (
        v_wallet,
        GREATEST(p_xp, 0),
        CASE WHEN p_game_type = 'cards'  THEN 1 ELSE 0 END,
        CASE WHEN p_game_type = 'flight' THEN 1 ELSE 0 END,
        now()
    )
    ON CONFLICT (wallet_address) DO UPDATE SET
        season_xp      = glitch_season_2.season_xp      + EXCLUDED.season_xp,
        games_played   = glitch_season_2.games_played   + EXCLUDED.games_played,
        flights_played = glitch_season_2.flights_played + EXCLUDED.flights_played,
        updated_at     = now();
END;
$$;

REVOKE ALL ON FUNCTION increment_season2_play(text, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION increment_season2_play(text, integer, text) TO service_role;

-- ── 2. Backfill counters from raw logs ───────────────────────────────────────
-- For every wallet that has any play history, recompute games_played and
-- flights_played from game_logs / flight_game_logs respectively. Wallets in
-- glitch_season_2 that have zero plays in either log are left alone.
DO $$
DECLARE
    r record;
    v_cards   bigint;
    v_flights bigint;
BEGIN
    FOR r IN SELECT wallet_address FROM glitch_season_2 LOOP
        SELECT COUNT(*) INTO v_cards
        FROM game_logs
        WHERE LOWER(wallet_address) = LOWER(r.wallet_address)
          AND status = 'success';

        SELECT COUNT(*) INTO v_flights
        FROM flight_game_logs
        WHERE LOWER(wallet_address) = LOWER(r.wallet_address);

        UPDATE glitch_season_2
        SET games_played   = v_cards,
            flights_played = v_flights,
            updated_at     = now()
        WHERE wallet_address = r.wallet_address;
    END LOOP;
END $$;

-- ── 3. Sanity check ──────────────────────────────────────────────────────────
DO $$
DECLARE
    n_zero_flights bigint;
BEGIN
    -- After backfill, anyone in flight_game_logs MUST have a non-zero
    -- flights_played in glitch_season_2.
    SELECT COUNT(DISTINCT LOWER(f.wallet_address))
    INTO n_zero_flights
    FROM flight_game_logs f
    JOIN glitch_season_2 s
      ON LOWER(s.wallet_address) = LOWER(f.wallet_address)
    WHERE s.flights_played = 0;

    IF n_zero_flights > 0 THEN
        RAISE WARNING '% wallets still show flights_played=0 despite having flight logs — check ilike vs eq mismatches', n_zero_flights;
    END IF;
END $$;
