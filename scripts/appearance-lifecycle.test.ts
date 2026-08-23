import { afterEach, describe, expect, it } from 'vitest'
import { startAiCapabilitiesMock } from './lib/ai-capabilities-mock.mjs'
import { readFileSync } from 'node:fs'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('appearance review listener lifecycle', () => {
  it('keeps the mock listener owned across build and smoke without a free-port probe', () => {
    const reviewSource = readFileSync(new URL('./appearance-review.ts', import.meta.url), 'utf8')
    const smokeSource = readFileSync(new URL('./browser-smoke.mjs', import.meta.url), 'utf8')
    expect(reviewSource).not.toContain('freePort')
    expect(reviewSource).toContain('startAiCapabilitiesMock()')
    expect(reviewSource).toContain('NETRIN_SMOKE_AI_BASE_URL: aiMock.url')
    expect(smokeSource).toContain('if (!externalAiMockUrl) aiMock = await startAiCapabilitiesMock')
    expect(smokeSource).toContain("await cdp?.send('Browser.close')")
  })
  it('runs sequential mocks on operating-system assigned ports and closes each port', async () => {
    const first = await startAiCapabilitiesMock()
    const firstUrl = first.url
    expect((await fetch(`${firstUrl}/v1/ai-route/providers`)).ok).toBe(true)
    await first.close()
    await expect(fetch(`${firstUrl}/v1/ai-route/providers`)).rejects.toThrow()
    const second = await startAiCapabilitiesMock()
    cleanups.push(second.close)
    expect((await fetch(`${second.url}/v1/ai-route/providers`)).ok).toBe(true)
  })

  it('runs parallel mocks without EADDRINUSE and records only loopback requests', async () => {
    const mocks = await Promise.all([startAiCapabilitiesMock(), startAiCapabilitiesMock(), startAiCapabilitiesMock()])
    cleanups.push(...mocks.map((mock) => mock.close))
    expect(new Set(mocks.map((mock) => mock.port)).size).toBe(3)
    await Promise.all(mocks.map((mock) => fetch(`${mock.url}/v1/ai-route/providers`)))
    expect(mocks.every((mock) => mock.requests.length === 1 && mock.requests[0].url === '/v1/ai-route/providers')).toBe(true)
  })

  it('provides a deterministic local analyze and plan flow without external services', async () => {
    const mock = await startAiCapabilitiesMock()
    cleanups.push(mock.close)
    const analyzeResponse = await fetch(`${mock.url}/v1/ai-route/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { kind: 'prompt', text: '本地预览路线' },
        constraints: { region: '预览区域', travelMode: 'walking', maximumStops: 4 },
        locale: 'zh-CN'
      })
    })
    expect(analyzeResponse.ok).toBe(true)
    const analyze = await analyzeResponse.json() as {
      requestId: string
      normalizedConstraints: Record<string, unknown>
      candidates: Array<{
        candidateId: string
        placeIntent: { reason: string; priority: string; estimatedStayMinutes?: number }
        options: Array<{ optionRef: string }>
      }>
      proposedOrder: string[]
    }
    expect(analyze.candidates).toHaveLength(2)

    const planResponse = await fetch(`${mock.url}/v1/ai-route/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        analyzeRequestId: analyze.requestId,
        constraints: analyze.normalizedConstraints,
        selectedStops: analyze.candidates.map((candidate, index) => ({
          candidateId: candidate.candidateId,
          optionRef: candidate.options[0]?.optionRef,
          intent: { reason: candidate.placeIntent.reason, priority: candidate.placeIntent.priority },
          userLockedOrder: index,
          estimatedStayMinutes: candidate.placeIntent.estimatedStayMinutes
        })),
        proposedOrder: analyze.proposedOrder
      })
    })
    expect(planResponse.ok).toBe(true)
    const plan = await planResponse.json() as {
      canConfirmGeometry: boolean
      stops: unknown[]
      geometryCandidate?: { coordinates: unknown[] }
    }
    expect(plan.canConfirmGeometry).toBe(true)
    expect(plan.stops).toHaveLength(2)
    expect(plan.geometryCandidate?.coordinates).toHaveLength(2)
  })
})
