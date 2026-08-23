import { Type } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyQwenProviderPreferences,
  createPiRuntime,
  mapPiFailure
} from '../../src/providers/piAdapter.js'
import { listProviderCapabilities, requireRegisteredProvider } from '../../src/providers/registry.js'

describe('fixed text provider registry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers only the approved fixed DeepSeek, Qwen, and Kimi text models', () => {
    expect(listProviderCapabilities().map(({ providerId, allowedModelIds }) => ({
      providerId, allowedModelIds
    }))).toEqual([
      {
        providerId: 'deepseek-cn',
        allowedModelIds: ['deepseek-v4-flash', 'deepseek-v4-pro']
      },
      {
        providerId: 'qwen-cn',
        allowedModelIds: [
          'qwen3.8-max',
          'qwen3.7-max',
          'qwen3.7-plus',
          'qwen3.7-flash',
          'qwen3.6-plus',
          'qwen3.6-flash'
        ]
      },
      {
        providerId: 'kimi-cn',
        allowedModelIds: ['kimi-k3', 'kimi-k2.7-code-highspeed', 'kimi-k2.7-code', 'kimi-k2.6']
      }
    ])
  })

  it('configures every provider runtime for text input only', () => {
    const credential = { getApiKey: () => 'request-only-key' }
    const runtimes = [
      createPiRuntime(requireRegisteredProvider('qwen-cn', 'qwen3.8-max'), 'qwen3.8-max', credential),
      createPiRuntime(requireRegisteredProvider('kimi-cn', 'kimi-k3'), 'kimi-k3', credential),
      createPiRuntime(requireRegisteredProvider('deepseek-cn', 'deepseek-v4-flash'), 'deepseek-v4-flash', credential)
    ]
    expect(runtimes.map((runtime) => runtime.model.input)).toEqual([['text'], ['text'], ['text']])
  })

  it('uses a full Qwen workspace URL without appending a second v1 segment', () => {
    const provider = {
      ...requireRegisteredProvider('qwen-cn', 'qwen3.8-max'),
      baseUrl: 'https://llm-workspace123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
    }
    const runtime = createPiRuntime(provider, 'qwen3.8-max', { getApiKey: () => 'request-only-key' })
    expect(runtime.model.baseUrl)
      .toBe('https://llm-workspace123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')
  })

  it('keeps Qwen non-thinking mode for reliable multi-turn function calling', () => {
    expect(applyQwenProviderPreferences({
      model: 'qwen3.8-max',
      messages: [{ role: 'user', content: 'route' }]
    })).toEqual({
      model: 'qwen3.8-max',
      messages: [{ role: 'user', content: 'route' }],
      enable_thinking: false
    })
  })

  it('uses non-streaming Qwen completions and accepts tool calls without finish_reason', async () => {
    let requestUrl = ''
    let requestBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({
        id: 'completion-1',
        model: 'qwen3.8-max',
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'search_pois', arguments: '{"query":"公园"}' }
            }]
          }
        }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const provider = {
      ...requireRegisteredProvider('qwen-cn', 'qwen3.8-max'),
      baseUrl: 'https://llm-workspace123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
    }
    const runtime = createPiRuntime(provider, 'qwen3.8-max', {
      getApiKey: () => 'request-only-key'
    })
    const stream = await runtime.streamFn(runtime.model, {
      systemPrompt: 'Plan a route.',
      messages: [{ role: 'user', content: '安静的公园路线', timestamp: Date.now() }],
      tools: [{
        name: 'search_pois',
        description: 'Search POIs',
        parameters: Type.Object({ query: Type.String() })
      }]
    }, { apiKey: 'request-only-key' })
    const message = await stream.result()

    expect(requestUrl).toBe(
      'https://llm-workspace123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
    )
    expect(requestBody).toMatchObject({
      model: 'qwen3.8-max',
      stream: false,
      enable_thinking: false,
      tool_choice: {
        type: 'function',
        function: { name: 'search_pois' }
      },
      parallel_tool_calls: false
    })
    expect(message).toMatchObject({
      stopReason: 'toolUse',
      usage: { totalTokens: 20 },
      content: [{
        type: 'toolCall',
        id: 'call-1',
        name: 'search_pois',
        arguments: { query: '公园' }
      }]
    })
    expect(runtime.getLastResponseStatus()).toBe(200)
  })

  it('classifies provider failures from the safe upstream HTTP status', () => {
    expect(mapPiFailure(undefined, 'error', 400)).toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID', upstreamStatus: 400
    })
    expect(mapPiFailure(undefined, 'error', 401)).toMatchObject({
      code: 'AI_PROVIDER_AUTH_FAILED', upstreamStatus: 401
    })
    expect(mapPiFailure(undefined, 'error', 429)).toMatchObject({
      code: 'AI_PROVIDER_QUOTA_EXHAUSTED', upstreamStatus: 429
    })
    expect(mapPiFailure(undefined, 'error', 503)).toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE', upstreamStatus: 503
    })
    expect(mapPiFailure('Qwen response was invalid', 'error', 200)).toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID', upstreamStatus: 200
    })
  })
})
