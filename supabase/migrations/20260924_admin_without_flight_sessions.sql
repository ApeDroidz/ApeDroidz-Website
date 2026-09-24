-- flight_sessions was dropped on 24.09.2026 (Glitch Flight retired; backup in apedroidz-backups).
-- Two admin RPCs still read it and failed, so the panel reported "admin_lifetime_totals missing".
-- Rounds now count from the bet log (a round with no bets is not counted); the crash histogram is empty.

CREATE OR REPLACE FUNCTION public.admin_lifetime_totals()
 RETURNS TABLE(total_card_plays bigint, total_card_errors bigint, total_card_revenue numeric, total_card_purchases bigint, total_flight_bets bigint, total_flight_volume numeric, total_flight_payout numeric, total_flight_deposits numeric, total_flight_withdrawals numeric, total_rounds bigint, total_users bigint, total_glitch_users bigint, total_nfts_claimed bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        (SELECT COUNT(DISTINCT session_id) FROM flight_game_logs),
        (SELECT COUNT(*) FROM users),
        (SELECT COUNT(*) FROM glitch_users),
        (SELECT COUNT(*) FROM nft_inventory WHERE status = 'claimed');
$function$;

CREATE OR REPLACE FUNCTION public.admin_flight_crash_buckets(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(bucket text, sort_key numeric, cnt bigint, avg_in_bucket numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT NULL::text, NULL::numeric, NULL::bigint, NULL::numeric WHERE false;
$function$;
