import { describe, expect, it } from 'vitest'
import {
  parseAnalyzeRequest,
  parseModelCatalogRequest,
  parseProviderProbeRequest,
  parseSubmittedRoutePlan
} from '../../src/harness/validators.js'

const constraints = { region: '杭州市', travelMode: 'walking', maximumStops: 4 }

describe('AI route 1.3 validators', () => {
  it('accepts prompt and extracted-text files while rejecting removed input kinds', () => {
    expect(parseAnalyzeRequest({
      provider: { providerId: 'deepseek-cn', modelId: 'deepseek-v4-flash', apiKey: 'secret' },
      input: { kind: 'prompt', text: '西湖边看植物' },
      constraints,
      locale: 'zh-CN'
    }).input.kind).toBe('prompt')
    expect(parseAnalyzeRequest({
      provider: { providerId: 'qwen-cn', modelId: 'qwen3.8-max', apiKey: 'secret' },
      input: {
        kind: 'file',
        extractedText: '植物路线',
        sourceFiles: [{ displayName: 'route.pdf', mediaType: 'application/pdf', byteSize: 200 }]
      },
      constraints,
      locale: 'zh-CN'
    }, { fileEnabled: true }).input.kind).toBe('file')
    for (const input of [
      { kind: 'url', url: 'https://example.com' },
      { kind: 'image', data: 'ignored' },
      { kind: 'file', extractedText: '', sourceFiles: [{ displayName: 'scan.pdf', mediaType: 'application/pdf', byteSize: 200 }] }
    ]) {
      expect(() => parseAnalyzeRequest({
        provider: { providerId: 'deepseek-cn', modelId: 'deepseek-v4-flash', apiKey: 'secret' },
        input,
        constraints,
        locale: 'zh-CN'
      }, { fileEnabled: true })).toThrow()
    }
  })

  it('accepts fixed providers and gated text-only custom providers, never removed providers', () => {
    const common = { input: { kind: 'prompt', text: '西湖边看植物' }, constraints, locale: 'zh-CN' }
    expect(parseAnalyzeRequest({
      ...common,
      provider: {
        providerId: 'custom-openai', modelId: 'tool-model', apiKey: 'secret',
        baseUrl: 'https://LLM.example.com:443/v1/', capabilityToken: 'signed.token'
      }
    }, { customProviderEnabled: true }).provider).toMatchObject({
      providerId: 'custom-openai', baseUrl: 'https://llm.example.com/v1'
    })
    expect(() => parseAnalyzeRequest({
      ...common,
      provider: { providerId: 'openrouter', modelId: 'vendor/model', apiKey: 'secret' }
    })).toThrowError(expect.objectContaining({ code: 'AI_PROVIDER_NOT_ALLOWED' }))
  })

  it('validates custom catalog and text-only probe contracts', () => {
    expect(parseModelCatalogRequest({
      providerId: 'custom-openai', baseUrl: 'https://llm.example.com/v1/', apiKey: 'secret'
    }, { customProviderEnabled: true })).toEqual({
      providerId: 'custom-openai', baseUrl: 'https://llm.example.com/v1', apiKey: 'secret'
    })
    expect(parseProviderProbeRequest({
      providerId: 'custom-openai', baseUrl: 'https://llm.example.com/v1',
      modelId: 'tool-model', apiKey: 'secret'
    }, true)).toMatchObject({ providerId: 'custom-openai', modelId: 'tool-model' })
    expect(() => parseProviderProbeRequest({
      providerId: 'custom-openai', baseUrl: 'https://llm.example.com/v1',
      modelId: 'tool-model', apiKey: 'secret', vision: true
    }, true)).toThrowError(expect.objectContaining({ code: 'AI_REQUEST_INVALID' }))
    expect(() => parseModelCatalogRequest({ providerId: 'openrouter' }, {
      customProviderEnabled: true
    })).toThrowError(expect.objectContaining({ code: 'AI_REQUEST_INVALID' }))
  })

  it('rejects model-produced coordinate fields', () => {
    expect(() => parseSubmittedRoutePlan({
      places: [
        { intent: { candidateId: 'a', desiredName: 'A', aliases: [], cityHint: '杭州', reason: '观察', evidence: '用户要求', priority: 'required', coordinates: [120, 30] }, poiRefs: ['trusted-a'] },
        { intent: { candidateId: 'b', desiredName: 'B', aliases: [], cityHint: '杭州', reason: '观察', evidence: '用户要求', priority: 'preferred' }, poiRefs: ['trusted-b'] }
      ],
      proposedOrder: ['a', 'b']
    }, 4)).toThrowError(expect.objectContaining({ code: 'AI_MODEL_OUTPUT_INVALID' }))
  })
})
