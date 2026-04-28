-- ════════════════════════════════════════════════════════════════════
-- Admin analytics RPCs (2026-04-28)
--
-- Heavy GROUP BY / DISTINCT aggregations behind SECURITY DEFINER functions
-- so the panel can pull all-time data without fetching every row to JS.
-- All functions are STABLE — Postgres can cache within a single statement.
-- All locked down to service_role only.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. Distinct players over a window (any of the 4 main tables) ──────────
CREATE OR REPLACE FUNCTION admin_distinct_players(p_table text, p_since timestamptz default null)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE result bigint;
BEGIN
    IF p_table NOT IN ('game_logs', 'flight_game_logs', 'ticket_purchases', 'flight_transactions') THEN
        RAISE EXCEPTION 'Invalid table';
    END IF;
    EXECUTE format(
        'SELECT COUNT(DISTINCT lower(wallet_address)) FROM %I WHERE ($1::timestamptz IS NULL OR created_at >= $1)',
        p_table
    ) INTO result USING p_since;
    RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION admin_distinct_players(text, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION admin_distinct_players(text, timestamptz) TO service_role;


-- ── 2. Top Cards spenders (all-time) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_top_card_spenders(p_limit int default 50)
RETURNS TABLE(wallet_address text, total_ape numeric, purchases bigint, last_purchase timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT lower(wallet_address)::text,
           SUM(ape_amount)::numeric,
           COUNT(*)::bigint,
           MAX(created_at)
    FROM ticket_purchases
    GROUP BY lower(wallet_address)
    ORDER BY SUM(ape_amount) DESC NULLS LAST
    LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION admin_top_card_spenders(int) FROM public;
GRANT EXECUTE ON FUNCTION admin_top_card_spenders(int) TO service_role;


-- ── 3. Top Flight profits ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_top_flight_profits(p_limit int default 50, p_since timestamptz default null)
RETURNS TABLE(wallet_address text, total_profit numeric, total_volume numeric, wins bigint, losses bigint, plays bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT lower(wallet_address)::text,
           COALESCE(SUM(profit), 0)::numeric,
           SUM(bet_amount)::numeric,
           COUNT(*) FILTER (WHERE cashout_at IS NOT NULL)::bigint,
           COUNT(*) FILTER (WHERE cashout_at IS NULL)::bigint,
           COUNT(*)::bigint
    FROM flight_game_logs
    WHERE p_since IS NULL OR created_at >= p_since
    GROUP BY lower(wallet_address)
    ORDER BY COALESCE(SUM(profit), 0) DESC NULLS LAST
    LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION admin_top_flight_profits(int, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION admin_top_flight_profits(int, timestamptz) TO service_role;


-- ── 4. Worst Flight losses (most lost) ────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_worst_flight_losers(p_limit int default 50, p_since timestamptz default null)
RETURNS TABLE(wallet_address text, total_loss numeric, total_volume numeric, plays bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT lower(wallet_address)::text,
           SUM(bet_amount - COALESCE(cashout_at * bet_amount, 0))::numeric,
           SUM(bet_amount)::numeric,
           COUNT(*)::bigint
    FROM flight_game_logs
    WHERE p_since IS NULL OR created_at >= p_since
    GROUP BY lower(wallet_address)
    HAVING SUM(bet_amount - COALESCE(cashout_at * bet_amount, 0)) > 0
    ORDER BY SUM(bet_amount - COALESCE(cashout_at * bet_amount, 0)) DESC
    LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION admin_worst_flight_losers(int, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION admin_worst_flight_losers(int, timestamptz) TO service_role;


-- ── 5. Cards prize drop distribution (group by prize_type_id) ─────────────
CREATE OR REPLACE FUNCTION admin_prize_drop_distribution(p_since timestamptz default null)
RETURNS TABLE(prize_type_id text, drops bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT prize_type_id::text, COUNT(*)::bigint
    FROM game_logs
    WHERE status = 'success'
      AND prize_type_id IS NOT NULL
      AND (p_since IS NULL OR created_at >= p_since)
    GROUP BY prize_type_id
    ORDER BY COUNT(*) DESC;
$$;
REVOKE ALL ON FUNCTION admin_prize_drop_distribution(timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION admin_prize_drop_distribution(timestamptz) TO service_role;


-- ── 6. Crash point histogram (Flight) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_flight_crash_buckets(p_since timestamptz default null)
RETURNS TABLE(bucket text, sort_key numeric, cnt bigint, avg_in_bucket numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        CASE
            WHEN crash_point < 1.10 THEN '1.00-1.09x'
            WHEN crash_point < 1.50 THEN '1.10-1.49x'
            WHEN crash_point < 2.00 THEN '1.50-1.99x'
            WHEN crash_point < 3.00 THEN '2.00-2.99x'
            WHEN crash_point < 5.00 THEN '3.00-4.99x'
            WHEN crash_point < 10.00 THEN '5.00-9.99x'
            WHEN crash_point < 20.00 THEN '10.00-19.99x'
            ELSE '20.00x+'
        END AS bucket,
        MIN(crash_point)::numeric AS sort_key,
        COUNT(*)::bigint,
        AVG(crash_point)::numeric
    FROM flight_sessions
    WHERE status = 'crashed'
      AND (p_since IS NULL OR crashed_at >= p_since)
    GROUP BY bucket
    ORDER BY MIN(crash_point);
$$;
REVOKE ALL ON FUNCTION admin_flight_crash_buckets(timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION admin_flight_crash_buckets(timestamptz) TO service_role;


-- ── 7. DAU trend over N days (cards + flight + total) ────────────────────
CREATE OR REPLACE FUNCTION admin_dau_trend(p_days int default 30)
RETURNS TABLE(day date, cards_dau bigint, flight_dau bigint, cards_plays bigint, flight_bets bigint, ape_revenue numeric, ape_deposits numeric, ape_withdrawals numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH days AS (
        SELECT (CURRENT_DATE - (offs || ' days')::interval)::date AS day
        FROM generate_series(0, GREATEST(1, p_days) - 1) AS offs
    ),
    cards AS (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
               COUNT(DISTINCT lower(wallet_address)) AS dau,
               COUNT(*) AS plays
        FROM game_logs
        WHERE status = 'success'
          AND created_at >= CURRENT_DATE - (p_days || ' days')::interval
        GROUP BY (created_at AT TIME ZONE 'UTC')::date
    ),
    flight AS (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
               COUNT(DISTINCT lower(wallet_address)) AS dau,
               COUNT(*) AS bets
        FROM flight_game_logs
        WHERE created_at >= CURRENT_DATE - (p_days || ' days')::interval
        GROUP BY (created_at AT TIME ZONE 'UTC')::date
    ),
    revenue AS (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
               SUM(ape_amount) AS ape
        FROM ticket_purchases
        WHERE created_at >= CURRENT_DATE - (p_days || ' days')::interval
        GROUP BY (created_at AT TIME ZONE 'UTC')::date
    ),
    deposits AS (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day, SUM(amount) AS ape
        FROM flight_transactions
        WHERE type = 'deposit' AND status = 'confirmed'
          AND created_at >= CURRENT_DATE - (p_days || ' days')::interval
        GROUP BY (created_at AT TIME ZONE 'UTC')::date
    ),
    withdrawals AS (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day, SUM(amount) AS ape
        FROM flight_transactions
        WHERE type = 'withdrawal' AND status = 'confirmed'
          AND created_at >= CURRENT_DATE - (p_days || ' days')::interval
        GROUP BY (created_at AT TIME ZONE 'UTC')::date
    )
    SELECT d.day,
           COALESCE(c.dau, 0)::bigint,
           COALESCE(f.dau, 0)::bigint,
           COALESCE(c.plays, 0)::bigint,
           COALESCE(f.bets, 0)::bigint,
           COALESCE(r.ape, 0)::numeric,
           COALESCE(dp.ape, 0)::numeric,
           COALESCE(wd.ape, 0)::numeric
    FROM days d
    LEFT JOIN cards c        ON c.day = d.day
    LEFT JOIN flight f       ON f.day = d.day
    LEFT JOIN revenue r      ON r.day = d.day
    LEFT JOIN deposits dp    ON dp.day = d.day
    LEFT JOIN withdrawals wd ON wd.day = d.day
    ORDER BY d.day;
$$;
REVOKE ALL ON FUNCTION admin_dau_trend(int) FROM public;
GRANT EXECUTE ON FUNCTION admin_dau_trend(int) TO service_role;


-- ── 8. XP tier histogram (S2) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_xp_tier_distribution()
RETURNS TABLE(tier text, sort_key int, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        CASE
            WHEN season_xp = 0 THEN '0'
            WHEN season_xp < 500 THEN '1-499'
            WHEN season_xp < 2000 THEN '500-1999'
            WHEN season_xp < 5000 THEN '2000-4999'
            WHEN season_xp < 10000 THEN '5000-9999'
            WHEN season_xp < 25000 THEN '10000-24999'
            WHEN season_xp < 50000 THEN '25000-49999'
            ELSE '50000+'
        END AS tier,
        MIN(season_xp)::int AS sort_key,
        COUNT(*)::bigint
    FROM glitch_season_2
    GROUP BY tier
    ORDER BY MIN(season_xp);
$$;
REVOKE ALL ON FUNCTION admin_xp_tier_distribution() FROM public;
GRANT EXECUTE ON FUNCTION admin_xp_tier_distribution() TO service_role;


-- ── 9. Recent signups (first activity, cards or flight) ──────────────────
CREATE OR REPLACE FUNCTION admin_recent_signups(p_limit int default 50)
RETURNS TABLE(wallet_address text, first_seen timestamptz, sources text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH unioned AS (
        SELECT lower(wallet_address)::text AS wallet, created_at AS ts, 'cards'::text AS src
        FROM ticket_purchases
        UNION ALL
        SELECT lower(wallet_address)::text, created_at, 'flight'::text
        FROM flight_transactions WHERE type = 'deposit'
    )
    SELECT wallet,
           MIN(ts),
           string_agg(DISTINCT src, ',' ORDER BY src)
    FROM unioned
    GROUP BY wallet
    ORDER BY MIN(ts) DESC
    LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION admin_recent_signups(int) FROM public;
GRANT EXECUTE ON FUNCTION admin_recent_signups(int) TO service_role;


-- ── 10. New signups per day (last N days) ────────────────────────────────
CREATE OR REPLACE FUNCTION admin_signups_trend(p_days int default 30)
RETURNS TABLE(day date, signups bigint, cumulative bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH first_seen AS (
        SELECT lower(wallet_address)::text AS wallet, MIN(created_at) AS ts
        FROM (
            SELECT wallet_address, created_at FROM ticket_purchases
            UNION ALL
            SELECT wallet_address, created_at FROM flight_transactions WHERE type = 'deposit'
        ) u
        GROUP BY lower(wallet_address)
    ),
    days AS (
        SELECT (CURRENT_DATE - (offs || ' days')::interval)::date AS day
        FROM generate_series(0, GREATEST(1, p_days) - 1) AS offs
    ),
    per_day AS (
        SELECT (ts AT TIME ZONE 'UTC')::date AS day, COUNT(*) AS signups
        FROM first_seen
        WHERE ts >= CURRENT_DATE - (p_days || ' days')::interval
        GROUP BY (ts AT TIME ZONE 'UTC')::date
    ),
    cumulative_base AS (
        SELECT COUNT(*) AS prior FROM first_seen WHERE ts < CURRENT_DATE - (p_days || ' days')::interval
    )
    SELECT d.day,
           COALESCE(p.signups, 0)::bigint,
           ((SELECT prior FROM cumulative_base) +
            SUM(COALESCE(p.signups, 0)) OVER (ORDER BY d.day))::bigint
    FROM days d LEFT JOIN per_day p ON p.day = d.day
    ORDER BY d.day;
$$;
REVOKE ALL ON FUNCTION admin_signups_trend(int) FROM public;
GRANT EXECUTE ON FUNCTION admin_signups_trend(int) TO service_role;


-- ── 11. Vault liability snapshot ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_flight_liability()
RETURNS TABLE(total_balance numeric, players bigint, max_balance numeric, mean_balance numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        COALESCE(SUM(balance), 0)::numeric,
        COUNT(*)::bigint,
        COALESCE(MAX(balance), 0)::numeric,
        COALESCE(AVG(balance), 0)::numeric
    FROM flight_balances
    WHERE balance > 0;
$$;
REVOKE ALL ON FUNCTION admin_flight_liability() FROM public;
GRANT EXECUTE ON FUNCTION admin_flight_liability() TO service_role;


-- ── 12. Quest completion today (S2) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_quest_completion_today()
RETURNS TABLE(quest_type text, completions bigint, xp_distributed numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT quest_type::text, COUNT(*)::bigint, SUM(xp_gained)::numeric
    FROM daily_activity_claims
    WHERE claim_date = CURRENT_DATE
    GROUP BY quest_type
    ORDER BY COUNT(*) DESC;
$$;
REVOKE ALL ON FUNCTION admin_quest_completion_today() FROM public;
GRANT EXECUTE ON FUNCTION admin_quest_completion_today() TO service_role;


-- ── 13. All-time platform totals (cheap aggregate, no group by) ──────────
CREATE OR REPLACE FUNCTION admin_lifetime_totals()
RETURNS TABLE(
    total_card_plays bigint,
    total_card_errors bigint,
    total_card_revenue numeric,
    total_card_purchases bigint,
    total_flight_bets bigint,
    total_flight_volume numeric,
    total_flight_payout numeric,
    total_flight_deposits numeric,
    total_flight_withdrawals numeric,
    total_rounds bigint,
    total_users bigint,
    total_glitch_users bigint,
    total_nfts_claimed bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        (SELECT COUNT(*) FROM game_logs WHERE status = 'success'),
        (SELECT COUNT(*) FROM game_logs WHERE status = 'error'),
        (SELECT COALESCE(SUM(ape_amount), 0)::numeric FROM ticket_purchases),
        (SELECT COUNT(*) FROM ticket_purchases),
        (SELECT COUNT(*) FROM flight_game_logs),
        (SELECT COALESCE(SUM(bet_amount), 0)::numeric FROM flight_game_logs),
        (SELECT COALESCE(SUM(cashout_at * bet_amount), 0)::numeric FROM flight_game_logs WHERE cashout_at IS NOT NULL),
        (SELECT COALESCE(SUM(amount), 0)::numeric FROM flight_transactions WHERE type='deposit' AND status='confirmed'),
        (SELECT COALESCE(SUM(amount), 0)::numeric FROM flight_transactions WHERE type='withdrawal' AND status='confirmed'),
        (SELECT COUNT(*) FROM flight_sessions WHERE status = 'crashed'),
        (SELECT COUNT(*) FROM users),
        (SELECT COUNT(*) FROM glitch_users),
        (SELECT COUNT(*) FROM nft_inventory WHERE status = 'claimed');
$$;
REVOKE ALL ON FUNCTION admin_lifetime_totals() FROM public;
GRANT EXECUTE ON FUNCTION admin_lifetime_totals() TO service_role;


-- ── 14. Wallet activity drill-down (search by wallet) ────────────────────
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
        COALESCE((SELECT games_balance FROM glitch_users WHERE lower(wallet_address) = lower(p_wallet)), 0)::int,
        COALESCE((SELECT balance FROM flight_balances WHERE lower(wallet_address) = lower(p_wallet)), 0)::numeric,
        (SELECT COUNT(*) FROM game_logs WHERE lower(wallet_address) = lower(p_wallet) AND status = 'success'),
        (SELECT COUNT(*) FROM nft_inventory WHERE lower(winner_wallet) = lower(p_wallet) AND status = 'claimed'),
        COALESCE((SELECT SUM(ape_amount) FROM ticket_purchases WHERE lower(wallet_address) = lower(p_wallet)), 0)::numeric,
        (SELECT COUNT(*) FROM flight_game_logs WHERE lower(wallet_address) = lower(p_wallet)),
        COALESCE((SELECT SUM(profit) FROM flight_game_logs WHERE lower(wallet_address) = lower(p_wallet)), 0)::numeric,
        COALESCE((SELECT SUM(amount) FROM flight_transactions WHERE lower(wallet_address) = lower(p_wallet) AND type='deposit' AND status='confirmed'), 0)::numeric,
        COALESCE((SELECT SUM(amount) FROM flight_transactions WHERE lower(wallet_address) = lower(p_wallet) AND type='withdrawal' AND status='confirmed'), 0)::numeric,
        COALESCE((SELECT season_xp FROM glitch_season_2 WHERE lower(wallet_address) = lower(p_wallet)), 0)::int,
        COALESCE((SELECT xp FROM users WHERE lower(wallet_address) = lower(p_wallet)), 0)::int,
        COALESCE((SELECT droids_count FROM users WHERE lower(wallet_address) = lower(p_wallet)), 0)::int,
        (SELECT x_handle FROM glitch_users WHERE lower(wallet_address) = lower(p_wallet)),
        (SELECT MIN(ts) FROM (
            SELECT created_at AS ts FROM ticket_purchases WHERE lower(wallet_address) = lower(p_wallet)
            UNION ALL SELECT created_at FROM flight_transactions WHERE lower(wallet_address) = lower(p_wallet)
            UNION ALL SELECT created_at FROM game_logs WHERE lower(wallet_address) = lower(p_wallet)
            UNION ALL SELECT created_at FROM flight_game_logs WHERE lower(wallet_address) = lower(p_wallet)
        ) u);
$$;
REVOKE ALL ON FUNCTION admin_wallet_summary(text) FROM public;
GRANT EXECUTE ON FUNCTION admin_wallet_summary(text) TO service_role;


-- ── 15. Hourly play distribution (last 7d) ───────────────────────────────
CREATE OR REPLACE FUNCTION admin_hourly_play_distribution()
RETURNS TABLE(hour_utc int, cards_plays bigint, flight_bets bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH hours AS (SELECT generate_series(0, 23) AS h),
    cards AS (
        SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')::int AS h, COUNT(*) AS cnt
        FROM game_logs
        WHERE status = 'success' AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')
    ),
    flight AS (
        SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')::int AS h, COUNT(*) AS cnt
        FROM flight_game_logs
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')
    )
    SELECT h.h::int, COALESCE(c.cnt, 0)::bigint, COALESCE(f.cnt, 0)::bigint
    FROM hours h
    LEFT JOIN cards c ON c.h = h.h
    LEFT JOIN flight f ON f.h = h.h
    ORDER BY h.h;
$$;
REVOKE ALL ON FUNCTION admin_hourly_play_distribution() FROM public;
GRANT EXECUTE ON FUNCTION admin_hourly_play_distribution() TO service_role;
