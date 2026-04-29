-- ── Season 2 reset (conservative) ────────────────────────────────────────────
-- Wipes ONLY:
--   • Season 2 leaderboard
--   • All Flight game data (sessions, bets, balances, deposits/withdrawals)
--   • Cards play history from 2026-04-09 onward (S2-era only).
--     Cards rows before that cutoff are pre-Flight (= pre-S2) and stay.
--
-- Everything else is left as-is per operator instruction:
--   • glitch_season_1            — kept (historical leaderboard)
--   • glitch_users / users       — kept (accounts + balances + x_handle)
--   • nft_inventory              — kept (prize records, on-chain truth)
--   • droidz / batteries         — kept (NFT state mirror)
--   • prize_types                — kept (config)
--   • daily_task_config          — kept (X-quest config)
--   • vault_limits               — kept (config)
--   • health_alert_dismissals    — kept (admin UX state)
--   • merge_logs                 — kept (battery merge history)
--   • ticket_purchases           — kept (real APE-spent receipts)
--   • daily_claims_log           — kept (X-task claim records)
--   • daily_activity_claims      — kept (activity quest progress)
--   • weekly_streak_claims       — kept; the May-4 UI gate handles freshness
--   • referrals                  — kept
--
-- Single transaction: if any TRUNCATE trips an unexpected FK or perm, the
-- whole thing rolls back and nothing is lost.
--
-- WARNING: irreversible for the listed tables. Snapshot Supabase first.

BEGIN;

-- Flight tables and the season-2 leaderboard are entirely S2 by definition,
-- so a full TRUNCATE is correct here.
TRUNCATE TABLE
    glitch_season_2,
    flight_game_logs,
    flight_sessions,
    flight_balances,
    flight_transactions
RESTART IDENTITY CASCADE;

-- Cards game_logs spans S1 → between-seasons → S2. The Flight feature
-- landed 2026-04-09 (commit 1599687); any Cards play recorded from that
-- date onward is S2-era and goes. Earlier rows are kept verbatim.
DELETE FROM game_logs
 WHERE created_at >= '2026-04-09 00:00:00+00';

-- Sanity probes — should all return 0 for fully truncated tables, and 0 for
-- game_logs rows newer than the cutoff. If any check trips the assert
-- raises and the transaction rolls back; nothing stays half-applied.
DO $$
DECLARE
    n bigint;
BEGIN
    SELECT COUNT(*) INTO n FROM glitch_season_2;        ASSERT n = 0, 'glitch_season_2 not empty';
    SELECT COUNT(*) INTO n FROM flight_game_logs;       ASSERT n = 0, 'flight_game_logs not empty';
    SELECT COUNT(*) INTO n FROM flight_sessions;        ASSERT n = 0, 'flight_sessions not empty';
    SELECT COUNT(*) INTO n FROM flight_balances;        ASSERT n = 0, 'flight_balances not empty';
    SELECT COUNT(*) INTO n FROM flight_transactions;    ASSERT n = 0, 'flight_transactions not empty';
    SELECT COUNT(*) INTO n FROM game_logs WHERE created_at >= '2026-04-09 00:00:00+00';
    ASSERT n = 0, 'game_logs still has S2-era rows after cutoff';
END $$;

COMMIT;
