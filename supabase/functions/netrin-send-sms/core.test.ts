import { Webhook } from 'standardwebhooks'
import { describe, expect, it } from 'vitest'
import {
  buildProviderRequest,
  maskPhone,
  providerAccepted,
  readHookTarget,
  resolveProviderRequestId,
  safeProviderError,
  webhookSigningSecret
} from './core'

describe('netrin-send-sms core', () => {
  it('accepts only a mainland E.164 phone and six digit OTP', () => {
    expect(readHookTarget({
      user: { phone: null },
      sms: { phone: '8613800138000', otp: '123456' }
    })).toEqual({
      phone: '+8613800138000',
      otp: '123456'
    })
    expect(readHookTarget({ user: { phone: '+8613800138000' }, sms: { otp: '123456' } })).toEqual({
      phone: '+8613800138000',
      otp: '123456'
    })
    expect(readHookTarget({ user: { phone: '13800138000' }, sms: { otp: '123456' } })).toBeNull()
    expect(readHookTarget({ user: { phone: '+8612800138000' }, sms: { otp: '123456' } })).toBeNull()
    expect(readHookTarget({ user: { phone: '+8613800138000' }, sms: { otp: '12345' } })).toBeNull()
  })

  it('verifies Standard Webhooks signatures with the configured secret format', () => {
    const encodedKey = Buffer.from('netrin-test-hook-key-32-bytes!!').toString('base64')
    const webhook = new Webhook(webhookSigningSecret(`v1,whsec_${encodedKey}`))
    const payload = JSON.stringify({ user: { phone: '+8613800138000' }, sms: { otp: '123456' } })
    const timestamp = new Date()
    const headers = {
      'webhook-id': 'msg_netrin_test',
      'webhook-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
      'webhook-signature': webhook.sign('msg_netrin_test', timestamp, payload)
    }

    expect(webhook.verify(payload, headers)).toEqual(JSON.parse(payload))
    expect(() => webhook.verify(`${payload} `, headers)).toThrow()
  })

  it('builds the fixed PNVS request without returning the OTP', () => {
    expect(buildProviderRequest('+8613800138000', '123456', '系统签名', '100001', 'out-id')).toEqual({
      autoRetry: 1,
      codeLength: 6,
      countryCode: '86',
      duplicatePolicy: 1,
      interval: 60,
      outId: 'out-id',
      phoneNumber: '13800138000',
      returnVerifyCode: false,
      signName: '系统签名',
      templateCode: '100001',
      templateParam: '{"code":"123456","min":"5"}',
      validTime: 300
    })
  })

  it('requires both Success=true and Code=OK', () => {
    expect(providerAccepted({ success: true, code: 'OK' })).toBe(true)
    expect(providerAccepted({ success: false, code: 'OK' })).toBe(false)
    expect(providerAccepted({ success: true, code: 'BUSINESS_LIMIT_CONTROL' })).toBe(false)
    expect(providerAccepted(undefined)).toBe(false)
  })

  it('keeps provider failures and logs free of complete phone or arbitrary details', () => {
    expect(maskPhone('+8613800138000')).toBe('138****8000')
    expect(safeProviderError({ code: 'FREQUENCY_FAIL', requestId: '12345678-ABCD' })).toEqual({
      code: 'FREQUENCY_FAIL',
      requestId: '12345678-ABCD'
    })
    expect(safeProviderError({ code: '<secret>', requestId: 'short', message: 'do not log me' })).toEqual({
      code: 'PROVIDER_REQUEST_FAILED',
      requestId: undefined
    })
    expect(resolveProviderRequestId({ model: { requestId: 'provider-request-id' } }, 'fallback')).toBe('provider-request-id')
  })
})
