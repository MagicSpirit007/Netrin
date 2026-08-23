import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const isolatedAppearanceDev = import.meta.env.DEV && import.meta.env.NETRIN_APPEARANCE_DEV_ISOLATED === '1'

/** 两个 env 都填了才算配置完成（codex/CI 无 .env.local 时为 false）。 */
export const isSupabaseConfigured = !isolatedAppearanceDev && Boolean(url && anonKey)

/** 未配置时为 null；所有调用方必须先判空。 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      }
    })
  : null
