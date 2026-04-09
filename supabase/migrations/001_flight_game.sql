-- ============================================================
-- STEP 0: Fix Season 1 XP sync
-- Run once to back-fill users.xp from glitch_season_1
-- ============================================================
UPDATE users u
SET xp = COALESCE(u.xp, 0) + s.season_xp
FROM glitch_season_1 s
WHERE LOWER(u.wallet_address) = LOWER(s.wallet_address)
  AND s.season_xp > 0;

-- ============================================================
-- STEP 1: Glitch Flight tables
-- ============================================================

-- 1a. In-game flight balance (separate from on-chain wallet)
CREATE TABLE IF NOT EXISTS flight_balances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address  TEXT NOT NULL,
    balance         NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT flight_balances_wallet_unique UNIQUE (wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_flight_balances_wallet ON flight_balances (LOWER(wallet_address));

-- 1b. Deposit / withdrawal ledger
CREATE TABLE IF NOT EXISTS flight_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address  TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
    amount          NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    tx_hash         TEXT,           -- on-chain tx hash (deposit) or sent tx (withdrawal)
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
    nonce           TEXT,           -- EIP-191 nonce to prevent replay
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flight_txns_wallet ON flight_transactions (LOWER(wallet_address));
CREATE UNIQUE INDEX IF NOT EXISTS idx_flight_txns_nonce ON flight_transactions (nonce) WHERE nonce IS NOT NULL;

-- 1c. Provably-fair game sessions
CREATE TABLE IF NOT EXISTS flight_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_number    BIGINT NOT NULL,
    server_seed     TEXT NOT NULL,          -- revealed after crash
    server_seed_hash TEXT NOT NULL,         -- SHA-256 of server_seed, shown before round
    crash_point     NUMERIC(10, 2) NOT NULL,
    started_at      TIMESTAMPTZ,
    crashed_at      TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'running', 'crashed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flight_sessions_round ON flight_sessions (round_number DESC);
CREATE INDEX IF NOT EXISTS idx_flight_sessions_status ON flight_sessions (status);

-- 1d. Per-round player bets
CREATE TABLE IF NOT EXISTS flight_game_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES flight_sessions(id),
    wallet_address  TEXT NOT NULL,
    bet_amount      NUMERIC(18, 4) NOT NULL CHECK (bet_amount > 0),
    cashout_at      NUMERIC(10, 2),         -- NULL = lost (didn't cash out)
    profit          NUMERIC(18, 4),         -- NULL = lost; negative not possible (clamped at 0)
    xp_gained       INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flight_logs_wallet ON flight_game_logs (LOWER(wallet_address));
CREATE INDEX IF NOT EXISTS idx_flight_logs_session ON flight_game_logs (session_id);

-- 1e. Season 2 leaderboard (Glitch Game + Glitch Flight combined XP)
CREATE TABLE IF NOT EXISTS glitch_season_2 (
    wallet_address  TEXT PRIMARY KEY,
    season_xp       INT NOT NULL DEFAULT 0,
    games_played    INT NOT NULL DEFAULT 0,
    flights_played  INT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1f. Vault safety limits (single-row config table)
CREATE TABLE IF NOT EXISTS vault_limits (
    id                      INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    max_win_pct             NUMERIC(5, 4) NOT NULL DEFAULT 0.10,  -- 10% of vault balance
    withdrawal_delay_secs   INT NOT NULL DEFAULT 300,             -- 5 min delay
    daily_withdrawal_cap    NUMERIC(18, 4) NOT NULL DEFAULT 500,  -- APE per wallet per day
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the defaults (upsert-safe)
INSERT INTO vault_limits (id, max_win_pct, withdrawal_delay_secs, daily_withdrawal_cap)
VALUES (1, 0.10, 300, 500)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE flight_balances      ENABLE ROW LEVEL SECURITY;
ALTER TABLE flight_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE flight_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE flight_game_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE glitch_season_2      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_limits         ENABLE ROW LEVEL SECURITY;

-- Service role bypasses all RLS automatically — policies below are for anon/authenticated

-- flight_balances: wallet owner can read their own row
CREATE POLICY "flight_balances_read_own"
    ON flight_balances FOR SELECT
    USING (LOWER(wallet_address) = LOWER(current_setting('request.jwt.claims', true)::json->>'sub'));

-- flight_transactions: wallet owner can read their own rows
CREATE POLICY "flight_transactions_read_own"
    ON flight_transactions FOR SELECT
    USING (LOWER(wallet_address) = LOWER(current_setting('request.jwt.claims', true)::json->>'sub'));

-- flight_sessions: public read (provably fair — everyone can verify)
CREATE POLICY "flight_sessions_read_all"
    ON flight_sessions FOR SELECT
    USING (true);

-- flight_game_logs: wallet owner can read their own rows
CREATE POLICY "flight_game_logs_read_own"
    ON flight_game_logs FOR SELECT
    USING (LOWER(wallet_address) = LOWER(current_setting('request.jwt.claims', true)::json->>'sub'));

-- glitch_season_2: public read (leaderboard)
CREATE POLICY "glitch_season_2_read_all"
    ON glitch_season_2 FOR SELECT
    USING (true);

-- vault_limits: no public access
-- (service_role only — no public policy needed)

-- ============================================================
-- Helper stored procedures
-- ============================================================

-- Atomic balance deduction for placing a flight bet
CREATE OR REPLACE FUNCTION deduct_flight_balance(
    p_wallet TEXT,
    p_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_balance NUMERIC;
BEGIN
    SELECT balance INTO v_balance
    FROM flight_balances
    WHERE LOWER(wallet_address) = LOWER(p_wallet)
    FOR UPDATE;

    IF v_balance IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No balance account found');
    END IF;

    IF v_balance < p_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
    END IF;

    UPDATE flight_balances
    SET balance = balance - p_amount,
        updated_at = NOW()
    WHERE LOWER(wallet_address) = LOWER(p_wallet);

    RETURN jsonb_build_object('success', true, 'new_balance', v_balance - p_amount);
END;
$$;

-- Atomic balance credit (cashout / deposit)
CREATE OR REPLACE FUNCTION credit_flight_balance(
    p_wallet TEXT,
    p_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO flight_balances (wallet_address, balance)
    VALUES (LOWER(p_wallet), p_amount)
    ON CONFLICT (wallet_address)
    DO UPDATE SET
        balance = flight_balances.balance + p_amount,
        updated_at = NOW();

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Get vault balance (for max win cap checks)
-- This reads from flight_transactions (deposits vs withdrawals)
CREATE OR REPLACE FUNCTION get_vault_net_balance() RETURNS NUMERIC
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT COALESCE(
        SUM(CASE WHEN type = 'deposit' THEN amount ELSE -amount END), 0
    )
    FROM flight_transactions
    WHERE status = 'confirmed';
$$;
