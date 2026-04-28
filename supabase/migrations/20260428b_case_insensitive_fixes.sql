-- ════════════════════════════════════════════════════════════════════
-- Case-insensitive wallet handling fixes (2026-04-28b)
--
-- BUG that this fixes:
--   The 2026-04-27 migration created `add_glitch_user_tickets` and
--   `set_glitch_user_x_handle` using:
--       INSERT … VALUES (lower(p_wallet), …) ON CONFLICT (wallet_address) …
--   The UNIQUE constraint on `wallet_address` is case-sensitive in Postgres,
--   so when an old row exists with checksummed/mixed case (e.g. `0xAbC…`),
--   a new lowercase INSERT does NOT trigger ON CONFLICT — Postgres creates
--   a SECOND row for the same logical wallet. That breaks the leaderboard,
--   tickets balance, profile and admin drill-down.
--
-- FIX:
--   Rewrite both functions to find the existing row case-insensitively
--   first, update it in place (preserving its original case), and only
--   INSERT a fresh lowercase row when nothing matches. Wrapped in an
--   EXCEPTION clause to handle the rare concurrent-insert race.
--
--   Also patches `admin_wallet_summary` to SUM duplicate rows when they
--   exist (so admin drill-down shows the true total).
--
-- All functions are idempotent (CREATE OR REPLACE) — safe to re-run.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. add_glitch_user_tickets — case-insensitive UPSERT ─────────────────
CREATE OR REPLACE FUNCTION add_glitch_user_tickets(p_wallet text, p_amount int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    existing_wallet text;
    new_balance int;
BEGIN
    IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-fA-F]{40}$' THEN
        RAISE EXCEPTION 'Invalid wallet';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
        RAISE EXCEPTION 'Invalid amount';
    END IF;

    -- Find an existing row regardless of stored case.
    SELECT wallet_address INTO existing_wallet
    FROM glitch_users
    WHERE lower(wallet_address) = lower(p_wallet)
    ORDER BY wallet_address  -- deterministic if dups exist
    LIMIT 1;

    IF existing_wallet IS NOT NULL THEN
        -- Update the existing row in its ORIGINAL case → no new row, no dup.
        -- Note: if duplicates already exist from previous bad inserts, this
        -- only updates the first one. Run dedup_glitch_users() (below) first.
        UPDATE glitch_users
        SET games_balance = games_balance + p_amount
        WHERE wallet_address = existing_wallet
        RETURNING games_balance INTO new_balance;
    ELSE
        -- New user → insert lowercase. Catch the rare race where a
        -- concurrent call inserted between SELECT and INSERT.
        BEGIN
            INSERT INTO glitch_users (wallet_address, games_balance)
            VALUES (lower(p_wallet), p_amount)
            RETURNING games_balance INTO new_balance;
        EXCEPTION WHEN unique_violation THEN
            UPDATE glitch_users
            SET games_balance = games_balance + p_amount
            WHERE lower(wallet_address) = lower(p_wallet)
            RETURNING games_balance INTO new_balance;
        END;
    END IF;

    RETURN new_balance;
END;
$$;
REVOKE ALL ON FUNCTION add_glitch_user_tickets(text, int) FROM public;
GRANT EXECUTE ON FUNCTION add_glitch_user_tickets(text, int) TO service_role;


-- ── 2. set_glitch_user_x_handle — case-insensitive ───────────────────────
CREATE OR REPLACE FUNCTION set_glitch_user_x_handle(p_wallet text, p_handle text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    existing_wallet text;
BEGIN
    IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-fA-F]{40}$' THEN
        RAISE EXCEPTION 'Invalid wallet';
    END IF;
    IF p_handle IS NULL OR length(p_handle) = 0 OR length(p_handle) > 64 THEN
        RAISE EXCEPTION 'Invalid handle';
    END IF;

    SELECT wallet_address INTO existing_wallet
    FROM glitch_users
    WHERE lower(wallet_address) = lower(p_wallet)
    ORDER BY wallet_address
    LIMIT 1;

    IF existing_wallet IS NOT NULL THEN
        UPDATE glitch_users
        SET x_handle = COALESCE(x_handle, p_handle)   -- only fill if currently null
        WHERE wallet_address = existing_wallet;
    ELSE
        BEGIN
            INSERT INTO glitch_users (wallet_address, x_handle)
            VALUES (lower(p_wallet), p_handle);
        EXCEPTION WHEN unique_violation THEN
            UPDATE glitch_users
            SET x_handle = COALESCE(x_handle, p_handle)
            WHERE lower(wallet_address) = lower(p_wallet);
        END;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION set_glitch_user_x_handle(text, text) FROM public;
GRANT EXECUTE ON FUNCTION set_glitch_user_x_handle(text, text) TO service_role;


-- ── 3. admin_wallet_summary — SUM duplicate rows so drill-down is accurate ─
--    If there are duplicate rows for the same logical wallet (mixed-case
--    legacy + lowercase new), `(SELECT col FROM table WHERE … LIMIT 1)`
--    only returns one of them. SUM over the whole match set gives the
--    real total. For text fields (x_handle), pick MAX (deterministic).
CREATE OR REPLACE FUNCTION admin_wallet_summary(p_wallet text)
RETURNS TABLE(
    wallet_address text,
    games_balance int,
    flight_balance numeric,
    cards_plays bigint,
    cards_nfts_won bigint,
    cards_ape_spent numeric,
    flight_bets bigint,
    flight_total_profit numeric,
    flight_deposits numeric,
    flight_withdrawals numeric,
    season2_xp int,
    nft_xp int,
    droids_count int,
    x_handle text,
    first_seen timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        lower(p_wallet)::text,
        COALESCE((SELECT SUM(games_balance) FROM glitch_users WHERE lower(wallet_address) = lower(p_wallet)), 0)::int,
        COALESCE((SELECT SUM(balance) FROM flight_balances WHERE lower(wallet_address) = lower(p_wallet)), 0)::numeric,
        (SELECT COUNT(*) FROM game_logs WHERE lower(wallet_address) = lower(p_wallet) AND status = 'success'),
        (SELECT COUNT(*) FROM nft_inventory WHERE lower(winner_wallet) = lower(p_wallet) AND status = 'claimed'),
        COALESCE((SELECT SUM(ape_amount) FROM ticket_purchases WHERE lower(wallet_address) = lower(p_wallet)), 0)::numeric,
        (SELECT COUNT(*) FROM flight_game_logs WHERE lower(wallet_address) = lower(p_wallet)),
        COALESCE((SELECT SUM(profit) FROM flight_game_logs WHERE lower(wallet_address) = lower(p_wallet)), 0)::numeric,
        COALESCE((SELECT SUM(amount) FROM flight_transactions WHERE lower(wallet_address) = lower(p_wallet) AND type='deposit' AND status='confirmed'), 0)::numeric,
        COALESCE((SELECT SUM(amount) FROM flight_transactions WHERE lower(wallet_address) = lower(p_wallet) AND type='withdrawal' AND status='confirmed'), 0)::numeric,
        COALESCE((SELECT SUM(season_xp) FROM glitch_season_2 WHERE lower(wallet_address) = lower(p_wallet)), 0)::int,
        COALESCE((SELECT SUM(xp) FROM users WHERE lower(wallet_address) = lower(p_wallet)), 0)::int,
        COALESCE((SELECT MAX(droids_count) FROM users WHERE lower(wallet_address) = lower(p_wallet)), 0)::int,
        (SELECT MAX(x_handle) FROM glitch_users WHERE lower(wallet_address) = lower(p_wallet)),
        (SELECT MIN(ts) FROM (
            SELECT created_at AS ts FROM ticket_purchases WHERE lower(wallet_address) = lower(p_wallet)
            UNION ALL SELECT created_at FROM flight_transactions WHERE lower(wallet_address) = lower(p_wallet)
            UNION ALL SELECT created_at FROM game_logs WHERE lower(wallet_address) = lower(p_wallet)
            UNION ALL SELECT created_at FROM flight_game_logs WHERE lower(wallet_address) = lower(p_wallet)
        ) u);
$$;
REVOKE ALL ON FUNCTION admin_wallet_summary(text) FROM public;
GRANT EXECUTE ON FUNCTION admin_wallet_summary(text) TO service_role;


-- ════════════════════════════════════════════════════════════════════
-- ── 4. (OPTIONAL) DEDUP HELPER — review before running! ────────────
--
-- Detects duplicate glitch_users rows (same wallet in different cases)
-- and returns them. Run this read-only first to see if you have any:
--
--     SELECT * FROM detect_glitch_users_dups();
--
-- If non-empty, you can MANUALLY merge them with merge_glitch_users_dups()
-- below. The merge SUMs games_balance, takes the most-recent x_handle,
-- keeps the lowercase row, deletes the others.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION detect_glitch_users_dups()
RETURNS TABLE(lower_wallet text, dup_count bigint, total_balance int, all_handles text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        lower(wallet_address)::text,
        COUNT(*)::bigint,
        SUM(games_balance)::int,
        string_agg(DISTINCT x_handle, ',')
    FROM glitch_users
    GROUP BY lower(wallet_address)
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC;
$$;
REVOKE ALL ON FUNCTION detect_glitch_users_dups() FROM public;
GRANT EXECUTE ON FUNCTION detect_glitch_users_dups() TO service_role;


-- WARNING: Destructive. Reviews + manual confirmation recommended.
-- Merges duplicate rows: keeps lowercase row, sums balances, deletes others.
-- Run only ONCE per logical wallet. Idempotent on re-run (no-op if no dups).
CREATE OR REPLACE FUNCTION merge_glitch_users_dups()
RETURNS TABLE(lower_wallet text, kept_balance int, removed_rows bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    rec record;
    total_balance int;
    chosen_handle text;
    removed_count bigint;
BEGIN
    FOR rec IN
        SELECT lower(wallet_address) AS lw
        FROM glitch_users
        GROUP BY lower(wallet_address)
        HAVING COUNT(*) > 1
    LOOP
        -- Sum across all dup rows for this logical wallet
        SELECT SUM(games_balance) INTO total_balance
        FROM glitch_users WHERE lower(wallet_address) = rec.lw;

        -- Pick a non-null x_handle if any dup has one
        SELECT MAX(x_handle) INTO chosen_handle
        FROM glitch_users WHERE lower(wallet_address) = rec.lw;

        -- Delete all rows for this logical wallet, then insert one canonical
        DELETE FROM glitch_users WHERE lower(wallet_address) = rec.lw;

        INSERT INTO glitch_users (wallet_address, games_balance, x_handle)
        VALUES (rec.lw, total_balance, chosen_handle);

        GET DIAGNOSTICS removed_count = ROW_COUNT;

        lower_wallet := rec.lw;
        kept_balance := total_balance;
        removed_rows := removed_count;  -- always 1 (the row we kept)
        RETURN NEXT;
    END LOOP;
    RETURN;
END;
$$;
REVOKE ALL ON FUNCTION merge_glitch_users_dups() FROM public;
GRANT EXECUTE ON FUNCTION merge_glitch_users_dups() TO service_role;
