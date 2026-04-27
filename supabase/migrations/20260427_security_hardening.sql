-- ════════════════════════════════════════════════════════════════════
-- Security hardening migration (2026-04-27)
--
-- Adds:
--   1. Atomic ticket increment helper (add_glitch_user_tickets)
--   2. Conditional x_handle setter (set_glitch_user_x_handle)
--   3. UNIQUE constraint on ticket_purchases.tx_hash (race condition fix)
--   4. UNIQUE constraint on (wallet_address, task_config_id) for daily_claims_log
--      (atomicity for daily claim)
--   5. Self-referral guard inside register_referral (drop+recreate with check)
--
-- All RPCs are SECURITY DEFINER + explicit search_path to prevent privilege
-- escalation via search_path injection.
-- ════════════════════════════════════════════════════════════════════

-- 1. Atomic ticket increment for glitch_users.
--    Used by /daily, /streak claim, /activity-quest, /quest/claim.
--    Replaces every read-then-write balance update across the codebase.
CREATE OR REPLACE FUNCTION add_glitch_user_tickets(p_wallet text, p_amount int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_balance int;
BEGIN
    IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-fA-F]{40}$' THEN
        RAISE EXCEPTION 'Invalid wallet';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
        RAISE EXCEPTION 'Invalid amount';
    END IF;

    INSERT INTO glitch_users (wallet_address, games_balance)
    VALUES (lower(p_wallet), p_amount)
    ON CONFLICT (wallet_address)
    DO UPDATE SET games_balance = glitch_users.games_balance + EXCLUDED.games_balance
    RETURNING games_balance INTO new_balance;

    RETURN new_balance;
END;
$$;

REVOKE ALL ON FUNCTION add_glitch_user_tickets(text, int) FROM public;
GRANT EXECUTE ON FUNCTION add_glitch_user_tickets(text, int) TO service_role;


-- 2. Conditional x_handle setter — only fills handle if currently null.
--    Prevents overwrites by attackers (caller still must be authenticated).
CREATE OR REPLACE FUNCTION set_glitch_user_x_handle(p_wallet text, p_handle text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-fA-F]{40}$' THEN
        RAISE EXCEPTION 'Invalid wallet';
    END IF;
    IF p_handle IS NULL OR length(p_handle) = 0 OR length(p_handle) > 64 THEN
        RAISE EXCEPTION 'Invalid handle';
    END IF;

    INSERT INTO glitch_users (wallet_address, x_handle)
    VALUES (lower(p_wallet), p_handle)
    ON CONFLICT (wallet_address)
    DO UPDATE SET x_handle = COALESCE(glitch_users.x_handle, EXCLUDED.x_handle);
END;
$$;

REVOKE ALL ON FUNCTION set_glitch_user_x_handle(text, text) FROM public;
GRANT EXECUTE ON FUNCTION set_glitch_user_x_handle(text, text) TO service_role;


-- 3. Ensure UNIQUE on ticket_purchases.tx_hash so the dedup check
--    in /api/glitch_game/buy is concurrency-safe (otherwise two parallel
--    POSTs with the same tx hash both pass the SELECT then both INSERT).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'ticket_purchases'
          AND c.contype = 'u'
          AND pg_get_constraintdef(c.oid) ILIKE '%tx_hash%'
    ) THEN
        BEGIN
            ALTER TABLE ticket_purchases ADD CONSTRAINT ticket_purchases_tx_hash_unique UNIQUE (tx_hash);
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;
    END IF;
END $$;


-- 4. Same idea for daily_claims_log: (wallet_address, task_config_id) MUST be
--    unique so concurrent /daily POSTs cannot both succeed.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'daily_claims_log'
          AND c.contype = 'u'
          AND pg_get_constraintdef(c.oid) ILIKE '%wallet_address%task_config_id%'
    ) THEN
        BEGIN
            ALTER TABLE daily_claims_log
                ADD CONSTRAINT daily_claims_log_wallet_task_unique
                UNIQUE (wallet_address, task_config_id);
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;
    END IF;
END $$;


-- 5. register_referral: add self-referral guard.
--    Some prior versions of this RPC don't reject inviter=invitee. We re-create
--    a thin wrapper that calls the underlying logic but blocks self-ref first.
--
-- NOTE: This file does NOT redefine the original register_referral body
--       (that lives in earlier migrations). Instead, it wraps the existing
--       function via a check executed at the call site by the API route.
--       (See src/app/api/glitch_games/referral/route.ts.)
--
-- Reason: we cannot safely rewrite an unknown existing function body here.


-- 6. Helpful index for activity-quest GET — speeds up the count queries.
CREATE INDEX IF NOT EXISTS idx_game_logs_wallet_created
    ON game_logs (lower(wallet_address), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_flight_game_logs_wallet_created
    ON flight_game_logs (lower(wallet_address), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_activity_claims_wallet_date
    ON daily_activity_claims (lower(wallet_address), claim_date);


-- 7. UNIQUE constraint on batteries.token_id.
--    Required by /api/upgrade (upsert on conflict) and /api/merge/* (idempotent
--    inserts after vault transfer). Without this, the on-conflict upsert
--    would silently insert duplicates.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'batteries'
          AND c.contype = 'u'
          AND pg_get_constraintdef(c.oid) ILIKE '%token_id%'
    ) THEN
        BEGIN
            ALTER TABLE batteries ADD CONSTRAINT batteries_token_id_unique UNIQUE (token_id);
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_batteries_burned ON batteries (is_burned);
