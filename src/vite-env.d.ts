/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_AMAP_KEY?: string
  readonly VITE_AMAP_SERVICE_HOST?: string
  readonly VITE_AMAP_SECURITY_JSCODE?: string
  readonly VITE_AI_ROUTE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
