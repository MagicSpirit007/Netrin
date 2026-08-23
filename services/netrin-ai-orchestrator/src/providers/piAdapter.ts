import type { StreamFn } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  fauxProvider,
  type AssistantMessage,
  type Context,
  type FauxProviderHandle,
  type Model,
  type SimpleStreamOptions,
  type ToolCall
} from '@earendil-works/pi-ai'
import { convertMessages } from '@earendil-works/pi-ai/api/openai-completions'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { AiRouteError, type ProviderFailureKind } from '../errors.js'
import type { RequestCredential } from './credentialScope.js'
import type { RegisteredProvider } from './registry.js'

export const PI_AGENT_CORE_VERSION = '0.82.1'
export const PI_AI_VERSION = '0.82.1'

export type PiRuntime = {
  model: Model<string>
  streamFn: StreamFn
  getApiKey: (provider: string) => string | undefined
  getLastResponseStatus: () => number | undefined
}

export type PiRuntimeOptions = Record<string, never>

export function applyQwenProviderPreferences(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  return {
    ...(payload as Record<string, unknown>),
    enable_thinking: false
  }
}

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function emptyAssistantMessage(model: Model<'openai-completions'>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop',
    timestamp: Date.now()
  }
}

function responseHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries())
}

function responseText(message: JsonObject): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter(isJsonObject)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
}

function responseToolCalls(message: JsonObject): ToolCall[] {
  if (!Array.isArray(message.tool_calls)) return []
  return message.tool_calls.map((raw, index) => {
    if (!isJsonObject(raw) || !isJsonObject(raw.function) ||
        typeof raw.function.name !== 'string') {
      throw new Error('Qwen response contained an invalid tool call')
    }
    const rawArguments = raw.function.arguments
    let args: unknown = {}
    if (typeof rawArguments === 'string' && rawArguments.trim()) {
      try {
        args = JSON.parse(rawArguments)
      } catch {
        throw new Error('Qwen response contained invalid tool arguments')
      }
    } else if (isJsonObject(rawArguments)) {
      args = rawArguments
    }
    if (!isJsonObject(args)) {
      throw new Error('Qwen response contained non-object tool arguments')
    }
    return {
      type: 'toolCall',
      id: typeof raw.id === 'string' && raw.id ? raw.id : `qwen_call_${index}`,
      name: raw.function.name,
      arguments: args
    }
  })
}

function usageCount(usage: JsonObject | undefined, field: string): number {
  const value = usage?.[field]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

function qwenRequiredTool(context: Context): string | undefined {
  const available = new Set(context.tools?.map((tool) => tool.name) ?? [])
  const hasSuccessfulLookup = context.messages.some((message) =>
    message.role === 'toolResult' &&
    !message.isError &&
    (message.toolName === 'search_pois' || message.toolName === 'get_poi_details')
  )
  const required = hasSuccessfulLookup ? 'submit_route_plan' : 'search_pois'
  return available.has(required) ? required : undefined
}

function qwenCompletionMessage(
  model: Model<'openai-completions'>,
  response: unknown
): AssistantMessage & { stopReason: 'stop' | 'length' | 'toolUse' } {
  if (!isJsonObject(response) || !Array.isArray(response.choices) ||
      !isJsonObject(response.choices[0]) || !isJsonObject(response.choices[0].message)) {
    throw new Error('Qwen response did not contain a completion choice')
  }
  const choice = response.choices[0]
  const responseMessage = choice.message as JsonObject
  const text = responseText(responseMessage)
  const toolCalls = responseToolCalls(responseMessage)
  if (!text && toolCalls.length === 0) {
    throw new Error('Qwen response did not contain text or tool calls')
  }
  const rawFinishReason = choice.finish_reason
  if (rawFinishReason === 'content_filter' || rawFinishReason === 'error') {
    throw new Error(`Qwen response finish reason: ${rawFinishReason}`)
  }
  const stopReason = toolCalls.length > 0
    ? 'toolUse'
    : rawFinishReason === 'length' ? 'length' : 'stop'
  const usage = isJsonObject(response.usage) ? response.usage : undefined
  const input = usageCount(usage, 'prompt_tokens')
  const output = usageCount(usage, 'completion_tokens')
  const totalTokens = usageCount(usage, 'total_tokens') || input + output
  return {
    ...emptyAssistantMessage(model),
    content: [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...toolCalls
    ],
    ...(typeof response.model === 'string' ? { responseModel: response.model } : {}),
    ...(typeof response.id === 'string' ? { responseId: response.id } : {}),
    usage: {
      input,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason,
    timestamp: Date.now()
  }
}

function qwenNonStreamingStream(
  model: Model<'openai-completions'>,
  context: Context,
  options: SimpleStreamOptions | undefined
) {
  const stream = createAssistantMessageEventStream()
  const partial = emptyAssistantMessage(model)
  stream.push({ type: 'start', partial })
  void (async () => {
    let failureStage: ProviderFailureKind = 'payload-build'
    const timeoutSignal = AbortSignal.timeout(options?.timeoutMs ?? 60_000)
    const signal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal
    try {
      if (!options?.apiKey) throw new Error(`No API key for provider: ${model.provider}`)
      const compat = {
        ...model.compat,
        supportsOpenAIGrammarTools: false,
        supportsStrictMode: false,
        requiresToolResultName: false,
        requiresAssistantAfterToolResult: false,
        requiresThinkingAsText: false,
        sendSessionAffinityHeaders: false,
        supportsLongCacheRetention: false
      } as Parameters<typeof convertMessages>[2]
      let payload: unknown = {
        model: model.id,
        messages: convertMessages(model, context, compat),
        stream: false,
        max_tokens: options.maxTokens ?? model.maxTokens,
        ...(context.tools?.length ? {
          tools: context.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters
            }
          }))
        } : {}),
        ...(qwenRequiredTool(context) ? {
          tool_choice: {
            type: 'function',
            function: { name: qwenRequiredTool(context) }
          },
          parallel_tool_calls: false
        } : {})
      }
      failureStage = 'payload-transform'
      payload = await options.onPayload?.(payload, model) ?? payload
      if (!isJsonObject(payload)) throw new Error('Qwen payload transform returned an invalid payload')
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
        ...model.headers
      }
      for (const [name, value] of Object.entries(options.headers ?? {})) {
        if (value === null) delete headers[name]
        else headers[name] = value
      }
      failureStage = 'payload-serialize'
      const body = JSON.stringify(payload)
      failureStage = 'transport'
      const response = await fetch(`${model.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body,
        signal
      })
      await options.onResponse?.({
        status: response.status,
        headers: responseHeaders(response.headers)
      }, model)
      if (!response.ok) throw new Error(`Qwen provider returned HTTP ${response.status}`)
      failureStage = 'response-json'
      const completion = await response.json()
      failureStage = 'response-parse'
      const message = qwenCompletionMessage(model, completion)
      stream.push({ type: 'done', reason: message.stopReason, message })
    } catch (error) {
      const aborted = options?.signal?.aborted === true
      const timedOut = !aborted && timeoutSignal.aborted
      const errorMessage = aborted
        ? 'Request was aborted'
        : timedOut ? 'Provider request timed out'
          : error instanceof Error && error.message.startsWith('Qwen ')
            ? error.message
            : `Qwen adapter failure stage: ${failureStage}`
      const failed: AssistantMessage = {
        ...partial,
        stopReason: aborted ? 'aborted' : 'error',
        errorMessage,
        timestamp: Date.now()
      }
      stream.push(aborted
        ? { type: 'error', reason: 'aborted', error: failed }
        : { type: 'error', reason: 'error', error: failed })
    }
  })()
  return stream
}

function compatibleModel(provider: RegisteredProvider, modelId: string): Model<'openai-completions'> {
  const deepSeekReasoning = provider.providerId === 'deepseek-cn' && modelId.endsWith('-pro')
  const normalizedBaseUrl = provider.baseUrl.replace(/\/+$/, '')
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: provider.providerId,
    baseUrl: provider.providerId === 'custom-openai' || normalizedBaseUrl.endsWith('/v1')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`,
    reasoning: deepSeekReasoning || (provider.providerId === 'kimi-cn' && provider.supportsThinking),
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: provider.maxContextTokens,
    maxTokens: 8_192,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
      supportsStrictMode: false,
      maxTokensField: 'max_tokens',
      requiresReasoningContentOnAssistantMessages: deepSeekReasoning,
      ...(provider.providerId === 'deepseek-cn' ? { thinkingFormat: 'deepseek' as const } : {})
    }
  }
}

export function createPiRuntime(
  provider: RegisteredProvider,
  modelId: string,
  credential: RequestCredential,
  _runtimeOptions: PiRuntimeOptions = {}
): PiRuntime {
  const model = compatibleModel(provider, modelId)
  const models = createModels()
  let lastResponseStatus: number | undefined
  models.setProvider(createProvider({
    id: provider.providerId,
    name: provider.displayName,
    baseUrl: provider.baseUrl,
    auth: {
      apiKey: {
        name: `${provider.displayName} request key`,
        resolve: async () => ({ auth: {} })
      }
    },
    models: [model],
    api: openAICompletionsApi()
  }))
  return {
    model,
    streamFn: (requestedModel, context, options) => {
      const upstreamPayload = options?.onPayload
      const upstreamResponse = options?.onResponse
      const sharedOptions = {
        ...options,
        maxRetries: 1,
        timeoutMs: 60_000,
        maxRetryDelayMs: 2_000,
        onResponse: async (response: Parameters<NonNullable<typeof upstreamResponse>>[0], responseModel: Parameters<NonNullable<typeof upstreamResponse>>[1]) => {
          lastResponseStatus = response.status
          await upstreamResponse?.(response, responseModel)
        }
      }
      if (provider.providerId === 'qwen-cn') {
        return qwenNonStreamingStream(
          requestedModel as Model<'openai-completions'>,
          context,
          {
            ...sharedOptions,
            onPayload: async (payload, payloadModel) => {
              const transformed = await upstreamPayload?.(payload, payloadModel) ?? payload
              return applyQwenProviderPreferences(transformed)
            }
          }
        )
      }
      return models.streamSimple(
        requestedModel,
        context,
        sharedOptions
      )
    },
    getApiKey: (requestedProvider) =>
      requestedProvider === provider.providerId ? credential.getApiKey() : undefined,
    getLastResponseStatus: () => lastResponseStatus
  }
}

export function createFauxPiRuntime(handle: FauxProviderHandle): PiRuntime {
  const models = createModels()
  models.setProvider(handle.provider)
  return {
    model: handle.getModel(),
    streamFn: (requestedModel, context, options) => models.streamSimple(
      requestedModel,
      context,
      { ...options, maxRetries: 0, timeoutMs: 60_000, maxRetryDelayMs: 2_000 }
    ),
    getApiKey: () => undefined,
    getLastResponseStatus: () => undefined
  }
}

export function createFauxHandle(): FauxProviderHandle {
  return fauxProvider({ provider: 'netrin-faux', tokensPerSecond: undefined })
}

export function mapPiFailure(
  errorMessage: string | undefined,
  stopReason?: string,
  upstreamStatus?: number
): AiRouteError {
  if (stopReason === 'aborted') return new AiRouteError('AI_ABORTED', 499)
  const safe = (errorMessage ?? '').toLowerCase()
  const failureKind: ProviderFailureKind = safe.includes('returned http')
    ? 'http-error'
    : safe.includes('completion choice') ? 'completion-shape'
      : safe.includes('text or tool calls') ? 'empty-completion'
        : safe.includes('invalid tool call') ? 'tool-call-shape'
          : safe.includes('invalid tool arguments') ? 'tool-arguments-json'
            : safe.includes('non-object tool arguments') ? 'tool-arguments-shape'
              : safe.includes('finish reason') ? 'finish-reason'
                : safe.includes('failure stage: payload-build') ? 'payload-build'
                  : safe.includes('failure stage: payload-transform') ? 'payload-transform'
                    : safe.includes('failure stage: payload-serialize') ? 'payload-serialize'
                      : safe.includes('failure stage: response-json') ? 'response-json'
                        : safe.includes('failure stage: response-parse') ? 'response-parse'
                : safe.includes('timed out') || safe.includes('timeout') ? 'timeout'
                  : safe.includes('fetch') || safe.includes('network') || safe.includes('socket')
                    ? 'transport'
                    : 'unknown'
  if (safe.includes('execution budget was exhausted')) {
    return new AiRouteError('AI_BUDGET_EXHAUSTED', 422, upstreamStatus, 'budget')
  }
  if (upstreamStatus === 401 || upstreamStatus === 403 || safe.includes('401') || safe.includes('403') ||
      safe.includes('api key') || safe.includes('unauthorized')) {
    return new AiRouteError('AI_PROVIDER_AUTH_FAILED', 401, upstreamStatus, failureKind)
  }
  if (upstreamStatus === 429 || safe.includes('429') || safe.includes('quota') ||
      safe.includes('insufficient balance')) {
    return new AiRouteError('AI_PROVIDER_QUOTA_EXHAUSTED', 429, upstreamStatus, failureKind)
  }
  if (stopReason === 'length') return new AiRouteError('AI_BUDGET_EXHAUSTED', 422)
  if (safe.includes('timed out') || safe.includes('timeout')) {
    return new AiRouteError('AI_TIMEOUT', 504, upstreamStatus, failureKind)
  }
  if (upstreamStatus !== undefined && upstreamStatus >= 400 && upstreamStatus < 500) {
    return new AiRouteError('AI_PROVIDER_RESPONSE_INVALID', 502, upstreamStatus, failureKind)
  }
  if (upstreamStatus !== undefined && upstreamStatus >= 200 && upstreamStatus < 300 && stopReason === 'error') {
    return new AiRouteError('AI_PROVIDER_RESPONSE_INVALID', 502, upstreamStatus, failureKind)
  }
  return new AiRouteError('AI_PROVIDER_UNAVAILABLE', 503, upstreamStatus, failureKind)
}
