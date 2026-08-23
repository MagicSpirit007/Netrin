import { createHmac, timingSafeEqual } from 'node:crypto'
import { AiRouteError } from '../errors.js'

export type OptionRefPayload = {
  analyzeRequestId: string
  candidateId: string
  poiId: string
  region: string
  expiresAt: number
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

export function createOptionRef(
  payload: Omit<OptionRefPayload, 'expiresAt'>,
  secret: string,
  now = Date.now(),
  ttlMs = 15 * 60_000
): string {
  const encodedPayload = encode(JSON.stringify({ ...payload, expiresAt: now + ttlMs }))
  return `${encodedPayload}.${sign(encodedPayload, secret)}`
}

export function verifyOptionRef(
  optionRef: string,
  secret: string,
  expected: Pick<OptionRefPayload, 'analyzeRequestId' | 'candidateId'>,
  now = Date.now()
): OptionRefPayload {
  const [encodedPayload, encodedSignature, extra] = optionRef.split('.')
  if (!encodedPayload || !encodedSignature || extra) {
    throw new AiRouteError('AI_OPTION_REF_INVALID', 400)
  }
  const expectedSignature = Buffer.from(sign(encodedPayload, secret))
  const actualSignature = Buffer.from(encodedSignature)
  if (actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)) {
    throw new AiRouteError('AI_OPTION_REF_INVALID', 400)
  }
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    throw new AiRouteError('AI_OPTION_REF_INVALID', 400)
  }
  if (!payload || typeof payload !== 'object') throw new AiRouteError('AI_OPTION_REF_INVALID', 400)
  const parsed = payload as Partial<OptionRefPayload>
  if (typeof parsed.analyzeRequestId !== 'string' ||
      typeof parsed.candidateId !== 'string' ||
      typeof parsed.poiId !== 'string' ||
      typeof parsed.region !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.analyzeRequestId !== expected.analyzeRequestId ||
      parsed.candidateId !== expected.candidateId) {
    throw new AiRouteError('AI_OPTION_REF_INVALID', 400)
  }
  if (parsed.expiresAt <= now) throw new AiRouteError('AI_OPTION_REF_EXPIRED', 400)
  return parsed as OptionRefPayload
}
