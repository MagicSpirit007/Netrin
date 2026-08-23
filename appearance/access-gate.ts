export type AppearanceActor = {
  id?: string
  isAnonymous?: boolean
  phoneConfirmedAt?: string | null
  accountStatus?: string | null
  isAdmin?: boolean
}

export type AppearanceAccessResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; code: 'authentication-required' | 'account-inactive' | 'permanent-account-required' | 'phone-unconfirmed' | 'admin-required' }

export function appearanceAuthorAccess(actor: AppearanceActor): AppearanceAccessResult {
  if (!actor.id) return { ok: false, status: 401, code: 'authentication-required' }
  if (actor.accountStatus !== 'active') return { ok: false, status: 403, code: 'account-inactive' }
  if (actor.isAnonymous) return { ok: false, status: 403, code: 'permanent-account-required' }
  if (!actor.phoneConfirmedAt) return { ok: false, status: 403, code: 'phone-unconfirmed' }
  return { ok: true }
}

export function appearanceAdminAccess(actor: AppearanceActor): AppearanceAccessResult {
  const author = appearanceAuthorAccess(actor)
  if (!author.ok) return author
  return actor.isAdmin ? { ok: true } : { ok: false, status: 403, code: 'admin-required' }
}
