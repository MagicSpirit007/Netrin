import { describe, expect, it } from 'vitest'
import { classifyAuthError } from './authError'

describe('classifyAuthError', () => {
  it.each([
    [{ code: 'phone_invalid' }, 'invalidPhone'],
    [{ code: 'weak_password' }, 'weakPassword'],
    [{ code: 'phone_exists' }, 'phoneExists'],
    [{ code: 'invalid_credentials' }, 'invalidCredentials'],
    [{ code: 'invalid_otp' }, 'invalidOtp'],
    [{ code: 'otp_expired' }, 'expiredOtp'],
    [{ code: 'over_sms_send_rate_limit', status: 429 }, 'rateLimited'],
    [{ code: 'signup_disabled' }, 'signupDisabled'],
    [{ code: 'otp_disabled' }, 'signupDisabled'],
    [new TypeError('Failed to fetch'), 'network'],
    [{ code: 'unexpected_failure', status: 500 }, 'smsUnavailable']
  ])('maps %o to %s', (error, expected) => {
    expect(classifyAuthError(error).kind).toBe(expected)
  })

  it('keeps only a safe opaque code for unknown failures', () => {
    expect(classifyAuthError({ code: 'safe_code', message: 'internal detail' })).toEqual({
      kind: 'unknown',
      code: 'safe_code'
    })
    expect(classifyAuthError({ code: '<secret>', message: 'internal detail' })).toEqual({
      kind: 'unknown'
    })
  })
})
