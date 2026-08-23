import { createServer } from 'node:http'
import { once } from 'node:events'

// Browsers and Node's Fetch implementation reject these ports even when a
// loopback listener owns them. Port 0 may occasionally resolve to one of them
// on development machines with a non-default ephemeral range.
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123,
  135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530,
  531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995,
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665,
  6666, 6667, 6668, 6669, 6679, 6697, 10080
])

export const AI_CAPABILITIES_RESPONSE = {
  contractVersion: '1.3.0',
  supportedInputKinds: ['prompt', 'file'],
  fileLimits: {
    documentBytes: 10 * 1024 * 1024,
    totalBytes: 10 * 1024 * 1024,
    maxPdfPages: 30,
    maxTextChars: 100000
  },
  providers: [{
    providerId: 'deepseek-cn', displayName: 'DeepSeek', allowedModelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    modelSource: 'fixed', toolCalling: true, maxContextTokens: 131072, supportsThinking: true
  }, {
    providerId: 'qwen-cn', displayName: 'Qwen',
    allowedModelIds: ['qwen3.8-max', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.7-flash', 'qwen3.6-plus', 'qwen3.6-flash'],
    modelSource: 'fixed', toolCalling: true, maxContextTokens: 1000000, supportsThinking: true
  }, {
    providerId: 'kimi-cn', displayName: 'Kimi',
    allowedModelIds: ['kimi-k3', 'kimi-k2.7-code-highspeed', 'kimi-k2.7-code', 'kimi-k2.6'],
    modelSource: 'fixed', toolCalling: true, maxContextTokens: 1000000, supportsThinking: true
  }],
  customProviderPolicy: {
    enabled: true, protocols: ['openai-chat-completions'], httpsOnly: true,
    defaultPortOnly: true, publicDnsOnly: true, customHeadersAllowed: false
  }
}

export async function startAiCapabilitiesMock({ host = '127.0.0.1', port = 0, delayMs = 25 } = {}) {
  const requests = []
  const optionByRef = new Map()
  let requestSequence = 0
  const sendJson = (response, status, body) => {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'cache-control': 'no-store'
    })
    response.end(JSON.stringify(body))
  }
  const readJson = async (request) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  }
  const server = createServer(async (request, response) => {
    requests.push({ method: request.method ?? '', url: request.url ?? '', host: request.headers.host ?? '' })
    const pathname = new URL(request.url ?? '/', 'http://local-ai-mock').pathname
    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {})
      return
    }
    if (request.method === 'GET' && pathname === '/v1/ai-route/providers') {
      setTimeout(() => {
        sendJson(response, 200, AI_CAPABILITIES_RESPONSE)
      }, delayMs)
      return
    }
    try {
      if (request.method === 'POST' && pathname === '/v1/ai-route/model-catalog') {
        sendJson(response, 200, {
          contractVersion: '1.3.0',
          providerId: 'custom-openai',
          models: [{
            modelId: 'local-preview-model', displayName: 'Local preview model',
            toolCalling: true, contextTokens: 128000, source: 'provider'
          }]
        })
        return
      }
      if (request.method === 'POST' && pathname === '/v1/ai-route/provider-probe') {
        sendJson(response, 200, {
          contractVersion: '1.3.0',
          capabilityToken: 'local-preview-capability',
          expiresAt: Date.now() + 60 * 60 * 1000,
          capabilities: { toolCalling: true, maxContextTokens: 128000 }
        })
        return
      }
      if (request.method === 'POST' && pathname === '/v1/ai-route/analyze') {
        const body = await readJson(request)
        const locale = body.locale === 'en' ? 'en' : 'zh-CN'
        const constraints = {
          region: String(body.constraints?.region ?? '').trim() || (locale === 'en' ? 'Preview area' : '预览区域'),
          travelMode: body.constraints?.travelMode === 'cycling' ? 'cycling' : 'walking',
          maximumStops: Number(body.constraints?.maximumStops) || 4,
          ...(body.constraints?.durationMinutes ? { durationMinutes: Number(body.constraints.durationMinutes) } : {}),
          ...(body.constraints?.roundTrip ? { roundTrip: true } : {}),
          ...(Array.isArray(body.constraints?.mustInclude) ? { mustInclude: body.constraints.mustInclude } : {}),
          ...(Array.isArray(body.constraints?.avoid) ? { avoid: body.constraints.avoid } : {}),
          ...(Array.isArray(body.constraints?.preferences) ? { preferences: body.constraints.preferences } : {})
        }
        const requestId = `local-preview-analyze-${++requestSequence}`
        const fixtures = locale === 'en'
          ? [['Preview garden', 'A quiet green stop'], ['Preview square', 'An open public stop']]
          : [['预览花园', '安静的绿色重点'], ['预览广场', '开阔的公共重点']]
        const coordinates = [[120, 30], [120.006, 30.004]]
        const candidates = fixtures.map(([name, reason], index) => {
          const candidateId = `preview-${index + 1}`
          const optionRef = `local-preview-option-${requestSequence}-${index + 1}`
          const option = {
            optionRef, poiName: name, category: locale === 'en' ? 'Preview' : '预览地点',
            district: constraints.region, displayAddress: constraints.region, wgs84: coordinates[index]
          }
          optionByRef.set(optionRef, { candidateId, ...option, reason })
          return {
            candidateId,
            placeIntent: {
              candidateId, desiredName: name, aliases: [], cityHint: constraints.region,
              reason, evidence: locale === 'en' ? 'Deterministic local preview fixture' : '确定性本地预览夹具',
              priority: index === 0 ? 'required' : 'preferred', estimatedStayMinutes: 20
            },
            confidence: 'high', options: [option], selectedOptionRef: optionRef, requiresUserChoice: false
          }
        })
        sendJson(response, 200, {
          requestId,
          harnessVersion: 'netrin-route-agent/local-preview',
          promptVersion: 'route-authoring/local-preview',
          inputSummary: {
            kind: body.input?.kind === 'file' ? 'file' : 'prompt',
            sourceRefs: body.input?.kind === 'file'
              ? (body.input.sourceFiles ?? []).map((file) => ({ kind: 'file', displayName: file.displayName }))
              : []
          },
          normalizedConstraints: constraints,
          candidates,
          proposedOrder: candidates.map((candidate) => candidate.candidateId),
          warnings: []
        })
        return
      }
      if (request.method === 'POST' && pathname === '/v1/ai-route/plan') {
        const body = await readJson(request)
        const selected = Array.isArray(body.selectedStops) ? body.selectedStops : []
        const stops = selected.flatMap((selection) => {
          const option = optionByRef.get(selection.optionRef)
          return option ? [{
            candidateId: selection.candidateId,
            name: option.poiName,
            reason: selection.intent?.reason || option.reason,
            category: option.category,
            district: option.district,
            wgs84: option.wgs84,
            estimatedStayMinutes: selection.estimatedStayMinutes ?? 20
          }] : []
        })
        const coordinates = stops.map((stop) => stop.wgs84)
        sendJson(response, 200, {
          requestId: `local-preview-plan-${++requestSequence}`,
          stops,
          ...(coordinates.length >= 2 ? {
            geometryCandidate: { type: 'LineString', coordinates },
            geometrySource: 'amap-planned',
            distanceMeters: 850,
            walkingOrCyclingMinutes: 18
          } : {}),
          totalEstimatedMinutes: 58,
          warnings: [],
          canConfirmGeometry: coordinates.length >= 2
        })
        return
      }
    } catch {
      sendJson(response, 400, {
        requestId: `local-preview-error-${++requestSequence}`,
        error: { code: 'AI_REQUEST_INVALID', message: 'Invalid local preview request.' }
      })
      return
    }
    sendJson(response, 404, { error: 'mock-route-not-found' })
  })
  let address
  for (let attempt = 0; attempt < 20; attempt += 1) {
    server.listen(port, host)
    await once(server, 'listening')
    address = server.address()
    if (!address || typeof address === 'string') throw new Error('AI capabilities mock did not expose a TCP address.')
    if (!FETCH_BLOCKED_PORTS.has(address.port)) break
    if (port !== 0) throw new Error(`AI capabilities mock cannot use Fetch-blocked port ${address.port}.`)
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
    address = undefined
  }
  if (!address) throw new Error('AI capabilities mock could not obtain a Fetch-safe loopback port.')
  let closed = false
  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    requests,
    async close() {
      if (closed) return
      closed = true
      await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
    }
  }
}
