import type {
  AiRouteErrorResponse,
  AnalyzeRequest,
  AnalyzeResponse,
  ModelCatalogRequest,
  ModelCatalogResponse,
  PlanRequest,
  PlanResponse,
  ProviderCapabilities,
  ProviderProbeRequest,
  ProviderProbeResponse,
  ProviderRegistryResponse
} from './contracts'
import { AI_ROUTE_FILE_LIMITS } from './contracts'

export const aiRouteApiBase = (import.meta.env.VITE_AI_ROUTE_API_BASE ?? '').trim().replace(/\/+$/, '')

export class AiRouteClientError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'AiRouteClientError'
    this.code = code
  }
}

async function decode<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => undefined) as T | AiRouteErrorResponse | undefined
  if (!response.ok) {
    const code = body && typeof body === 'object' && 'error' in body
      ? (body as AiRouteErrorResponse).error.code
      : 'AI_INTERNAL_ERROR'
    throw new AiRouteClientError(code)
  }
  return body as T
}

export function resolveAiRouteEndpoint(path: string, apiBase = aiRouteApiBase): string {
  if (!path.startsWith('/v1/ai-route/')) throw new AiRouteClientError('AI_REQUEST_INVALID')
  return `${apiBase.replace(/\/+$/, '')}${path}`
}

export async function loadAiRouteProviders(signal?: AbortSignal): Promise<ProviderRegistryResponse> {
  const response = await fetch(resolveAiRouteEndpoint('/v1/ai-route/providers'), {
    signal,
    headers: { accept: 'application/json' },
    cache: 'no-store'
  })
  const result = await decode<LegacyProviderRegistryResponse>(response)
  return normalizeProviderRegistry(result)
}

type LegacyProviderCapabilities = Omit<ProviderCapabilities, 'modelSource'> & {
  modelSource?: ProviderCapabilities['modelSource']
}

type LegacyProviderRegistryResponse = Omit<Partial<ProviderRegistryResponse>, 'providers'> & {
  contractVersion: string
  providers: LegacyProviderCapabilities[]
}

export function normalizeProviderRegistry(
  result: LegacyProviderRegistryResponse
): ProviderRegistryResponse {
  return {
    ...result,
    supportedInputKinds: result.supportedInputKinds ?? ['prompt'],
    fileLimits: result.fileLimits ?? AI_ROUTE_FILE_LIMITS,
    providers: result.providers.map((provider) => ({
      ...provider,
      modelSource: provider.modelSource ?? 'fixed'
    }))
  }
}

export async function loadProviderModelCatalog(
  request: ModelCatalogRequest,
  accessToken: string,
  signal?: AbortSignal
): Promise<ModelCatalogResponse> {
  const response = await fetch(resolveAiRouteEndpoint('/v1/ai-route/model-catalog'), {
    method: 'POST',
    signal,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(request),
    cache: 'no-store'
  })
  return decode(response)
}

export async function probeCustomProvider(
  request: ProviderProbeRequest,
  accessToken: string,
  signal?: AbortSignal
): Promise<ProviderProbeResponse> {
  const response = await fetch(resolveAiRouteEndpoint('/v1/ai-route/provider-probe'), {
    method: 'POST',
    signal,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(request),
    cache: 'no-store'
  })
  return decode(response)
}

export async function analyzeAiRoute(
  request: AnalyzeRequest,
  accessToken: string,
  signal?: AbortSignal
): Promise<AnalyzeResponse> {
  const response = await fetch(resolveAiRouteEndpoint('/v1/ai-route/analyze'), {
    method: 'POST',
    signal,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(request),
    cache: 'no-store'
  })
  return decode(response)
}

export async function planAiRoute(
  request: PlanRequest,
  accessToken: string,
  signal?: AbortSignal
): Promise<PlanResponse> {
  const response = await fetch(resolveAiRouteEndpoint('/v1/ai-route/plan'), {
    method: 'POST',
    signal,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(request),
    cache: 'no-store'
  })
  return decode(response)
}
