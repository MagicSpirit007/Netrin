import { describe, expect, it } from 'vitest'
import { appearanceAdminAccess, appearanceAuthorAccess } from '../../appearance/access-gate'

const active = { id: 'author-1', accountStatus: 'active', phoneConfirmedAt: '2026-08-13T00:00:00Z', isAnonymous: false }

describe('appearance author and administrator access gates', () => {
  it('allows an active permanent confirmed author', () => {
    expect(appearanceAuthorAccess(active)).toEqual({ ok: true })
  })

  it.each([
    [{}, 'authentication-required'],
    [{ ...active, accountStatus: 'suspended' }, 'account-inactive'],
    [{ ...active, isAnonymous: true }, 'permanent-account-required'],
    [{ ...active, phoneConfirmedAt: null }, 'phone-unconfirmed']
  ] as const)('rejects an ineligible author', (actor, code) => {
    expect(appearanceAuthorAccess(actor)).toMatchObject({ ok: false, code })
  })

  it('requires the active actor to hold the administrator role', () => {
    expect(appearanceAdminAccess(active)).toMatchObject({ ok: false, code: 'admin-required' })
    expect(appearanceAdminAccess({ ...active, isAdmin: true })).toEqual({ ok: true })
    expect(appearanceAdminAccess({ ...active, isAdmin: true, accountStatus: 'suspended' }))
      .toMatchObject({ ok: false, code: 'account-inactive' })
  })
})
