import { describe, expect, it } from 'vitest'
import { resolvePublicAddresses, isPublicAddress } from '../../src/network/publicHttps.js'
import { createCapabilityToken, verifyCapabilityToken } from '../../src/providers/capabilityToken.js'
import { normalizedCustomBaseUrl, validateCustomBaseUrl } from '../../src/providers/customEndpoint.js'
import { LoopbackProviderEgressBroker } from '../../src/providers/egressBroker.js'
import { parseCustomCatalog } from '../../src/providers/modelCatalog.js'

const signingMaterial = 'test-signing-material-at-least-32-characters-long'

describe('custom provider endpoint policy', () => {
  it('normalizes a public HTTPS 443 base path and rejects unsafe URL forms', () => {
    expect(normalizedCustomBaseUrl('https://LLM.Example.com:443/v1/')).toBe('https://llm.example.com/v1')
    const invalid = [
      'http://llm.example.com/v1',
      'https://llm.example.com:8443/v1',
      'https://127.0.0.1/v1',
      'https://[::1]/v1',
      'https://user:secret@llm.example.com/v1',
      'https://llm.example.com/v1?header=evil',
      'https://llm.example.com/v1#fragment',
      'https://llm.example.com/a/../v1',
      'https://llm.example.com/%2e%2e/v1',
      'https://llm.example.com/%252e%252e/v1',
      'https://llm.example.com/%2fadmin'
    ]
    const accepted = invalid.filter((value) => {
      try { validateCustomBaseUrl(value); return true } catch { return false }
    })
    expect(accepted).toEqual([])
  })

  it('rejects private, metadata, reserved, mapped-private, and mixed DNS answers', async () => {
    const blocked = [
      '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '::1', 'fc00::1',
      'fe80::1', '2001:db8::1', '::ffff:192.168.1.1'
    ]
    blocked.forEach((address) => expect(isPublicAddress(address)).toBe(false))
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
    await expect(resolvePublicAddresses('mixed.example', {
      resolve: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 }
      ],
      blockedCode: 'AI_PROVIDER_ENDPOINT_BLOCKED',
      failureCode: 'AI_PROVIDER_ENDPOINT_BLOCKED'
    })).rejects.toMatchObject({ code: 'AI_PROVIDER_ENDPOINT_BLOCKED' })
  })

  it('issues a loopback-only, path-scoped, revocable lease after public DNS validation', async () => {
    let now = 1_000
    const broker = new LoopbackProviderEgressBroker({
      now: () => now,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }]
    })
    try {
      const lease = await broker.lease('https://llm.example.com/v1')
      expect(lease.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\/v1$/)
      expect(lease.normalizedTarget).toBe('https://llm.example.com/v1')
      expect((await fetch(`${lease.baseUrl}/models`)).status).toBe(401)
      expect((await fetch(`${lease.baseUrl}/anything`, {
        headers: { authorization: 'Bearer request-key' }
      })).status).toBe(404)
      expect((await fetch(`${lease.baseUrl.replace(/\/v1$/, '')}/models`, {
        headers: { authorization: 'Bearer request-key' }
      })).status).toBe(404)
      expect((await fetch(`${lease.baseUrl}/models?redirect=https://evil.example`, {
        headers: { authorization: 'Bearer request-key' }
      })).status).toBe(404)
      now += 3 * 60_000
      expect((await fetch(`${lease.baseUrl}/models`, {
        headers: { authorization: 'Bearer request-key' }
      })).status).toBe(404)
    } finally {
      await broker.close()
    }
  })
})

describe('custom provider capability token', () => {
  it('binds the token to user, normalized base URL, model, API key, and expiry', () => {
    const issued = createCapabilityToken({
      userId: 'user-1',
      baseUrl: 'https://llm.example.com/v1',
      modelId: 'tool-model',
      apiKey: 'request-only-secret',
      maxContextTokens: 32_768
    }, signingMaterial, 1_000, 60_000)
    expect(issued.token).not.toContain('request-only-secret')
    expect(verifyCapabilityToken(issued.token, signingMaterial, {
      userId: 'user-1',
      baseUrl: 'https://llm.example.com/v1',
      modelId: 'tool-model',
      apiKey: 'request-only-secret'
    }, 2_000)).toMatchObject({ maxContextTokens: 32_768 })
    for (const expected of [
      { userId: 'user-2', baseUrl: 'https://llm.example.com/v1', modelId: 'tool-model', apiKey: 'request-only-secret' },
      { userId: 'user-1', baseUrl: 'https://other.example/v1', modelId: 'tool-model', apiKey: 'request-only-secret' },
      { userId: 'user-1', baseUrl: 'https://llm.example.com/v1', modelId: 'other-model', apiKey: 'request-only-secret' },
      { userId: 'user-1', baseUrl: 'https://llm.example.com/v1', modelId: 'tool-model', apiKey: 'changed-secret' }
    ]) {
      expect(() => verifyCapabilityToken(issued.token, signingMaterial, expected, 2_000)).toThrowError(
        expect.objectContaining({ code: 'AI_MODEL_PROBE_REQUIRED' })
      )
    }
    expect(() => verifyCapabilityToken(issued.token, signingMaterial, {
      userId: 'user-1', baseUrl: 'https://llm.example.com/v1', modelId: 'tool-model', apiKey: 'request-only-secret'
    }, 61_000)).toThrowError(expect.objectContaining({ code: 'AI_MODEL_PROBE_EXPIRED' }))
  })
})

describe('custom provider catalog', () => {
  it('deduplicates a custom /models response and preserves manual fallback semantics', () => {
    expect(parseCustomCatalog({ data: [
      { id: 'model-a' }, { id: 'model-a' }, { id: 'model-b' }, { id: '../bad' }
    ] })).toEqual([
      { modelId: 'model-a', displayName: 'model-a', toolCalling: null, source: 'provider' },
      { modelId: 'model-b', displayName: 'model-b', toolCalling: null, source: 'provider' }
    ])
  })
})
