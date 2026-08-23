import { describe, expect, it, vi } from 'vitest'
import { verifyCapabilityToken } from '../../src/providers/capabilityToken.js'
import type { ProviderEgress } from '../../src/providers/egressBroker.js'
import { DefaultProviderProbeService } from '../../src/providers/providerProbe.js'

const signingMaterial = 'probe-signing-material-at-least-32-characters-long'

describe('custom provider probe', () => {
  it('sends only a nonce, requires a tool call, and returns a bound one-hour text-only token', async () => {
    let revoked = false
    const egress: ProviderEgress = {
      async lease() {
        return {
          baseUrl: 'http://127.0.0.1:43123/lease/v1',
          normalizedTarget: 'https://llm.example.com/v1',
          revoke: () => { revoked = true }
        }
      }
    }
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43123/lease/v1/chat/completions')
      expect(init?.headers).toMatchObject({ authorization: 'Bearer request-secret' })
      const body = JSON.parse(String(init?.body)) as {
        model: string
        stream: boolean
        max_tokens: number
        messages: Array<{ role: string; content: string }>
        tools: Array<{ function: { name: string } }>
        tool_choice: { function: { name: string } }
      }
      expect(body.model).toBe('tool-model')
      expect(body.stream).toBe(false)
      expect(body.max_tokens).toBe(32)
      expect(body.tools[0]?.function.name).toBe('netrin_capability_probe')
      expect(body.tool_choice.function.name).toBe('netrin_capability_probe')
      expect(JSON.stringify(body)).not.toContain('vision')
      const text = body.messages[0]?.content ?? ''
      expect(text).not.toContain('杭州')
      const nonce = text.match(/nonce ([A-Za-z0-9_-]+)/)?.[1]
      expect(nonce).toBeTruthy()
      return Response.json({
        choices: [{
          message: {
            tool_calls: [{
              type: 'function',
              function: { name: 'netrin_capability_probe', arguments: JSON.stringify({ nonce }) }
            }]
          }
        }]
      })
    }) as unknown as typeof fetch
    const service = new DefaultProviderProbeService(egress, fetchImpl)
    const result = await service.probe({
      providerId: 'custom-openai', baseUrl: 'https://llm.example.com/v1',
      modelId: 'tool-model', apiKey: 'request-secret'
    }, 'user-1', signingMaterial, undefined, 10_000)
    expect(revoked).toBe(true)
    expect(result).toMatchObject({
      contractVersion: '1.3.0', expiresAt: 3_610_000,
      capabilities: { toolCalling: true, maxContextTokens: 32_768 }
    })
    expect(verifyCapabilityToken(result.capabilityToken, signingMaterial, {
      userId: 'user-1', baseUrl: 'https://llm.example.com/v1',
      modelId: 'tool-model', apiKey: 'request-secret'
    }, 20_000)).toMatchObject({ maxContextTokens: 32_768 })
  })

  it('rejects a normal assistant response or incompatible JSON without exposing it', async () => {
    const egress: ProviderEgress = {
      async lease() {
        return {
          baseUrl: 'http://127.0.0.1:43123/lease/v1',
          normalizedTarget: 'https://llm.example.com/v1',
          revoke: () => undefined
        }
      }
    }
    const service = new DefaultProviderProbeService(
      egress,
      (async () => Response.json({ choices: [{ message: { content: 'raw provider detail' } }] })) as typeof fetch
    )
    await expect(service.probe({
      providerId: 'custom-openai', baseUrl: 'https://llm.example.com/v1',
      modelId: 'tool-model', apiKey: 'request-secret'
    }, 'user-1', signingMaterial)).rejects.toMatchObject({ code: 'AI_MODEL_PROBE_FAILED' })
  })
})
