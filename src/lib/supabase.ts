import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

/**
 * Every database read must be live. Next.js patches global fetch and keeps GET responses in its
 * Data Cache — `dynamic = 'force-dynamic'` on a route did NOT stop it for supabase-js (checked
 * 24.09.2026: the row changed 111 → 222 → 333, /api/survival/profile kept answering 111 from
 * cache in 22 ms). A cached profile read at boot handed players an old save, the game took it
 * as the server's copy, and their trees and resources rolled back. The client is a database
 * driver, not a CDN: no-store on every request, for both clients.
 */
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' })
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// 1. Клиент для фронтенда (Доступен везде)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: noStoreFetch } })

// 2. Клиент для бэкенда (Админ)
// ПРОВЕРКА: Получаем ключ без "!" (чтобы не было ошибки, если его нет)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Создаем админ-клиент ТОЛЬКО если есть ключ (на сервере).
// На клиенте это будет null, и сайт не упадет.
export const supabaseAdmin = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, { global: { fetch: noStoreFetch } })
    : (null as any) 