-- Droidz Survival, 29.09.2026 — the two public views are not writable by the anon key.
--
-- survival_menu_stats and survival_board were created without security_invoker (they run as their
-- owner, postgres, which bypasses RLS) and granted SELECT to anon — but Supabase's default ACL on
-- schema public had already given anon and authenticated EVERY right on them (arwdDxtm), and the
-- later revokes named only tables. survival_menu_stats is a simple view over survival_seasons, so
-- it is auto-updatable: checked on prod (read-only) — is_updatable = YES, is_insertable_into = YES,
-- has_table_privilege('anon', …, 'UPDATE' / 'INSERT' / 'DELETE') = true. An anon PATCH
-- /rest/v1/survival_menu_stats?season_id=eq.beta-1 would rewrite the live season's name, ends_at
-- and pays_out, which /api/survival/pool and /board hand to every player's menu.
--
-- Nothing reads these views with the anon key: the site reads survival_board through the service
-- role, and survival_menu_stats not at all. So: no rights for anon or authenticated.
-- APPLY ONLY WITH THE OWNER'S WORD (a write to prod).

revoke all on public.survival_menu_stats, public.survival_board from anon, authenticated;

-- If a public read is ever wanted again, grant SELECT only, after the revoke:
--   grant select on public.survival_menu_stats, public.survival_board to anon;

-- Check (read-only), all three false:
--   select has_table_privilege('anon','public.survival_menu_stats','UPDATE'),
--          has_table_privilege('anon','public.survival_menu_stats','INSERT'),
--          has_table_privilege('anon','public.survival_menu_stats','DELETE');
