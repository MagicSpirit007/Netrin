import type {
  ModelCatalogRequest,
  ProviderModelDescriptor
} from '../contracts/aiRoute.js'
import { AiRouteError } from '../errors.js'
import { validateCustomModelId } from './customEndpoint.js'
import type { ProviderEgress } from './egressBroker.js'

const MAX_CATALOG_BYTES = 1024 * 1024
const MAX_MODELS = 500

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MAX_CATALOG_BYTES) throw new AiRouteError('AI_MODEL_CATALOG_UNAVAILABLE', 502)
  if (!response.body) return response.json()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_CATALOG_BYTES) {
      await reader.cancel()
      throw new AiRouteError('AI_MODEL_CATALOG_UNAVAILABLE', 502)
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))))
  } catch {
    throw new AiRouteError('AI_MODEL_CATALOG_UNAVAILABLE', 502)
  }
}

export function parseCustomCatalog(value: unknown): ProviderModelDescriptor[] {
  const data = object(value)?.data
  if (!Array.isArray(data)) throw new AiRouteError('AI_MODEL_CATALOG_UNAVAILABLE', 502)
  const seen = new Set<string>()
  const models: ProviderModelDescriptor[] = []
  for (const item of data) {
    const rawId = object(item)?.id
    if (typeof rawId !== 'string') continue
    let modelId: string
    try { modelId = validateCustomModelId(rawId) } catch { continue }
    if (seen.has(modelId)) continue
    seen.add(modelId)
    models.push({
      modelId,
      displayName: modelId,
      toolCalling: null,
      source: 'provider'
    })
    if (models.length >= MAX_MODELS) break
  }
  return models
}

export interface ProviderCatalogService {
  load(request: ModelCatalogRequest, signal?: AbortSignal): Promise<ProviderModelDescriptor[]>
}

export class DefaultProviderCatalogService implements ProviderCatalogService {
  readonly #egress: ProviderEgress
  readonly #fetch: typeof fetch

  constructor(egress: ProviderEgress, fetchImpl: typeof fetch = fetch) {
    this.#egress = egress
    this.#fetch = fetchImpl
  }

  async load(request: ModelCatalogRequest, signal?: AbortSignal): Promise<ProviderModelDescriptor[]> {
    const lease = await this.#egress.lease(request.baseUrl, signal)
    try {
      const response = await this.#fetch(`${lease.baseUrl}/models`, {
        signal,
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${request.apiKey}`,
          accept: 'application/json'
        }
      })
      if (response.status === 401 || response.status === 403) throw new AiRouteError('AI_PROVIDER_AUTH_FAILED', 401)
      if (response.status === 429) throw new AiRouteError('AI_PROVIDER_QUOTA_EXHAUSTED', 429)
      if (!response.ok) throw new AiRouteError('AI_MODEL_CATALOG_UNAVAILABLE', 502)
      return parseCustomCatalog(await readLimitedJson(response))
    } catch (error) {
      if (error instanceof AiRouteError) throw error
      if (signal?.aborted) throw new AiRouteError('AI_ABORTED', 499)
      throw new AiRouteError('AI_MODEL_CATALOG_UNAVAILABLE', 502)
    } finally {
      lease.revoke()
    }
  }
}
