import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import type { AuthenticatedUser, UserAuthenticator } from '../../src/auth.js'
import {
  AI_ROUTE_HARNESS_VERSION,
  AI_ROUTE_PROMPT_VERSION
} from '../../src/contracts/aiRoute.js'
import { AiRouteError } from '../../src/errors.js'
import { RequestLimiter } from '../../src/limits.js'
import { MemoryMetricSink } from '../../src/observability/safeMetrics.js'
import { createCapabilityToken } from '../../src/providers/capabilityToken.js'
import type { RequestCredential } from '../../src/providers/credentialScope.js'
import type { PiRuntime } from '../../src/providers/piAdapter.js'
import {
  handleRequest,
  startServer,
  type ServerDependencies
} from '../../src/server.js'
import type { PoiProvider, TrustedPoi } from '../../src/tools/amapPoi.js'
import { createOptionRef } from '../../src/tools/optionRefs.js'

const signingKey = 'a-signing-secret-that-is-longer-than-32-characters'

class Auth implements UserAuthenticator {
  async authenticate(): Promise<AuthenticatedUser> {
    return { id: 'user-1', anonymousId: 'anon-1', accessToken: 'user-jwt' }
  }
}

class Pois implements PoiProvider {
  readonly byId = new Map<string, TrustedPoi>([
    ['poi-a', { poiId: 'poi-a', name: '西湖', district: '杭州市', wgs84: [120.14, 30.25] }],
    ['poi-b', { poiId: 'poi-b', name: '植物园', district: '杭州市', wgs84: [120.12, 30.26] }]
  ])
  async search() { return [] }
  resolveAgentRef() { return undefined }
  async getById(id: string) {
    const poi = this.byId.get(id)
    if (!poi) throw new Error('missing')
    return poi
  }
}

function dependencies(metrics = new MemoryMetricSink()): ServerDependencies {
  return {
    config: {
      port: 8787,
      allowedOrigins: new Set(['http://localhost:5173']),
      amapWebServiceKey: 'server-amap-key',
      optionSigningKey: signingKey,
      supabaseUrl: 'https://supabase.example',
      supabaseAnonKey: 'public-anon-key',
      routePlanUrl: 'https://supabase.example/functions/v1/netrin-route-plan',
      qwenBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      fileInputEnabled: false,
      customProviderEnabled: false
    },
    auth: new Auth(),
    limiter: new RequestLimiter(),
    catalogLimiter: new RequestLimiter(),
    probeLimiter: new RequestLimiter(),
    metrics,
    createPoi: () => new Pois(),
    createPi: () => ({}) as PiRuntime,
    runAgent: async () => ({
      harnessVersion: AI_ROUTE_HARNESS_VERSION,
      promptVersion: AI_ROUTE_PROMPT_VERSION,
      candidates: [],
      proposedOrder: [],
      warnings: [],
      normalizedConstraints: {
        region: '杭州市',
        travelMode: 'walking',
        maximumStops: 4
      },
      budget: { modelTurns: 1, toolCalls: 1, poiSearchCalls: 1, totalTokens: 10, exhausted: false },
      state: 'resolved'
    }),
    routePlanner: {
      async plan(stops) {
        return {
          geometry: { type: 'LineString', coordinates: stops },
          distanceMeters: 1234,
          durationMinutes: 25
        }
      }
    },
    providerEgress: {
      async lease() { throw new Error('unexpected egress') }
    },
    providerCatalog: {
      async load() { return [] }
    },
    providerProbe: {
      async probe() { throw new Error('unexpected probe') }
    },
    now: () => 1_000
  }
}

describe('AI route HTTP API', () => {
  it('reports actual server input capabilities and file limits', async () => {
    const deps = dependencies()
    deps.config.fileInputEnabled = true
    const response = await handleRequest(new Request('http://service/v1/ai-route/providers'), deps)
    const body = await response.json() as {
      supportedInputKinds: string[]
      fileLimits: { documentBytes: number; totalBytes: number; maxPdfPages: number; maxTextChars: number }
    }
    expect(body.supportedInputKinds).toEqual(['prompt', 'file'])
    expect(body.fileLimits).toEqual({
      documentBytes: 10 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024,
      maxPdfPages: 30,
      maxTextChars: 100_000
    })
  })

  it('reports only fixed providers plus the explicit custom endpoint policy', async () => {
    const deps = dependencies()
    deps.config.customProviderEnabled = true
    const response = await handleRequest(new Request('http://service/v1/ai-route/providers'), deps)
    const body = await response.json() as {
      contractVersion: string
      providers: Array<{ providerId: string; modelSource: string }>
      customProviderPolicy: { enabled: boolean; httpsOnly: boolean; customHeadersAllowed: boolean }
    }
    expect(body.contractVersion).toBe('1.3.0')
    expect(body.providers.map((provider) => provider.providerId)).toEqual([
      'deepseek-cn', 'qwen-cn', 'kimi-cn'
    ])
    expect(body.providers.every((provider) => provider.modelSource === 'fixed')).toBe(true)
    expect(body.customProviderPolicy).toMatchObject({
      enabled: true, httpsOnly: true, customHeadersAllowed: false
    })
  })

  it('authenticates catalog requests before parsing or contacting a provider', async () => {
    const deps = dependencies()
    deps.config.customProviderEnabled = true
    let externalCalls = 0
    deps.providerCatalog = { async load() { externalCalls += 1; return [] } }
    deps.auth = {
      async authenticate() { throw new AiRouteError('AI_AUTH_REQUIRED', 401) }
    }
    const response = await handleRequest(new Request('http://service/v1/ai-route/model-catalog', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{malformed-with-sensitive-content'
    }), deps)
    expect(response.status).toBe(401)
    expect(externalCalls).toBe(0)
    expect(await response.text()).not.toContain('sensitive-content')
  })

  it('returns a filtered custom catalog without exposing endpoint credentials', async () => {
    const deps = dependencies()
    deps.config.customProviderEnabled = true
    deps.providerCatalog = {
      async load(request) {
        expect(request).toEqual({
          providerId: 'custom-openai',
          baseUrl: 'https://llm.example.com/v1',
          apiKey: 'custom-catalog-secret'
        })
        return [{
          modelId: 'vendor/tool-model', displayName: 'Tool model', toolCalling: true,
          contextTokens: 64_000, source: 'provider'
        }]
      }
    }
    const response = await handleRequest(new Request('http://service/v1/ai-route/model-catalog', {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'custom-openai',
        baseUrl: 'https://llm.example.com/v1',
        apiKey: 'custom-catalog-secret'
      })
    }), deps)
    const responseText = await response.text()
    expect(response.status).toBe(200)
    expect(JSON.parse(responseText)).toMatchObject({
      contractVersion: '1.3.0',
      providerId: 'custom-openai',
      models: [{ modelId: 'vendor/tool-model', toolCalling: true }]
    })
    expect(responseText).not.toContain('custom-catalog-secret')
  })

  it('uses a valid custom probe token through the loopback lease and redacts endpoint details', async () => {
    const metrics = new MemoryMetricSink()
    const deps = dependencies(metrics)
    deps.config.customProviderEnabled = true
    const baseUrl = 'https://llm.example.com/v1'
    const apiKey = 'custom-request-secret'
    const capabilityToken = createCapabilityToken({
      userId: 'user-1', baseUrl, modelId: 'tool-model', apiKey,
      maxContextTokens: 32_768
    }, signingKey, deps.now()).token
    let revoked = false
    let capturedBaseUrl = ''
    deps.providerEgress = {
      async lease(target) {
        expect(target).toBe(baseUrl)
        return {
          baseUrl: 'http://127.0.0.1:43210/one-time-lease/v1',
          normalizedTarget: baseUrl,
          revoke: () => { revoked = true }
        }
      }
    }
    deps.createPi = (provider) => {
      capturedBaseUrl = provider.baseUrl
      expect(provider.providerId).toBe('custom-openai')
      return {} as PiRuntime
    }
    const body = JSON.stringify({
      provider: { providerId: 'custom-openai', modelId: 'tool-model', apiKey, baseUrl, capabilityToken },
      input: { kind: 'prompt', text: '杭州植物路线' },
      constraints: { region: '杭州市', travelMode: 'walking', maximumStops: 4 },
      locale: 'zh-CN'
    })
    const response = await handleRequest(new Request('http://service/v1/ai-route/analyze', {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body
    }), deps)
    const responseText = await response.text()
    expect(response.status).toBe(200)
    expect(capturedBaseUrl).toBe('http://127.0.0.1:43210/one-time-lease/v1')
    expect(revoked).toBe(true)
    expect(responseText).not.toContain(apiKey)
    expect(responseText).not.toContain(baseUrl)
    const metricText = JSON.stringify(metrics.records)
    expect(metricText).toContain('custom-openai')
    expect(metricText).not.toContain('tool-model')
    expect(metricText).not.toContain(baseUrl)
    expect(metricText).not.toContain(apiKey)
  })

  it('rejects a changed custom key before creating an outbound lease', async () => {
    const deps = dependencies()
    deps.config.customProviderEnabled = true
    const baseUrl = 'https://llm.example.com/v1'
    const capabilityToken = createCapabilityToken({
      userId: 'user-1', baseUrl, modelId: 'tool-model', apiKey: 'original-key',
      maxContextTokens: 32_768
    }, signingKey, deps.now()).token
    let leaseCalls = 0
    deps.providerEgress = {
      async lease() {
        leaseCalls += 1
        throw new Error('must not lease')
      }
    }
    const body = JSON.stringify({
      provider: {
        providerId: 'custom-openai', modelId: 'tool-model', apiKey: 'changed-key', baseUrl, capabilityToken
      },
      input: { kind: 'prompt', text: 'route' },
      constraints: { region: '杭州市', travelMode: 'walking', maximumStops: 4 },
      locale: 'zh-CN'
    })
    const response = await handleRequest(new Request('http://service/v1/ai-route/analyze', {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body
    }), deps)
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('AI_MODEL_PROBE_REQUIRED')
    expect(leaseCalls).toBe(0)
  })

  it('returns a custom probe result without echoing key, base URL, or raw provider details', async () => {
    const deps = dependencies()
    deps.config.customProviderEnabled = true
    deps.providerProbe = {
      async probe(request, userId) {
        expect(request.apiKey).toBe('custom-probe-secret')
        expect(userId).toBe('user-1')
        return {
          contractVersion: '1.3.0', capabilityToken: 'safe.signed-token', expiresAt: 3_601_000,
          capabilities: { toolCalling: true, maxContextTokens: 32_768 }
        }
      }
    }
    const response = await handleRequest(new Request('http://service/v1/ai-route/provider-probe', {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'custom-openai', baseUrl: 'https://llm.example.com/v1',
        modelId: 'tool-model', apiKey: 'custom-probe-secret'
      })
    }), deps)
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(text).toContain('safe.signed-token')
    expect(text).not.toContain('custom-probe-secret')
    expect(text).not.toContain('llm.example.com')
  })

  it('analyzes a JSON prompt without retaining the BYOK key in metrics or closure', async () => {
    const metrics = new MemoryMetricSink()
    const deps = dependencies(metrics)
    let captured: RequestCredential | undefined
    deps.createPi = (_provider, _modelId, credential) => {
      captured = credential
      expect(credential.getApiKey()).toBe('top-secret-byok')
      return {} as PiRuntime
    }
    const body = JSON.stringify({
      provider: {
        providerId: 'deepseek-cn',
        modelId: 'deepseek-v4-flash',
        apiKey: 'top-secret-byok'
      },
      input: { kind: 'prompt', text: '杭州植物路线' },
      constraints: { region: '杭州市', travelMode: 'walking', maximumStops: 4 },
      locale: 'zh-CN'
    })
    const response = await handleRequest(new Request('http://service/v1/ai-route/analyze', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        authorization: 'Bearer user-jwt',
        'content-type': 'application/json'
      },
      body
    }), deps)
    expect(response.status).toBe(200)
    expect(captured?.getApiKey()).toBe('')
    expect(JSON.stringify(metrics.records)).not.toContain('top-secret-byok')
    expect(await response.text()).not.toContain('top-secret-byok')
  })

  it('maps raw provider failures to a stable error without leaking the BYOK key', async () => {
    const deps = dependencies()
    deps.runAgent = async () => {
      throw new Error('provider rejected top-secret-byok in raw response')
    }
    const body = JSON.stringify({
      provider: {
        providerId: 'deepseek-cn',
        modelId: 'deepseek-v4-flash',
        apiKey: 'top-secret-byok'
      },
      input: { kind: 'prompt', text: '杭州植物路线' },
      constraints: { region: '杭州市', travelMode: 'walking', maximumStops: 4 },
      locale: 'zh-CN'
    })
    const response = await handleRequest(new Request('http://service/v1/ai-route/analyze', {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body
    }), deps)
    const text = await response.text()
    expect(response.status).toBe(500)
    expect(text).toContain('AI_INTERNAL_ERROR')
    expect(text).not.toContain('top-secret-byok')
  })

  it('passes extracted local file text only and returns filename-only provenance', async () => {
    const deps = dependencies()
    deps.config.fileInputEnabled = true
    let captured: Parameters<ServerDependencies['runAgent']>[0] | undefined
    deps.runAgent = async (input) => {
      captured = input
      return dependencies().runAgent(input)
    }
    const requestBody = JSON.stringify({
      provider: { providerId: 'qwen-cn', modelId: 'qwen3.8-max', apiKey: 'qwen-secret' },
      input: {
        kind: 'file',
        extractedText: '西湖植物路线',
        sourceFiles: [{ displayName: '路线说明.pdf', mediaType: 'application/pdf', byteSize: 100 }]
      },
      constraints: { region: '杭州市', travelMode: 'walking', maximumStops: 4 },
      locale: 'zh-CN'
    })
    const response = await handleRequest(new Request('http://service/v1/ai-route/analyze', {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body: requestBody
    }), deps)
    const body = await response.json() as { inputSummary: unknown }
    expect(response.status).toBe(200)
    expect(captured).toMatchObject({ sourceKind: 'file', sourceText: '西湖植物路线' })
    expect(body.inputSummary).toEqual({
      kind: 'file', sourceRefs: [{ kind: 'file', displayName: '路线说明.pdf' }]
    })
    expect(JSON.stringify(body)).not.toContain('qwen-secret')
  })

  it('rejects removed URL, vision, and multipart request surfaces', async () => {
    const deps = dependencies()
    deps.config.fileInputEnabled = true
    const base = {
      provider: { providerId: 'deepseek-cn', modelId: 'deepseek-v4-flash', apiKey: 'secret' },
      constraints: { region: '杭州市', travelMode: 'walking', maximumStops: 4 },
      locale: 'zh-CN'
    }
    const postJson = (input: unknown) => handleRequest(new Request('http://service/v1/ai-route/analyze', {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({ ...base, input })
    }), deps)
    const urlResponse = await postJson({ kind: 'url', url: 'https://example.com/private' })
    expect(await urlResponse.text()).toContain('AI_REQUEST_INVALID')
    const visionResponse = await postJson({
      kind: 'file',
      extractedText: 'route',
      sourceFiles: [{ displayName: 'a.pdf', mediaType: 'application/pdf', byteSize: 4 }],
      imageRecognition: 'provider-vision',
      imagePartIds: ['a']
    })
    expect(await visionResponse.text()).toContain('AI_REQUEST_INVALID')

    const multipart = new FormData()
    multipart.set('request', JSON.stringify({ ...base, input: { kind: 'prompt', text: 'route' } }))
    const multipartResponse = await handleRequest(new Request('http://service/v1/ai-route/analyze', {
      method: 'POST', headers: { authorization: 'Bearer user-jwt' }, body: multipart
    }), deps)
    expect(await multipartResponse.text()).toContain('AI_REQUEST_INVALID')
  })

  it('authenticates before parsing a malformed analyze body', async () => {
    const deps = dependencies()
    deps.auth = {
      async authenticate() { throw new AiRouteError('AI_AUTH_REQUIRED', 401) }
    }
    const response = await handleRequest(new Request('http://service/v1/ai-route/analyze', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=broken' },
      body: 'unparseable-body-with-sensitive-content'
    }), deps)
    const text = await response.text()
    expect(response.status).toBe(401)
    expect(text).toContain('AI_AUTH_REQUIRED')
    expect(text).not.toContain('sensitive-content')
  })

  it('revalidates signed options and produces trusted planned geometry', async () => {
    const analyzeRequestId = 'analysis-1'
    const option = (candidateId: string, poiId: string) => createOptionRef({
      analyzeRequestId,
      candidateId,
      poiId,
      region: '杭州市'
    }, signingKey, 1_000, 10_000)
    const response = await handleRequest(new Request('http://service/v1/ai-route/plan', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        authorization: 'Bearer user-jwt',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        analyzeRequestId,
        constraints: { region: '杭州市', travelMode: 'walking', maximumStops: 4 },
        selectedStops: [
          {
            candidateId: 'a',
            optionRef: option('a', 'poi-a'),
            intent: { reason: '湖滨', priority: 'required' }
          },
          {
            candidateId: 'b',
            optionRef: option('b', 'poi-b'),
            intent: { reason: '植物', priority: 'preferred' }
          }
        ],
        proposedOrder: ['a', 'b']
      })
    }), dependencies())
    const body = await response.json() as { canConfirmGeometry: boolean; stops: unknown[] }
    expect(response.status).toBe(200)
    expect(body.canConfirmGeometry).toBe(true)
    expect(body.stops).toHaveLength(2)
  })

  it('rejects a tampered optionRef and returns no raw token data', async () => {
    const response = await handleRequest(new Request('http://service/v1/ai-route/plan', {
      method: 'POST',
      headers: {
        authorization: 'Bearer user-jwt',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        analyzeRequestId: 'analysis-1',
        constraints: { region: '杭州市', travelMode: 'walking', maximumStops: 4 },
        selectedStops: [
          {
            candidateId: 'a',
            optionRef: 'tampered.value',
            intent: { reason: '湖滨', priority: 'required' }
          },
          {
            candidateId: 'b',
            optionRef: 'tampered.value',
            intent: { reason: '植物', priority: 'preferred' }
          }
        ],
        proposedOrder: ['a', 'b']
      })
    }), dependencies())
    expect(response.status).toBe(400)
    const text = await response.text()
    expect(text).toContain('AI_OPTION_REF_INVALID')
    expect(text).not.toContain('tampered.value')
  })

  it('returns trusted key points but no confirmable geometry when routing fails', async () => {
    const deps = dependencies()
    deps.routePlanner = {
      async plan() {
        throw new AiRouteError('AI_ROUTE_UNREACHABLE', 422)
      }
    }
    const analyzeRequestId = 'analysis-failed-route'
    const option = (candidateId: string, poiId: string) => createOptionRef({
      analyzeRequestId,
      candidateId,
      poiId,
      region: '杭州市'
    }, signingKey, 1_000, 10_000)
    const response = await handleRequest(new Request('http://service/v1/ai-route/plan', {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({
        analyzeRequestId,
        constraints: { region: '杭州市', travelMode: 'walking', maximumStops: 4 },
        selectedStops: [
          { candidateId: 'a', optionRef: option('a', 'poi-a'), intent: { reason: 'a', priority: 'required' } },
          { candidateId: 'b', optionRef: option('b', 'poi-b'), intent: { reason: 'b', priority: 'preferred' } }
        ],
        proposedOrder: ['a', 'b']
      })
    }), deps)
    const body = await response.json() as {
      stops: unknown[]
      geometryCandidate?: unknown
      canConfirmGeometry: boolean
      warnings: string[]
    }
    expect(response.status).toBe(200)
    expect(body.stops).toHaveLength(2)
    expect(body.geometryCandidate).toBeUndefined()
    expect(body.canConfirmGeometry).toBe(false)
    expect(body.warnings).toContain('AI_ROUTE_UNREACHABLE')
  })

  it('propagates a real HTTP client disconnect to the Agent abort signal', async () => {
    const deps = dependencies()
    deps.config.port = 0
    let markStarted!: () => void
    let markAborted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const aborted = new Promise<void>((resolve) => { markAborted = resolve })
    deps.runAgent = async ({ signal }) => new Promise((_resolve, reject) => {
      markStarted()
      signal?.addEventListener('abort', () => {
        markAborted()
        reject(new AiRouteError('AI_ABORTED', 499))
      }, { once: true })
    })
    const server = startServer(deps)
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    const body = JSON.stringify({
      provider: {
        providerId: 'deepseek-cn',
        modelId: 'deepseek-v4-flash',
        apiKey: 'request-only-key'
      },
      input: { kind: 'prompt', text: '杭州植物路线' },
      constraints: { region: '杭州市', travelMode: 'walking', maximumStops: 4 },
      locale: 'zh-CN'
    })
    const controller = new AbortController()
    const request = fetch(`http://127.0.0.1:${address.port}/v1/ai-route/analyze`, {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body,
      signal: controller.signal
    })
    await started
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await aborted
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  })
})
