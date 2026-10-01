-- ════════════════════════════════════════════════════════════════════
-- public.users: закрыть запись анонимным ключом (2026-09-29)
--
-- Было: политика «Enable insert/update for everyone» (cmd=ALL, roles=public,
-- qual=true) и гранты INSERT/UPDATE/DELETE/TRUNCATE у anon и authenticated.
-- С публичным ключом из бандла любой мог переписать xp/username/PFP/
-- droids_count любого кошелька или удалить все строки (глобальный
-- лидерборд, имена в season1/2, запасной признак холдера в quest/claim и
-- glitch_games/dashboard).
--
-- Стало: браузер только читает. Пишут только серверные роуты через
-- service_role:
--   /api/user/sync-progress — xp (NFT), droids_count, batteries_count
--   /api/user/profile       — username, PFP (с подписью и проверкой владения)
--   RPC increment_user_xp / get_or_create_ref_code / register_referral —
--       вызываются только из API через supabaseAdmin.
--
-- ПОРЯДОК: применять ТОЛЬКО ПОСЛЕ деплоя кода с этими роутами (иначе смена
-- имени/PFP и синк XP на старом клиенте молча перестанут сохраняться).
-- Применять с апрувом владельца.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable insert/update for everyone" ON public.users;

-- Чтение клиенту нужно (profile-modal, user-progress-provider,
-- glitch_games/cards). Если отдельной SELECT-политики не было — создаём.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users'
          AND cmd IN ('SELECT', 'ALL')
    ) THEN
        CREATE POLICY "users_public_read" ON public.users
            FOR SELECT TO anon, authenticated
            USING (true);
    END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.users FROM anon, authenticated;
GRANT SELECT ON public.users TO anon, authenticated;

-- RPC, пишущие в users: только service_role. Сигнатуры берём из pg_proc,
-- чтобы задеть все перегрузки (точные сигнатуры в миграциях репо не лежат).
DO $$
DECLARE
    fn regprocedure;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('increment_user_xp', 'get_or_create_ref_code', 'register_referral')
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;

COMMIT;

-- Проверка после применения (только чтение):
--   SELECT policyname, cmd, roles, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'users';
--     → одна политика, cmd = SELECT
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'users' AND grantee IN ('anon','authenticated');
--     → только SELECT / REFERENCES / TRIGGER
--   PATCH /rest/v1/users?wallet_address=eq.0x… с anon-ключом → 401/403 (или 0 строк)
--   Смена имени/PFP в профиле сохраняется; /api/leaderboard/global отдаёт данные.
