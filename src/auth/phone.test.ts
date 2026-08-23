import { describe, expect, it } from 'vitest'
import { formatChinaPhoneInput, maskChinaPhone, normalizeChinaPhone } from './phone'

describe('mainland China phone helpers', () => {
  it.each([
    ['13800138000', '+8613800138000'],
    ['+86 138 0013 8000', '+8613800138000'],
    ['0086-138-0013-8000', '+8613800138000'],
    ['8613800138000', '+8613800138000']
  ])('normalizes %s', (input, expected) => {
    expect(normalizeChinaPhone(input)).toBe(expected)
  })

  it.each(['', '12800138000', '1380013800', '+85213800138000', '1380013800x'])('rejects %s', (input) => {
    expect(normalizeChinaPhone(input)).toBeNull()
  })

  it('formats and masks without exposing the complete number', () => {
    expect(formatChinaPhoneInput('+8613800138000')).toBe('13800138000')
    expect(maskChinaPhone('+8613800138000')).toBe('138****8000')
    expect(maskChinaPhone('invalid')).toBe('')
  })
})
