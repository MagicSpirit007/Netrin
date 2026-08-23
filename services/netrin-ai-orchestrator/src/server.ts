import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { isIP, type AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import {
  AI_ROUTE_CONTRACT_VERSION,
  AI_ROUTE_FILE_LIMITS,
  type AiProviderRequest,
  type AiInputSummary,
  type AnalyzeResponse,
  type ModelCatalogResponse,
  type PlanResponse
} from './contracts/aiRoute.js'
import { SupabaseUserAuthenticator, type UserAuthenticator } from './auth.js'
import { loadConfig, type OrchestratorConfig } from './config.js'
import { AiRouteError, asAiRouteError, errorResponse } from './errors.js'
import { DEFAULT_ROUTE_AGENT_LIMITS } from './harness/budgets.js'
import { buildTimeWarnings, orderResolvedStops, type ResolvedStop } from './harness/ordering.js'
import { runRouteAgent, type RouteAgentInput, type RouteAgentOutput } from './harness/routeAgent.js'
import {
  parseAnalyzeRequest,
  parseModelCatalogRequest,
  parsePlanRequest,
  parseProviderProbeRequest
} from './harness/validators.js'
import { RequestLimiter } from './limits.js'
import { JsonSafeMetricSink, type SafeMetricSink } from './observability/safeMetrics.js'
import { withRequestCredential } from './providers/credentialScope.js'
import { verifyCapabilityToken } from './providers/capabilityToken.js'
import { LoopbackProviderEgressBroker, type ProviderEgress } from './providers/egressBroker.js'
import { DefaultProviderCatalogService, type ProviderCatalogService } from './providers/modelCatalog.js'
import { createPiRuntime, type PiRuntime, type PiRuntimeOptions } from './providers/piAdapter.js'
import { DefaultProviderProbeService, type ProviderProbeService } from './providers/providerProbe.js'
import {
  listProviderCapabilities,
  requireRegisteredProvider,
  type RegisteredProvider
} from './providers/registry.js'
import { AmapPoiClient, type PoiProvider } from './tools/amapPoi.js'
import { verifyOptionRef } from './tools/optionRefs.js'
import { NetrinRoutePlanClient, type RoutePlanner } from './tools/routePlanClient.js'

const MAX_JSON_REQUEST_BYTES = 256 * 1024
const MAX_PROVIDER_CONFIG_BYTES = 32 * 1024
const MAX_ANALYZE_REQUEST_BYTES = 1024 * 1024

export function requestIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp && isIP(realIp)) return realIp
  const forwarded = request.headers.get('x-forwarded-for')
    ?.split(',')
    .at(-1)
    ?.trim()
  return forwarded && isIP(forwarded) ? forwarded : 'unknown'
}

export type ServerDependencies = {
  config: OrchestratorConfig
  auth: UserAuthenticator
  limiter: RequestLimiter
  catalogLimiter: RequestLimiter
  probeLimiter: RequestLimiter
  metrics: SafeMetricSink
  createPoi: () => PoiProvider
  createPi: (
    provider: RegisteredProvider,
    modelId: string,
    credential: { getApiKey: () => string },
    options?: PiRuntimeOptions
  ) => PiRuntime
  runAgent: (input: RouteAgentInput) => Promise<RouteAgentOutput>
  routePlanner: RoutePlanner
  providerEgress: ProviderEgress
  providerCatalog: ProviderCatalogService
  providerProbe: ProviderProbeService
  now: () => number
}

export function createServerDependencies(config: OrchestratorConfig): ServerDependencies {
  const providerEgress = new LoopbackProviderEgressBroker()
  return {
    config,
    auth: new SupabaseUserAuthenticator(config.supabaseUrl, config.supabaseAnonKey),
    limiter: new RequestLimiter(),
    catalogLimiter: new RequestLimiter({ userPerMinute: 4, ipPerMinute: 12 }),
    probeLimiter: new RequestLimiter({ userPerMinute: 3, ipPerMinute: 10 }),
    metrics: new JsonSafeMetricSink(),
    createPoi: () => new AmapPoiClient(config.amapWebServiceKey),
    createPi: createPiRuntime,
    runAgent: runRouteAgent,
    routePlanner: new NetrinRoutePlanClient(config.routePlanUrl, config.supabaseAnonKey),
    providerEgress,
    providerCatalog: new DefaultProviderCatalogService(providerEgress),
    providerProbe: new DefaultProviderProbeService(providerEgress),
    now: Date.now
  }
}

function json(value: unknown, status = 200, origin?: string): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    pragma: 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  })
  if (origin) {
    headers.set('access-control-allow-origin', origin)
    headers.set('vary', 'Origin')
  }
  return new Response(JSON.stringify(value), { status, headers })
}

function allowedOrigin(request: Request, config: OrchestratorConfig): string | undefined {
  const origin = request.headers.get('origin') ?? undefined
  if (origin && !config.allowedOrigins.has(origin)) {
    throw new AiRouteError('AI_ORIGIN_NOT_ALLOWED', 403)
  }
  return origin
}

function requestSizeAllowed(request: Request, maximumBytes: number): void {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > maximumBytes) throw new AiRouteError('AI_REQUEST_TOO_LARGE', 413)
}

async function parseJson(request: Request): Promise<unknown> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw new AiRouteError('AI_REQUEST_INVALID', 400)
  }
  try {
    return await request.json()
  } catch {
    throw new AiRouteError('AI_REQUEST_INVALID', 400)
  }
}

type RuntimeProviderResolution = {
  provider: RegisteredProvider
  revoke?: () => void
}

async function resolveRuntimeProvider(
  selection: AiProviderRequest,
  userId: string,
  dependencies: ServerDependencies,
  signal: AbortSignal
): Promise<RuntimeProviderResolution> {
  if (selection.providerId === 'custom-openai') {
    const capabilities = verifyCapabilityToken(selection.capabilityToken, dependencies.config.optionSigningKey, {
      userId,
      baseUrl: selection.baseUrl,
      modelId: selection.modelId,
      apiKey: selection.apiKey
    }, dependencies.now())
    const lease = await dependencies.providerEgress.lease(selection.baseUrl, signal)
    return {
      provider: {
        providerId: 'custom-openai',
        displayName: 'Custom OpenAI-compatible',
        baseUrl: lease.baseUrl,
        allowedModelIds: [selection.modelId],
        modelSource: 'fixed',
        toolCalling: true,
        maxContextTokens: capabilities.maxContextTokens,
        supportsThinking: false
      },
      revoke: lease.revoke
    }
  }
  const registered = requireRegisteredProvider(selection.providerId, selection.modelId)
  return {
    provider: registered.providerId === 'qwen-cn'
      ? { ...registered, baseUrl: dependencies.config.qwenBaseUrl }
      : registered
  }
}

async function analyze(
  request: Request,
  requestId: string,
  dependencies: ServerDependencies
): Promise<AnalyzeResponse> {
  const startedAt = dependencies.now()
  requestSizeAllowed(request, MAX_ANALYZE_REQUEST_BYTES)
  const user = await dependencies.auth.authenticate(request.headers.get('authorization'), request.signal)
  return dependencies.limiter.run(user.id, requestIp(request), dependencies.now(), async () => {
    const parsed = parseAnalyzeRequest(await parseJson(request), {
      fileEnabled: dependencies.config.fileInputEnabled,
      customProviderEnabled: dependencies.config.customProviderEnabled
    })
    let resolution: RuntimeProviderResolution | undefined
    try {
      resolution = await resolveRuntimeProvider(parsed.provider, user.id, dependencies, request.signal)
      const provider = resolution.provider
      let sourceText: string
      let inputSummary: AiInputSummary
      if (parsed.input.kind === 'prompt') {
        sourceText = parsed.input.text
        inputSummary = { kind: 'prompt', sourceRefs: [] }
      } else {
        sourceText = parsed.input.extractedText
        inputSummary = {
          kind: 'file',
          sourceRefs: parsed.input.sourceFiles.map((file) => ({ kind: 'file', displayName: file.displayName }))
        }
      }
      const poi = dependencies.createPoi()
      let result: RouteAgentOutput
      result = await withRequestCredential(parsed.provider.apiKey, async (credential) => {
        const pi = dependencies.createPi(provider, parsed.provider.modelId, credential)
        return dependencies.runAgent({
          requestId,
          sourceKind: parsed.input.kind,
          sourceText,
          locale: parsed.locale,
          constraints: parsed.constraints,
          pi,
          poi,
          optionSigningKey: dependencies.config.optionSigningKey,
          signal: request.signal
        })
      })
      dependencies.metrics.record({
        requestId,
        anonymousUserId: user.anonymousId,
        route: 'analyze',
        outcome: 'success',
        durationMs: Math.max(0, dependencies.now() - startedAt),
        providerId: parsed.provider.providerId,
        ...(parsed.provider.providerId === 'custom-openai' ? {} : { modelId: parsed.provider.modelId }),
        modelTurns: result.budget.modelTurns,
        toolCalls: result.budget.toolCalls,
        candidateCount: result.candidates.length,
        ambiguityCount: result.candidates.filter((candidate) => candidate.requiresUserChoice).length,
        budgetExhausted: result.budget.exhausted
      })
      return {
        requestId,
        harnessVersion: result.harnessVersion,
        promptVersion: result.promptVersion,
        inputSummary,
        normalizedConstraints: result.normalizedConstraints,
        candidates: result.candidates,
        proposedOrder: result.proposedOrder,
        warnings: result.warnings
      }
    } finally {
      resolution?.revoke?.()
      parsed.provider.apiKey = ''
    }
  })
}

async function modelCatalog(
  request: Request,
  dependencies: ServerDependencies
): Promise<ModelCatalogResponse> {
  requestSizeAllowed(request, MAX_PROVIDER_CONFIG_BYTES)
  const user = await dependencies.auth.authenticate(request.headers.get('authorization'), request.signal)
  return dependencies.catalogLimiter.run(user.id, requestIp(request), dependencies.now(), async () => {
    const parsed = parseModelCatalogRequest(await parseJson(request), {
      customProviderEnabled: dependencies.config.customProviderEnabled
    })
    try {
      return {
        contractVersion: AI_ROUTE_CONTRACT_VERSION,
        providerId: parsed.providerId,
        models: await dependencies.providerCatalog.load(parsed, request.signal)
      }
    } finally {
      if (parsed.providerId === 'custom-openai') parsed.apiKey = ''
    }
  })
}

async function providerProbe(
  request: Request,
  dependencies: ServerDependencies
) {
  requestSizeAllowed(request, MAX_PROVIDER_CONFIG_BYTES)
  const user = await dependencies.auth.authenticate(request.headers.get('authorization'), request.signal)
  return dependencies.probeLimiter.run(user.id, requestIp(request), dependencies.now(), async () => {
    const parsed = parseProviderProbeRequest(
      await parseJson(request),
      dependencies.config.customProviderEnabled
    )
    try {
      return await dependencies.providerProbe.probe(
        parsed,
        user.id,
        dependencies.config.optionSigningKey,
        request.signal,
        dependencies.now()
      )
    } finally {
      parsed.apiKey = ''
    }
  })
}

async function plan(
  request: Request,
  requestId: string,
  dependencies: ServerDependencies
): Promise<PlanResponse> {
  const startedAt = dependencies.now()
  requestSizeAllowed(request, MAX_JSON_REQUEST_BYTES)
  const user = await dependencies.auth.authenticate(request.headers.get('authorization'), request.signal)
  return dependencies.limiter.run(user.id, requestIp(request), dependencies.now(), async () => {
    const parsed = parsePlanRequest(await parseJson(request))
    const poi = dependencies.createPoi()
    const resolved = await Promise.all(parsed.selectedStops.map(async (stop): Promise<ResolvedStop> => {
      const option = verifyOptionRef(stop.optionRef, dependencies.config.optionSigningKey, {
        analyzeRequestId: parsed.analyzeRequestId,
        candidateId: stop.candidateId
      }, dependencies.now())
      if (option.region !== parsed.constraints.region) {
        throw new AiRouteError('AI_OPTION_REF_INVALID', 400)
      }
      return {
        candidateId: stop.candidateId,
        poi: await poi.getById(option.poiId, option.region, request.signal),
        reason: stop.intent.reason,
        priority: stop.intent.priority,
        ...(stop.estimatedStayMinutes !== undefined
          ? { estimatedStayMinutes: stop.estimatedStayMinutes }
          : {}),
        ...(stop.userLockedOrder !== undefined ? { userLockedOrder: stop.userLockedOrder } : {})
      }
    }))
    const ordered = orderResolvedStops(resolved, parsed.proposedOrder)
    const routeCoordinates = ordered.map((stop) => stop.poi.wgs84)
    if (parsed.constraints.roundTrip) routeCoordinates.push(routeCoordinates[0])

    let route
    const warnings: string[] = []
    try {
      route = await dependencies.routePlanner.plan(
        routeCoordinates,
        parsed.constraints.travelMode,
        user.accessToken,
        request.signal
      )
    } catch (error) {
      const safe = asAiRouteError(error)
      if (!['AI_ROUTE_UNREACHABLE', 'AI_ROUTE_PROVIDER_UNAVAILABLE'].includes(safe.code)) throw safe
      warnings.push(safe.code)
    }
    const time = buildTimeWarnings(parsed.constraints, ordered, route?.durationMinutes ?? 0)
    warnings.push(...time.warnings)
    dependencies.metrics.record({
      requestId,
      anonymousUserId: user.anonymousId,
      route: 'plan',
      outcome: 'success',
      durationMs: Math.max(0, dependencies.now() - startedAt),
      candidateCount: ordered.length
    })
    return {
      requestId,
      stops: ordered.map((stop) => ({
        candidateId: stop.candidateId,
        name: stop.poi.name,
        reason: stop.reason,
        ...(stop.poi.category ? { category: stop.poi.category } : {}),
        ...(stop.poi.district ? { district: stop.poi.district } : {}),
        wgs84: stop.poi.wgs84,
        ...(stop.estimatedStayMinutes !== undefined
          ? { estimatedStayMinutes: stop.estimatedStayMinutes }
          : {})
      })),
      ...(route ? {
        geometryCandidate: route.geometry,
        geometrySource: 'amap-planned' as const,
        distanceMeters: route.distanceMeters,
        walkingOrCyclingMinutes: route.durationMinutes
      } : {}),
      totalEstimatedMinutes: time.totalEstimatedMinutes,
      warnings,
      canConfirmGeometry: Boolean(route)
    }
  })
}

export async function handleRequest(
  request: Request,
  dependencies: ServerDependencies
): Promise<Response> {
  const startedAt = dependencies.now()
  const requestId = randomUUID()
  let origin: string | undefined
  let route: 'analyze' | 'plan' | 'providers' | 'model-catalog' | 'provider-probe' | 'health' = 'health'
  let requestDeadline: AbortSignal | undefined
  try {
    origin = allowedOrigin(request, dependencies.config)
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-max-age': '600'
        }
      })
    }
    if (url.pathname === '/healthz') {
      route = 'health'
      if (request.method !== 'GET') throw new AiRouteError('AI_METHOD_NOT_ALLOWED', 405)
      return json({
        status: 'ok',
        service: 'netrin-ai-orchestrator',
        contractVersion: AI_ROUTE_CONTRACT_VERSION
      }, 200, origin)
    }
    if (url.pathname === '/v1/ai-route/providers') {
      route = 'providers'
      if (request.method !== 'GET') throw new AiRouteError('AI_METHOD_NOT_ALLOWED', 405)
      return json({
        contractVersion: AI_ROUTE_CONTRACT_VERSION,
        supportedInputKinds: [
          'prompt',
          ...(dependencies.config.fileInputEnabled ? ['file' as const] : [])
        ],
        fileLimits: AI_ROUTE_FILE_LIMITS,
        providers: listProviderCapabilities(),
        customProviderPolicy: {
          enabled: dependencies.config.customProviderEnabled,
          protocols: ['openai-chat-completions'],
          httpsOnly: true,
          defaultPortOnly: true,
          publicDnsOnly: true,
          customHeadersAllowed: false
        }
      }, 200, origin)
    }
    if (url.pathname === '/v1/ai-route/model-catalog') {
      route = 'model-catalog'
      if (request.method !== 'POST') throw new AiRouteError('AI_METHOD_NOT_ALLOWED', 405)
      requestDeadline = AbortSignal.timeout(DEFAULT_ROUTE_AGENT_LIMITS.requestTimeoutMs)
      const bounded = new Request(request, { signal: AbortSignal.any([request.signal, requestDeadline]) })
      return json(await modelCatalog(bounded, dependencies), 200, origin)
    }
    if (url.pathname === '/v1/ai-route/provider-probe') {
      route = 'provider-probe'
      if (request.method !== 'POST') throw new AiRouteError('AI_METHOD_NOT_ALLOWED', 405)
      requestDeadline = AbortSignal.timeout(DEFAULT_ROUTE_AGENT_LIMITS.requestTimeoutMs)
      const bounded = new Request(request, { signal: AbortSignal.any([request.signal, requestDeadline]) })
      return json(await providerProbe(bounded, dependencies), 200, origin)
    }
    if (url.pathname === '/v1/ai-route/analyze') {
      route = 'analyze'
      if (request.method !== 'POST') throw new AiRouteError('AI_METHOD_NOT_ALLOWED', 405)
      requestDeadline = AbortSignal.timeout(DEFAULT_ROUTE_AGENT_LIMITS.requestTimeoutMs)
      const bounded = new Request(request, {
        signal: AbortSignal.any([request.signal, requestDeadline])
      })
      return json(await analyze(bounded, requestId, dependencies), 200, origin)
    }
    if (url.pathname === '/v1/ai-route/plan') {
      route = 'plan'
      if (request.method !== 'POST') throw new AiRouteError('AI_METHOD_NOT_ALLOWED', 405)
      requestDeadline = AbortSignal.timeout(DEFAULT_ROUTE_AGENT_LIMITS.requestTimeoutMs)
      const bounded = new Request(request, {
        signal: AbortSignal.any([request.signal, requestDeadline])
      })
      return json(await plan(bounded, requestId, dependencies), 200, origin)
    }
    throw new AiRouteError('AI_REQUEST_INVALID', 404)
  } catch (error) {
    const safe = requestDeadline?.aborted && !request.signal.aborted
      ? new AiRouteError('AI_TIMEOUT', 504)
      : asAiRouteError(error)
    dependencies.metrics.record({
      requestId,
      route,
      outcome: 'failure',
      durationMs: Math.max(0, dependencies.now() - startedAt),
      errorCode: safe.code,
      ...(safe.upstreamStatus !== undefined ? { providerStatus: safe.upstreamStatus } : {}),
      ...(safe.providerFailureKind ? { providerFailureKind: safe.providerFailureKind } : {}),
      budgetExhausted: safe.code === 'AI_BUDGET_EXHAUSTED'
    })
    return json(errorResponse(safe, requestId), safe.status, origin)
  }
}

function requestBodyLimit(url: string | undefined): number {
  const pathname = (url ?? '').split('?', 1)[0]
  if (pathname === '/v1/ai-route/analyze') return MAX_ANALYZE_REQUEST_BYTES
  if (pathname === '/v1/ai-route/model-catalog' || pathname === '/v1/ai-route/provider-probe') {
    return MAX_PROVIDER_CONFIG_BYTES
  }
  return MAX_JSON_REQUEST_BYTES
}

function streamBoundedBody(request: IncomingMessage): ReadableStream<Uint8Array> | undefined {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return undefined
  const maximumBytes = requestBodyLimit(request.url)
  const guarded = Readable.from((async function* () {
    let size = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > maximumBytes) throw new AiRouteError('AI_REQUEST_TOO_LARGE', 413)
      yield buffer
    }
  })())
  return Readable.toWeb(guarded) as ReadableStream<Uint8Array>
}

async function bridge(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  dependencies: ServerDependencies
): Promise<void> {
  const clientAbort = new AbortController()
  const abortClientRequest = () => clientAbort.abort()
  incoming.once('aborted', abortClientRequest)
  const abortClosedResponse = () => {
    if (!outgoing.writableEnded) abortClientRequest()
  }
  outgoing.once('close', abortClosedResponse)
  try {
    const contentLength = Number(incoming.headers['content-length'] ?? 0)
    if (contentLength > requestBodyLimit(incoming.url)) {
      throw new AiRouteError('AI_REQUEST_TOO_LARGE', 413)
    }
    const body = streamBoundedBody(incoming)
    const host = incoming.headers.host ?? `127.0.0.1:${dependencies.config.port}`
    const request = new Request(`http://${host}${incoming.url ?? '/'}`, {
      method: incoming.method,
      headers: new Headers(incoming.headers as Record<string, string>),
      ...(body ? { body, duplex: 'half' as const } : {}),
      signal: clientAbort.signal
    })
    const response = await handleRequest(request, dependencies)
    if (outgoing.destroyed) return
    outgoing.statusCode = response.status
    response.headers.forEach((value, key) => outgoing.setHeader(key, value))
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    if (outgoing.destroyed) return
    const requestId = randomUUID()
    const safe = asAiRouteError(error)
    outgoing.statusCode = safe.status
    outgoing.setHeader('content-type', 'application/json; charset=utf-8')
    outgoing.setHeader('cache-control', 'no-store')
    outgoing.end(JSON.stringify(errorResponse(safe, requestId)))
  } finally {
    incoming.removeListener('aborted', abortClientRequest)
    outgoing.removeListener('close', abortClosedResponse)
  }
}

export function startServer(
  dependencies = createServerDependencies(loadConfig())
): ReturnType<typeof createServer> {
  const server = createServer((request, response) => {
    void bridge(request, response, dependencies)
  })
  server.once('close', () => { void dependencies.providerEgress.close?.() })
  server.listen(dependencies.config.port, '0.0.0.0', () => {
    const address = server.address() as AddressInfo
    process.stdout.write(JSON.stringify({
      event: 'service-started',
      service: 'netrin-ai-orchestrator',
      port: address.port
    }) + '\n')
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
}
