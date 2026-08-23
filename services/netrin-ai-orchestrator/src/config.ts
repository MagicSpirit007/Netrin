import { AiRouteError } from './errors.js'

export type OrchestratorConfig = {
  port: number
  allowedOrigins: Set<string>
  amapWebServiceKey: string
  optionSigningKey: string
  supabaseUrl: string
  supabaseAnonKey: string
  routePlanUrl: string
  qwenBaseUrl: string
  fileInputEnabled: boolean
  customProviderEnabled: boolean
}

const DEFAULT_QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new AiRouteError('AI_INTERNAL_ERROR', 500)
  return value
}

function normalizedHttpsUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new AiRouteError('AI_INTERNAL_ERROR', 500)
  }
  return url.toString().replace(/\/+$/, '')
}

function normalizedQwenBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AiRouteError('AI_INTERNAL_ERROR', 500)
  }
  const workspaceHost = /^llm-[a-z0-9-]+\.[a-z0-9-]+\.maas\.aliyuncs\.com$/i.test(url.hostname)
  const allowedHost = url.hostname === 'dashscope.aliyuncs.com' || workspaceHost
  const pathname = url.pathname.replace(/\/+$/, '')
  if (url.protocol !== 'https:' || !allowedHost || url.port || url.username || url.password ||
      url.search || url.hash || pathname !== '/compatible-mode/v1') {
    throw new AiRouteError('AI_INTERNAL_ERROR', 500)
  }
  url.pathname = pathname
  return url.toString().replace(/\/+$/, '')
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  const port = Number(env.PORT ?? 8787)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new AiRouteError('AI_INTERNAL_ERROR', 500)
  }
  const allowedOrigins = new Set(
    (env.NETRIN_AI_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  )
  const optionSigningKey = required(env, 'AI_ROUTE_OPTION_SIGNING_KEY')
  if (optionSigningKey.length < 32) throw new AiRouteError('AI_INTERNAL_ERROR', 500)
  const supabaseUrl = normalizedHttpsUrl(required(env, 'SUPABASE_URL'))
  const routePlanUrl = normalizedHttpsUrl(
    env.NETRIN_ROUTE_PLAN_URL ?? `${supabaseUrl}/functions/v1/netrin-route-plan`
  )
  return {
    port,
    allowedOrigins,
    amapWebServiceKey: required(env, 'AMAP_WEB_SERVICE_KEY'),
    optionSigningKey,
    supabaseUrl,
    supabaseAnonKey: required(env, 'SUPABASE_ANON_KEY'),
    routePlanUrl,
    qwenBaseUrl: normalizedQwenBaseUrl(env.AI_ROUTE_QWEN_BASE_URL ?? DEFAULT_QWEN_BASE_URL),
    fileInputEnabled: enabled(env.AI_ROUTE_FILE_ENABLED),
    customProviderEnabled: enabled(env.AI_ROUTE_CUSTOM_PROVIDER_ENABLED)
  }
}
