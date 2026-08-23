import { describe, expect, it, vi } from 'vitest'
import { authorizeRoutePlanRequest, bearerToken, type RoutePlanAuthGateway } from './auth'

function request(authorization?: string): Request {
  return new Request('https://example.test/functions/v1/netrin-route-plan', {
    method: 'POST',
    headers: authorization ? { authorization } : undefined
  })
}

function gateway(overrides: Partial<RoutePlanAuthGateway> = {}): RoutePlanAuthGateway {
  return {
    getUser: vi.fn(async () => ({
      user: { id: 'user-1', phone_confirmed_at: '2026-08-23T00:00:00.000Z' }
    })),
    getAccountStatus: vi.fn(async () => ({ status: 'active' })),
    ...overrides
  }
}

describe('netrin-route-plan authorization', () => {
  it('accepts one strict bearer token and rejects alternate encodings', () => {
    expect(bearerToken(request('Bearer token-value'))).toBe('token-value')
    expect(bearerToken(request('bearer token-value'))).toBe('token-value')
    expect(bearerToken(request('Basic token-value'))).toBeNull()
    expect(bearerToken(request('Bearer token-value trailing'))).toBeNull()
    expect(bearerToken(request())).toBeNull()
  })

  it('rejects anonymous requests before consulting identity storage', async () => {
    const identity = gateway()
    await expect(authorizeRoutePlanRequest(request(), identity)).resolves.toEqual({
      ok: false,
      status: 401,
      error: 'Authentication required.'
    })
    expect(identity.getUser).not.toHaveBeenCalled()
  })

  it('rejects invalid sessions, unconfirmed phones, and inactive accounts', async () => {
    await expect(authorizeRoutePlanRequest(request('Bearer bad'), gateway({
      getUser: vi.fn(async () => ({ user: null, error: new Error('invalid') }))
    }))).resolves.toMatchObject({ ok: false, status: 401 })
    await expect(authorizeRoutePlanRequest(request('Bearer unconfirmed'), gateway({
      getUser: vi.fn(async () => ({ user: { id: 'user-1', phone_confirmed_at: null } }))
    }))).resolves.toMatchObject({ ok: false, status: 403 })
    await expect(authorizeRoutePlanRequest(request('Bearer suspended'), gateway({
      getAccountStatus: vi.fn(async () => ({ status: 'suspended' }))
    }))).resolves.toMatchObject({ ok: false, status: 403 })
  })

  it('fails closed when account validation is unavailable', async () => {
    await expect(authorizeRoutePlanRequest(request('Bearer token'), gateway({
      getAccountStatus: vi.fn(async () => ({ status: null, error: new Error('database unavailable') }))
    }))).resolves.toMatchObject({ ok: false, status: 503 })
  })

  it('authorizes only an active, phone-confirmed user', async () => {
    await expect(authorizeRoutePlanRequest(request('Bearer token'), gateway())).resolves.toEqual({
      ok: true,
      userId: 'user-1'
    })
  })
})
