import { describe, expect, it } from 'vitest'
import { AiRouteClientError, normalizeProviderRegistry, resolveAiRouteEndpoint } from './client'

describe('AI route endpoint resolution', () => {
  it('uses same-origin API paths when no override is configured', () => {
    expect(resolveAiRouteEndpoint('/v1/ai-route/providers', ''))
      .toBe('/v1/ai-route/providers')
  })

  it('uses an explicit local or cross-origin base without duplicate trailing slashes', () => {
    expect(resolveAiRouteEndpoint('/v1/ai-route/analyze', 'http://127.0.0.1:8787/'))
      .toBe('http://127.0.0.1:8787/v1/ai-route/analyze')
  })

  it('rejects paths outside the owned AI route surface', () => {
    expect(() => resolveAiRouteEndpoint('/rest/v1/private', '')).toThrow(AiRouteClientError)
  })
})

describe('AI provider capability compatibility', () => {
  it('falls back to text-only when an older service omits input capability fields', () => {
    const result = normalizeProviderRegistry({
      contractVersion: '1.0.0',
      providers: [{
        providerId: 'deepseek-cn',
        displayName: 'DeepSeek',
        allowedModelIds: ['deepseek-v4-flash'],
        toolCalling: true,
        maxContextTokens: 131_072,
        supportsThinking: false
      }]
    })
    expect(result.supportedInputKinds).toEqual(['prompt'])
    expect(result.fileLimits.maxPdfPages).toBe(30)
    expect(result.providers[0]?.modelSource).toBe('fixed')
    expect(result.customProviderPolicy).toBeUndefined()
  })
})
