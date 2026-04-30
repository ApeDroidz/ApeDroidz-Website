-- ── Season 2 counter re-backfill (v2) ───────────────────────────────────────
-- The previous migration backfilled glitch_season_2.games_played and
-- flights_played from ALL game_logs / flight_game_logs, which over-counted
-- pre-S2 test plays. games_played for the operator wallet ended up at 141
-- (their lifetime Cards plays) instead of 0 (their actual S2 Cards plays).
--
-- This migration rewinds and re-backfills using the S2 cutoff
-- (2026-04-09 — when Glitch Flight first landed). The new increment_season2_play
-- RPC already counts correctly going forward, so a one-shot rewrite is enough.

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
          AND status = 'success'
          AND created_at >= '2026-04-09T00:00:00.000Z';

        SELECT COUNT(*) INTO v_flights
        FROM flight_game_logs
        WHERE LOWER(wallet_address) = LOWER(r.wallet_address)
          AND created_at >= '2026-04-09T00:00:00.000Z';

        UPDATE glitch_season_2
        SET games_played   = v_cards,
            flights_played = v_flights,
            updated_at     = now()
        WHERE wallet_address = r.wallet_address;
    END LOOP;
END $$;
