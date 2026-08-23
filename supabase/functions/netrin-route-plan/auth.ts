export type RoutePlanAuthUser = {
  id: string
  phone_confirmed_at?: string | null
}

export type RoutePlanAuthGateway = {
  getUser(token: string): Promise<{ user: RoutePlanAuthUser | null; error?: unknown }>
  getAccountStatus(userId: string): Promise<{ status: string | null; error?: unknown }>
}

export type RoutePlanAuthorization =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 | 503; error: string }

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(\S+)$/i)
  return match?.[1] ?? null
}

export async function authorizeRoutePlanRequest(
  request: Request,
  gateway: RoutePlanAuthGateway
): Promise<RoutePlanAuthorization> {
  const token = bearerToken(request)
  if (!token) return { ok: false, status: 401, error: 'Authentication required.' }

  let authResult: Awaited<ReturnType<RoutePlanAuthGateway['getUser']>>
  try {
    authResult = await gateway.getUser(token)
  } catch {
    return { ok: false, status: 503, error: 'Account validation is unavailable.' }
  }
  if (authResult.error || !authResult.user) {
    return { ok: false, status: 401, error: 'Authentication required.' }
  }
  if (!authResult.user.phone_confirmed_at) {
    return { ok: false, status: 403, error: 'A confirmed phone number is required.' }
  }

  let profileResult: Awaited<ReturnType<RoutePlanAuthGateway['getAccountStatus']>>
  try {
    profileResult = await gateway.getAccountStatus(authResult.user.id)
  } catch {
    return { ok: false, status: 503, error: 'Account validation is unavailable.' }
  }
  if (profileResult.error) {
    return { ok: false, status: 503, error: 'Account validation is unavailable.' }
  }
  if (profileResult.status !== 'active') {
    return { ok: false, status: 403, error: 'An active account is required.' }
  }

  return { ok: true, userId: authResult.user.id }
}
