import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// 1. Клиент для фронтенда (Доступен везде)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// 2. Клиент для бэкенда (Админ)
// ПРОВЕРКА: Получаем ключ без "!" (чтобы не было ошибки, если его нет)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Создаем админ-клиент ТОЛЬКО если есть ключ (на сервере).
// На клиенте это будет null, и сайт не упадет.
export const supabaseAdmin = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : (null as any) 