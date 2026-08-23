import { isIP } from 'node:net'
import { AiRouteError } from '../errors.js'

const MAX_BASE_URL_CHARS = 512
const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/

function containsPathTraversal(value: string): boolean {
  let current = value
  for (let pass = 0; pass < 4; pass += 1) {
    if (/%(?:2f|5c)/i.test(current) || /\\/.test(current) ||
        current.split('/').some((segment) => segment === '.' || segment === '..')) return true
    let decoded: string
    try { decoded = decodeURIComponent(current) } catch { return true }
    if (decoded === current) return false
    current = decoded
  }
  return /%(?:25|2e|2f|5c)/i.test(current)
}

export function validateCustomBaseUrl(value: string): URL {
  if (!value || value.length > MAX_BASE_URL_CHARS || /\\/.test(value)) {
    throw new AiRouteError('AI_PROVIDER_ENDPOINT_INVALID', 400)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AiRouteError('AI_PROVIDER_ENDPOINT_INVALID', 400)
  }
  const hostnameLiteral = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      (url.port && url.port !== '443') || isIP(hostnameLiteral)) {
    throw new AiRouteError('AI_PROVIDER_ENDPOINT_INVALID', 400)
  }
  const authorityStart = value.indexOf('://') + 3
  const pathStart = value.indexOf('/', authorityStart)
  const rawPath = pathStart >= 0 ? value.slice(pathStart).split(/[?#]/, 1)[0] : ''
  if (containsPathTraversal(rawPath)) {
    throw new AiRouteError('AI_PROVIDER_ENDPOINT_INVALID', 400)
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url
}

export function normalizedCustomBaseUrl(value: string): string {
  const url = validateCustomBaseUrl(value)
  return url.toString().replace(/\/+$/, '')
}

export function validateCustomModelId(value: string): string {
  const normalized = value.normalize('NFC').trim()
  if (!MODEL_ID_PATTERN.test(normalized)) throw new AiRouteError('AI_MODEL_NOT_ALLOWED', 400)
  return normalized
}

export function appendProviderPath(baseUrl: URL, suffix: 'models' | 'chat/completions'): URL {
  const normalizedBase = baseUrl.toString().replace(/\/+$/, '')
  return new URL(`${normalizedBase}/${suffix}`)
}
