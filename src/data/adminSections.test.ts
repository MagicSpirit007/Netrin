import { describe, expect, it } from 'vitest'
import { adminSection, loadAdminSection, settleAdminSection } from './adminSections'
import adminScreenSource from '../screens/AdminScreen.tsx?raw'

describe('administrator section reliability', () => {
  it('preserves successful data when its later refresh fails', () => {
    const ready = settleAdminSection(adminSection<string[]>([]), { ok: true, data: ['approved appearance'] })
    const loading = loadAdminSection(ready)
    const failed = settleAdminSection(loading, {
      ok: false,
      error: { operation: 'load-accounts', message: 'Request failed', requestId: '12345678-safe' }
    })
    expect(failed.data).toEqual(['approved appearance'])
    expect(failed.status).toBe('error')
    expect(failed.error?.operation).toBe('load-accounts')
  })

  it('keeps approval feedback independent from unrelated refresh errors', () => {
    const approvalNotice = '外观方案已通过审核'
    const accounts = settleAdminSection(adminSection<string[]>(['existing account']), {
      ok: false,
      error: { operation: 'load-accounts', message: 'Request failed', requestId: '12345678-safe' }
    })
    expect(approvalNotice).toBe('外观方案已通过审核')
    expect(accounts.error).toMatchObject({ operation: 'load-accounts' })
    expect(accounts.data).toEqual(['existing account'])
    const refreshBody = adminScreenSource.slice(adminScreenSource.indexOf('const refresh'), adminScreenSource.indexOf('useEffect(() => { void refresh()'))
    expect(refreshBody).not.toContain('setNotice(')
    expect(adminScreenSource).toContain("setNotice(result.ok ? t(`admin.appearanceDecision.${decision}`)")
    expect(adminScreenSource).toContain("refresh('accounts')")
  })
})
