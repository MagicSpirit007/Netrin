import { describe, expect, it, vi } from 'vitest'
import { createRoutePlanHandler } from './handler'

const body = {
  travelMode: 'walking',
  from: [119.7314, 30.2577],
  to: [119.7323, 30.2584],
  purpose: 'authoring'
}

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/functions/v1/netrin-route-plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

function providerResponse(): Response {
  return Response.json({
    status: '1',
    route: {
      paths: [{
        distance: '130',
        cost: { duration: '95' },
        steps: [{
          instruction: '向东步行',
          step_distance: '130',
          cost: { duration: '95' },
          polyline: '119.735,30.255;119.736,30.256'
        }]
      }]
    }
  })
}

describe('netrin-route-plan handler', () => {
  it('does not reach the provider for anonymous or inactive callers', async () => {
    const fetchImpl = vi.fn(async () => providerResponse())
    const anonymous = createRoutePlanHandler({
      amapKey: 'key', fetchImpl,
      authorize: vi.fn(async () => ({ ok: false as const, status: 401 as const, error: 'Authentication required.' })),
      logger: { log: vi.fn(), warn: vi.fn() }
    })
    const inactive = createRoutePlanHandler({
      amapKey: 'key', fetchImpl,
      authorize: vi.fn(async () => ({ ok: false as const, status: 403 as const, error: 'An active account is required.' })),
      logger: { log: vi.fn(), warn: vi.fn() }
    })
    expect((await anonymous(request())).status).toBe(401)
    expect((await inactive(request())).status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('cannot turn anonymous requests into provider quota consumption', async () => {
    const fetchImpl = vi.fn(async () => providerResponse())
    const handler = createRoutePlanHandler({
      amapKey: 'key', fetchImpl,
      authorize: vi.fn(async () => ({ ok: false as const, status: 401 as const, error: 'Authentication required.' })),
      logger: { log: vi.fn(), warn: vi.fn() }
    })
    for (let index = 0; index < 64; index += 1) {
      const response = await handler(request({
        'x-forwarded-for': `203.0.113.${index}`,
        forwarded: `for=198.51.100.${index}`
      }))
      expect(response.status).toBe(401)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('preserves the successful route response and shared cache for a valid caller', async () => {
    const fetchImpl = vi.fn(async () => providerResponse())
    const authorize = vi.fn(async () => ({ ok: true as const, userId: 'user-1' }))
    const handler = createRoutePlanHandler({
      amapKey: 'key', fetchImpl, authorize,
      logger: { log: vi.fn(), warn: vi.fn() }
    })
    const first = await handler(request({ 'x-real-ip': '198.51.100.7' }))
    const second = await handler(request({ 'x-real-ip': '198.51.100.7' }))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await first.json()).geometry.type).toBe('LineString')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(authorize).toHaveBeenCalledTimes(2)
  })

  it('cannot bypass a user rate limit by spoofing forwarded chains', async () => {
    const fetchImpl = vi.fn(async () => providerResponse())
    const handler = createRoutePlanHandler({
      amapKey: 'key', fetchImpl,
      authorize: vi.fn(async () => ({ ok: true as const, userId: 'user-1' })),
      logger: { log: vi.fn(), warn: vi.fn() }
    })
    for (let index = 0; index < 30; index += 1) {
      const response = await handler(request({ 'x-forwarded-for': `203.0.113.${index}` }))
      expect(response.status).toBe(200)
    }
    expect((await handler(request({ 'x-forwarded-for': '203.0.113.250' }))).status).toBe(429)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('keeps provider failures behind a safe error response', async () => {
    const handler = createRoutePlanHandler({
      amapKey: 'key',
      fetchImpl: vi.fn(async () => new Response('upstream failure', { status: 500 })),
      authorize: vi.fn(async () => ({ ok: true as const, userId: 'user-1' })),
      logger: { log: vi.fn(), warn: vi.fn() }
    })
    const response = await handler(request())
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Route provider unavailable.' })
  })
})
