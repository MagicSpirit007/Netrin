import { createHmac, timingSafeEqual } from 'node:crypto'
import { AiRouteError } from '../errors.js'

export type CapabilityTokenPayload = {
  purpose: 'custom-provider-capability'
  userId: string
  baseUrl: string
  modelId: string
  credentialTag: string
  maxContextTokens: number
  expiresAt: number
}

function sign(encoded: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('netrin-ai-provider-capability\0')
    .update(encoded)
    .digest('base64url')
}

function credentialTag(apiKey: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('netrin-ai-provider-credential\0')
    .update(apiKey)
    .digest('base64url')
}

export function createCapabilityToken(
  payload: Omit<CapabilityTokenPayload, 'purpose' | 'credentialTag' | 'expiresAt'> & { apiKey: string },
  secret: string,
  now = Date.now(),
  ttlMs = 60 * 60_000
): { token: string; expiresAt: number } {
  const expiresAt = now + ttlMs
  const { apiKey, ...safePayload } = payload
  const encoded = Buffer.from(JSON.stringify({
    purpose: 'custom-provider-capability',
    ...safePayload,
    credentialTag: credentialTag(apiKey, secret),
    expiresAt
  })).toString('base64url')
  return { token: `${encoded}.${sign(encoded, secret)}`, expiresAt }
}

export function verifyCapabilityToken(
  token: string,
  secret: string,
  expected: Pick<CapabilityTokenPayload, 'userId' | 'baseUrl' | 'modelId'> & { apiKey: string },
  now = Date.now()
): CapabilityTokenPayload {
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) throw new AiRouteError('AI_MODEL_PROBE_REQUIRED', 400)
  const expectedSignature = Buffer.from(sign(encoded, secret))
  const actualSignature = Buffer.from(signature)
  if (actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)) {
    throw new AiRouteError('AI_MODEL_PROBE_REQUIRED', 400)
  }
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new AiRouteError('AI_MODEL_PROBE_REQUIRED', 400)
  }
  if (!payload || typeof payload !== 'object') throw new AiRouteError('AI_MODEL_PROBE_REQUIRED', 400)
  const parsed = payload as Partial<CapabilityTokenPayload>
  if (parsed.purpose !== 'custom-provider-capability' ||
      parsed.userId !== expected.userId ||
      parsed.baseUrl !== expected.baseUrl ||
      parsed.modelId !== expected.modelId ||
      parsed.credentialTag !== credentialTag(expected.apiKey, secret) ||
      typeof parsed.maxContextTokens !== 'number' ||
      typeof parsed.expiresAt !== 'number') {
    throw new AiRouteError('AI_MODEL_PROBE_REQUIRED', 400)
  }
  if (parsed.expiresAt <= now) throw new AiRouteError('AI_MODEL_PROBE_EXPIRED', 400)
  return parsed as CapabilityTokenPayload
}
