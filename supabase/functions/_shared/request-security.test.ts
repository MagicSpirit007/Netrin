import { describe, expect, it } from 'vitest'
import {
  consumeFixedWindowLimit,
  contentLengthExceeds,
  trustedProxyClientKey,
  type RateWindow
} from './request-security'

describe('Edge request security helpers', () => {
  it('rejects declared oversized bodies without rejecting absent lengths', () => {
    expect(contentLengthExceeds(new Request('https://example.test'), 64)).toBe(false)
    expect(contentLengthExceeds(new Request('https://example.test', { headers: { 'content-length': '65' } }), 64)).toBe(true)
  })

  it('uses only the trusted proxy header and ignores spoofable forwarded chains', () => {
    const request = new Request('https://example.test', {
      headers: { 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '198.51.100.7' }
    })
    expect(trustedProxyClientKey(request)).toBe('198.51.100.7')
    expect(trustedProxyClientKey(new Request('https://example.test', {
      headers: { 'x-forwarded-for': '203.0.113.9' }
    }))).toBe('untrusted')
    expect(trustedProxyClientKey(new Request('https://example.test', {
      headers: { forwarded: 'for=203.0.113.9', 'cf-connecting-ip': '203.0.113.10' }
    }))).toBe('untrusted')
    expect(trustedProxyClientKey(new Request('https://example.test', {
      headers: { 'x-real-ip': '999.1.1.1' }
    }))).toBe('untrusted')
    expect(trustedProxyClientKey(new Request('https://example.test', {
      headers: { 'x-real-ip': 'not-an-ip:payload' }
    }))).toBe('untrusted')
  })

  it('caps attacker-created limiter keys and reclaims expired windows', () => {
    const windows = new Map<string, RateWindow>([
      ['first', { startedAt: 0, count: 1 }],
      ['second', { startedAt: 900, count: 1 }]
    ])
    expect(consumeFixedWindowLimit(windows, 'third', 1_000, 500, 2, 2)).toBe(true)
    expect(windows.has('first')).toBe(false)
    expect(consumeFixedWindowLimit(windows, 'fourth', 1_000, 500, 2, 2)).toBe(false)
  })
})
