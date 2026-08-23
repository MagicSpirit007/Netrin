export type AuthErrorKind =
  | 'invalidPhone'
  | 'weakPassword'
  | 'phoneExists'
  | 'invalidCredentials'
  | 'invalidOtp'
  | 'expiredOtp'
  | 'rateLimited'
  | 'signupDisabled'
  | 'network'
  | 'smsUnavailable'
  | 'unknown'

export type ClassifiedAuthError = {
  kind: AuthErrorKind
  code?: string
}

type ErrorLike = {
  code?: unknown
  status?: unknown
  message?: unknown
  name?: unknown
}

function safeCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return /^[a-z0-9_-]{2,64}$/.test(normalized) ? normalized : undefined
}

/** Maps Supabase/browser failures to stable, localized UI categories. */
export function classifyAuthError(error: unknown): ClassifiedAuthError {
  const candidate = error && typeof error === 'object' ? error as ErrorLike : {}
  const code = safeCode(candidate.code)
  const status = typeof candidate.status === 'number' ? candidate.status : undefined
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''
  const name = typeof candidate.name === 'string' ? candidate.name.toLowerCase() : ''

  if (
    code === 'phone_invalid' ||
    code === 'phone_address_invalid' ||
    code === 'validation_failed' && /phone/.test(message) ||
    /invalid phone|phone number.*invalid/.test(message)
  ) return { kind: 'invalidPhone', code }

  if (
    code === 'weak_password' ||
    /password.*(?:weak|short|characters|length)/.test(message)
  ) return { kind: 'weakPassword', code }

  if (
    code === 'phone_exists' ||
    code === 'user_already_exists' ||
    /already (?:been )?(?:registered|exists)|user.*exists/.test(message)
  ) return { kind: 'phoneExists', code }

  if (
    code === 'invalid_credentials' ||
    /invalid login credentials|invalid credentials/.test(message)
  ) return { kind: 'invalidCredentials', code }

  if (
    code === 'otp_expired' ||
    code === 'token_expired' ||
    /otp.*expired|token.*expired/.test(message)
  ) return { kind: 'expiredOtp', code }

  if (
    code === 'invalid_otp' ||
    /invalid.*(?:otp|token)|(?:otp|token).*invalid/.test(message)
  ) return { kind: 'invalidOtp', code }

  if (
    code === 'over_sms_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    status === 429 ||
    /rate limit|too many requests/.test(message)
  ) return { kind: 'rateLimited', code }

  if (
    code === 'signup_disabled' ||
    code === 'otp_disabled' ||
    code === 'phone_provider_disabled' ||
    /signups?.*(?:disabled|not allowed)|phone provider.*disabled/.test(message)
  ) return { kind: 'signupDisabled', code }

  if (
    name === 'typeerror' && /fetch|network/.test(message) ||
    code === 'request_timeout' ||
    /failed to fetch|network(?:error| request)|load failed|connection/.test(message)
  ) return { kind: 'network', code }

  if (
    code === 'unexpected_failure' ||
    status !== undefined && status >= 500 ||
    /sending (?:confirmation )?(?:sms|message)|sms provider|database error saving new user/.test(message)
  ) return { kind: 'smsUnavailable', code }

  return { kind: 'unknown', code }
}
