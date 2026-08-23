import { corsHeaders, isAllowedOrigin, json } from '../_shared/http.ts'
import { consumeFixedWindowLimit, contentLengthExceeds, trustedProxyClientKey } from '../_shared/request-security.ts'
import type { RoutePlanAuthorization } from './auth.ts'
import {
  buildAmapRouteUrl,
  normalizeAmapRouteResponse,
  parseRoutePlanRequest,
  type RoutePlanRequest,
  type RoutePlanResponse
} from './core.ts'

const MAX_BODY_BYTES = 4 * 1024
const REQUEST_TIMEOUT_MS = 8_000
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 30
const RATE_WINDOW_MAX_ENTRIES = 2_048
const CACHE_TTL_MS = 5 * 60_000
const CACHE_MAX_ENTRIES = 500

type RoutePlanHandlerOptions = {
  amapKey: string
  authorize(request: Request): Promise<RoutePlanAuthorization>
  fetchImpl?: typeof fetch
  now?: () => number
  dailyAlertThreshold?: number
  logger?: Pick<Console, 'log' | 'warn'>
}

export function routePlanRateLimitKey(userId: string, request: Request): string {
  return `${userId}:${trustedProxyClientKey(request)}`
}

export function createRoutePlanHandler(options: RoutePlanHandlerOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const logger = options.logger ?? console
  const rateWindows = new Map<string, { startedAt: number; count: number }>()
  const routeCache = new Map<string, { expiresAt: number; value: RoutePlanResponse }>()
  let providerQuotaDay = ''
  let providerCallsToday = 0

  function logAggregate(status: number, startedAt: number, input?: RoutePlanRequest, cacheHit?: boolean): void {
    logger.log(JSON.stringify({
      event: 'netrin_route_plan',
      date: new Date(now()).toISOString().slice(0, 10),
      mode: input?.travelMode ?? 'unknown',
      purpose: input?.purpose ?? 'unknown',
      status,
      cacheHit: cacheHit ?? false,
      latencyMs: Math.max(0, now() - startedAt)
    }))
  }

  function recordProviderCall(): void {
    const day = new Date(now()).toISOString().slice(0, 10)
    if (providerQuotaDay !== day) {
      providerQuotaDay = day
      providerCallsToday = 0
    }
    providerCallsToday += 1
    const threshold = options.dailyAlertThreshold ?? 0
    if (Number.isFinite(threshold) && threshold > 0 && providerCallsToday === threshold) {
      logger.warn(JSON.stringify({ event: 'netrin_route_plan_quota_alert', date: day, providerCalls: providerCallsToday }))
    }
  }

  function routeCacheKey(input: RoutePlanRequest): string {
    const point = ([lng, lat]: [number, number]) => `${lng.toFixed(5)},${lat.toFixed(5)}`
    return `${input.travelMode}:${point(input.from)}>${point(input.to)}`
  }

  function readCachedRoute(key: string): RoutePlanResponse | undefined {
    const cached = routeCache.get(key)
    if (!cached) return undefined
    if (cached.expiresAt <= now()) {
      routeCache.delete(key)
      return undefined
    }
    return cached.value
  }

  function cacheRoute(key: string, value: RoutePlanResponse): void {
    if (!routeCache.has(key) && routeCache.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = routeCache.keys().next().value
      if (oldestKey) routeCache.delete(oldestKey)
    }
    routeCache.set(key, { expiresAt: now() + CACHE_TTL_MS, value })
  }

  return async function handleRoutePlan(request: Request): Promise<Response> {
    const startedAt = now()
    const reply = (body: unknown, status = 200) => json(request, body, status)
    if (!isAllowedOrigin(request)) return reply({ error: 'Origin not allowed.' }, 403)
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
    if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)

    let authorization: RoutePlanAuthorization
    try {
      authorization = await options.authorize(request)
    } catch {
      return reply({ error: 'Account validation is unavailable.' }, 503)
    }
    if (!authorization.ok) return reply({ error: authorization.error }, authorization.status)
    if (!options.amapKey) return reply({ error: 'Route planning is unavailable.' }, 503)
    if (contentLengthExceeds(request, MAX_BODY_BYTES)) {
      return reply({ error: 'Request body is too large.' }, 413)
    }
    if (!consumeFixedWindowLimit(
      rateWindows,
      routePlanRateLimitKey(authorization.userId, request),
      now(),
      RATE_WINDOW_MS,
      RATE_LIMIT,
      RATE_WINDOW_MAX_ENTRIES
    )) {
      return reply({ error: 'Too many requests.' }, 429)
    }

    try {
      const rawBody = await request.text()
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return reply({ error: 'Request body is too large.' }, 413)
      }
      const input = parseRoutePlanRequest(JSON.parse(rawBody))
      const cacheKey = routeCacheKey(input)
      const cached = readCachedRoute(cacheKey)
      if (cached) {
        logAggregate(200, startedAt, input, true)
        return reply(cached)
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        recordProviderCall()
        const response = await fetchImpl(buildAmapRouteUrl(input, options.amapKey), {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: controller.signal
        })
        if (!response.ok) {
          logAggregate(502, startedAt, input, false)
          return reply({ error: 'Route provider unavailable.' }, 502)
        }
        const normalized = normalizeAmapRouteResponse(await response.json(), input)
        cacheRoute(cacheKey, normalized)
        logAggregate(200, startedAt, input, false)
        return reply(normalized)
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logAggregate(504, startedAt)
        return reply({ error: 'Route provider timed out.' }, 504)
      }
      if (error instanceof SyntaxError || (error instanceof Error && error.message.startsWith('invalid-'))) {
        logAggregate(400, startedAt)
        return reply({ error: 'Invalid route planning request.' }, 400)
      }
      logAggregate(502, startedAt)
      return reply({ error: 'Route provider unavailable.' }, 502)
    }
  }
}
