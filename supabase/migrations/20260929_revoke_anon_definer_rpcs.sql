-- ════════════════════════════════════════════════════════════════════
-- Close server-only RPCs to the public anon key (29.09.2026)
--
-- Earlier migrations did `REVOKE ALL ON FUNCTION … FROM public`. In Supabase that is not
-- enough: default privileges on schema public GRANT EXECUTE to anon and authenticated
-- directly (pg_default_acl: anon=X/postgres, authenticated=X/postgres), and a revoke from
-- PUBLIC does not touch a direct grant. Checked on prod 29.09 (read-only): every function
-- below had has_function_privilege('anon', …, 'EXECUTE') = true, and
-- POST /rest/v1/rpc/admin_lifetime_totals with NEXT_PUBLIC_SUPABASE_ANON_KEY answered 200
-- with revenue, deposits and withdrawals — the whole admin panel bypassed requireAdmin.
-- Most are SECURITY DEFINER, so the caller's lack of table rights does not stop them;
-- the write ones (credit_flight_balance, add_glitch_user_tickets, …) mint balance.
--
-- Every caller in the site goes through supabaseAdmin (service_role) in src/app/api/**;
-- the game bundle never talks to Supabase directly. So: service_role only.
--
-- NOT touched: survival_has_access(text) — anon EXECUTE on it is intentional.
--
-- Apply: node --env-file=.env.local scripts/apply-revoke-anon-rpcs.mjs          (dry run)
--        node --env-file=.env.local scripts/apply-revoke-anon-rpcs.mjs --commit (prod)
-- ════════════════════════════════════════════════════════════════════


-- ── 1. Admin analytics and diagnostics (read) ─────────────────────────────
REVOKE ALL ON FUNCTION public.admin_dau_trend(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dau_trend(integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_distinct_players(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_distinct_players(text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.admin_flight_crash_buckets(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_flight_crash_buckets(timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.admin_flight_liability() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_flight_liability() TO service_role;

REVOKE ALL ON FUNCTION public.admin_hourly_play_distribution() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hourly_play_distribution() TO service_role;

REVOKE ALL ON FUNCTION public.admin_lifetime_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lifetime_totals() TO service_role;

REVOKE ALL ON FUNCTION public.admin_prize_drop_distribution(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_prize_drop_distribution(timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.admin_quest_completion_today() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_quest_completion_today() TO service_role;

REVOKE ALL ON FUNCTION public.admin_recent_signups(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recent_signups(integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_signups_trend(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_signups_trend(integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_top_card_spenders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_top_card_spenders(integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_top_flight_profits(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_top_flight_profits(integer, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.admin_wallet_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_wallet_summary(text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_worst_flight_losers(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_worst_flight_losers(integer, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.admin_xp_tier_distribution() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_xp_tier_distribution() TO service_role;

REVOKE ALL ON FUNCTION public.detect_glitch_users_dups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_glitch_users_dups() TO service_role;

REVOKE ALL ON FUNCTION public.get_vault_net_balance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vault_net_balance() TO service_role;

REVOKE ALL ON FUNCTION public.locker_verify_chain() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locker_verify_chain() TO service_role;


-- ── 2. Writes (balances, tickets, handles, vault locks, feedback payout) ──
REVOKE ALL ON FUNCTION public.add_glitch_user_tickets(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_glitch_user_tickets(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.set_glitch_user_x_handle(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_glitch_user_x_handle(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.merge_glitch_users_dups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_glitch_users_dups() TO service_role;

REVOKE ALL ON FUNCTION public.deduct_glitch_game_balance(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_glitch_game_balance(text) TO service_role;

REVOKE ALL ON FUNCTION public.increment_season2_play(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_season2_play(text, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.credit_flight_balance(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_flight_balance(text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.deduct_flight_balance(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_flight_balance(text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.process_flight_deposit(text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_flight_deposit(text, text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.acquire_vault_send_lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_vault_send_lock(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.release_vault_send_lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_vault_send_lock(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.survival_submit_feedback(text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.survival_submit_feedback(text, integer, text, text) TO service_role;


-- ── 3. New functions start closed ─────────────────────────────────────────
-- Existing functions are not affected by default privileges; only ones created later.
-- anon/authenticated come from the per-schema entry, so they are revoked in schema public.
-- PUBLIC comes from the built-in global default, which a per-schema revoke cannot remove
-- (per-schema defaults only add to the global ones), so that revoke is global for role
-- postgres. service_role keeps its per-schema default grant in public. A new function that
-- the browser must call (like survival_has_access) now needs an explicit
-- `GRANT EXECUTE … TO anon`.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
