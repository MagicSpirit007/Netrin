import { randomBytes } from 'node:crypto'
import type { ProviderProbeRequest, ProviderProbeResponse } from '../contracts/aiRoute.js'
import { AI_ROUTE_CONTRACT_VERSION } from '../contracts/aiRoute.js'
import { AiRouteError } from '../errors.js'
import { createCapabilityToken } from './capabilityToken.js'
import { normalizedCustomBaseUrl, validateCustomModelId } from './customEndpoint.js'
import type { ProviderEgress } from './egressBroker.js'

const DEFAULT_CUSTOM_CONTEXT_TOKENS = 32_768
const MAX_PROBE_RESPONSE_BYTES = 1024 * 1024

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

function validProbeResponse(value: unknown, nonce: string): boolean {
  const choices = object(value)?.choices
  if (!Array.isArray(choices) || choices.length < 1) return false
  const message = object(object(choices[0])?.message)
  const calls = message?.tool_calls
  if (!Array.isArray(calls)) return false
  return calls.some((entry) => {
    const fn = object(object(entry)?.function)
    if (fn?.name !== 'netrin_capability_probe') return false
    if (typeof fn.arguments !== 'string' || fn.arguments.length > 4_096) return false
    try {
      return object(JSON.parse(fn.arguments))?.nonce === nonce
    } catch {
      return false
    }
  })
}

export interface ProviderProbeService {
  probe(
    request: ProviderProbeRequest,
    userId: string,
    signingKey: string,
    signal?: AbortSignal,
    now?: number
  ): Promise<ProviderProbeResponse>
}

export class DefaultProviderProbeService implements ProviderProbeService {
  readonly #egress: ProviderEgress
  readonly #fetch: typeof fetch

  constructor(egress: ProviderEgress, fetchImpl: typeof fetch = fetch) {
    this.#egress = egress
    this.#fetch = fetchImpl
  }

  async probe(
    request: ProviderProbeRequest,
    userId: string,
    signingKey: string,
    signal?: AbortSignal,
    now = Date.now()
  ): Promise<ProviderProbeResponse> {
    const baseUrl = normalizedCustomBaseUrl(request.baseUrl)
    const modelId = validateCustomModelId(request.modelId)
    const lease = await this.#egress.lease(baseUrl, signal)
    const nonce = randomBytes(24).toString('base64url')
    try {
      const response = await this.#fetch(`${lease.baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${request.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: `Call netrin_capability_probe with nonce ${nonce}.` }],
          tools: [{
            type: 'function',
            function: {
              name: 'netrin_capability_probe',
              description: 'Return the supplied nonce to prove function calling compatibility.',
              parameters: {
                type: 'object',
                properties: { nonce: { type: 'string' } },
                required: ['nonce'],
                additionalProperties: false
              }
            }
          }],
          tool_choice: { type: 'function', function: { name: 'netrin_capability_probe' } },
          max_tokens: 32,
          stream: false
        })
      })
      if (response.status === 401 || response.status === 403) throw new AiRouteError('AI_PROVIDER_AUTH_FAILED', 401)
      if (response.status === 429) throw new AiRouteError('AI_PROVIDER_QUOTA_EXHAUSTED', 429)
      if (!response.ok) throw new AiRouteError('AI_MODEL_PROBE_FAILED', 422)
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (declared > MAX_PROBE_RESPONSE_BYTES) throw new AiRouteError('AI_PROVIDER_RESPONSE_INVALID', 502)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > MAX_PROBE_RESPONSE_BYTES) throw new AiRouteError('AI_PROVIDER_RESPONSE_INVALID', 502)
      let body: unknown
      try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch {
        throw new AiRouteError('AI_PROVIDER_RESPONSE_INVALID', 502)
      }
      if (!validProbeResponse(body, nonce)) throw new AiRouteError('AI_MODEL_PROBE_FAILED', 422)
      const signed = createCapabilityToken({
        userId,
        baseUrl,
        modelId,
        apiKey: request.apiKey,
        maxContextTokens: DEFAULT_CUSTOM_CONTEXT_TOKENS
      }, signingKey, now)
      return {
        contractVersion: AI_ROUTE_CONTRACT_VERSION,
        capabilityToken: signed.token,
        expiresAt: signed.expiresAt,
        capabilities: {
          toolCalling: true,
          maxContextTokens: DEFAULT_CUSTOM_CONTEXT_TOKENS
        }
      }
    } catch (error) {
      if (error instanceof AiRouteError) throw error
      if (signal?.aborted) throw new AiRouteError('AI_ABORTED', 499)
      throw new AiRouteError('AI_MODEL_PROBE_FAILED', 422)
    } finally {
      lease.revoke()
    }
  }
}
