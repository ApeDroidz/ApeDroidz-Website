-- ── Daily X-task claims, Season 2 isolated ──────────────────────────────────
-- The legacy `daily_claims_log` accumulated 600+ rows of pre-S2 X-task
-- claims that bled into the S2 leaderboard "quests_finished" tally even
-- with date filters. To keep S2 leaderboards clean (and to make future
-- season splits trivial) we move the new claims into a dedicated
-- `daily_claims_log_s2` table.
--
-- Schema is copy-from-source (same columns, indexes, constraints) so
-- existing route logic works after the table-name swap.
--
-- Rollout:
--   1. apply this migration
--   2. deploy the API routes that point writes/reads at *_s2
--   3. legacy `daily_claims_log` is left untouched as a historical record

CREATE TABLE IF NOT EXISTS daily_claims_log_s2 (LIKE daily_claims_log INCLUDING ALL);

-- Permissions mirror the legacy table — service_role only.
REVOKE ALL ON TABLE daily_claims_log_s2 FROM public;
GRANT  ALL ON TABLE daily_claims_log_s2 TO service_role;
