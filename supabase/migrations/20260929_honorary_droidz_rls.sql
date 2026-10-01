-- Close honorary_droidz to the public API keys.
--
-- 20260806_honorary_droidz.sql created the table without row level security, so the
-- default Supabase grants left anon/authenticated with full DML over PostgREST: anyone
-- holding the public anon key could PATCH name/description/external_url/traits (served as
-- token metadata to marketplaces by /api/metadata/honorary/[id]) or DELETE rows.
--
-- Every reader and writer on the site goes through the service role (supabaseAdmin in
-- metadata, viewer, owned-honorary, admin refresh-opensea; the service-key client in
-- display-pref), and the service role bypasses RLS. So: RLS on, no policies, and the
-- anon/authenticated grants revoked outright — including SELECT, since no browser code
-- reads this table.
alter table public.honorary_droidz enable row level security; -- service role only

revoke all on table public.honorary_droidz from anon, authenticated;
