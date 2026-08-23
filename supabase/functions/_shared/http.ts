const DEFAULT_ALLOWED_ORIGINS = [
  'https://utopians.cloud',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]

function allowedOrigins(): Set<string> {
  const configured = (Deno.env.get('NETRIN_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return new Set(configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS)
}

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || allowedOrigins().has(origin)
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  return {
    ...(origin && allowedOrigins().has(origin) ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-request-id, x-submission-id, x-admin-action, x-route-id, x-point-id, x-media-order',
    'access-control-allow-methods': 'POST, OPTIONS',
    'content-type': 'application/json; charset=utf-8',
    'vary': 'Origin'
  }
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) })
}

export function requestFailure(request: Request, error: unknown, status = 500): Response {
  const candidate = request.headers.get('x-request-id') ?? ''
  const requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(candidate) ? candidate : crypto.randomUUID()
  console.error(`[netrin-edge:${requestId}]`, error)
  return json(request, { error: 'Request failed.', requestId }, status)
}

export function publicServiceUrl(value: string, publicBaseUrl: string): string {
  const base = publicBaseUrl.replace(/\/+$/, '')
  const parsed = new URL(value, `${base}/`)
  return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`
}
