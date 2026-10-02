-- 02.10.2026, the last two things the public anon key could still reach after the 29.09 lockdown
-- (audit: has_function_privilege / has_table_privilege for anon over the public schema).
--   • locker_wallet_totals — an aggregate view, not writable, but anon held every right on it and the
--     site reads it with the service role only (api/locker/*, api/admin/locker).
--   • survival_has_access(text) — SECURITY DEFINER; the site calls it with the service role only
--     (lib/survivalAccess.ts), so anon has no business answering «is this wallet in the beta».
revoke all on public.locker_wallet_totals from anon, authenticated;
revoke execute on function public.survival_has_access(text) from public, anon, authenticated;
grant execute on function public.survival_has_access(text) to service_role;
