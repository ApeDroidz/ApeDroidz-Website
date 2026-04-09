-- Add wallet_address to flight_sessions for per-user isolation
ALTER TABLE flight_sessions
    ADD COLUMN IF NOT EXISTS wallet_address TEXT;

CREATE INDEX IF NOT EXISTS idx_flight_sessions_wallet ON flight_sessions (wallet_address);
