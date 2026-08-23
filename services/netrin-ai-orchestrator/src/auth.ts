import { createHash } from 'node:crypto'
import { AiRouteError } from './errors.js'

export type AuthenticatedUser = {
  id: string
  anonymousId: string
  accessToken: string
}

export interface UserAuthenticator {
  authenticate(authorization: string | null, signal?: AbortSignal): Promise<AuthenticatedUser>
}

export class SupabaseUserAuthenticator implements UserAuthenticator {
  readonly #url: string
  readonly #anonKey: string
  readonly #fetch: typeof fetch

  constructor(url: string, anonKey: string, fetchImpl: typeof fetch = fetch) {
    this.#url = url
    this.#anonKey = anonKey
    this.#fetch = fetchImpl
  }

  async authenticate(authorization: string | null, signal?: AbortSignal): Promise<AuthenticatedUser> {
    const match = authorization?.match(/^Bearer ([^\s]+)$/)
    if (!match) throw new AiRouteError('AI_AUTH_REQUIRED', 401)
    let response: Response
    try {
      response = await this.#fetch(`${this.#url}/auth/v1/user`, {
        signal,
        headers: { authorization: `Bearer ${match[1]}`, apikey: this.#anonKey }
      })
    } catch {
      if (signal?.aborted) throw new AiRouteError('AI_ABORTED', 499)
      throw new AiRouteError('AI_ACCOUNT_UNAVAILABLE', 503)
    }
    if (!response.ok) throw new AiRouteError('AI_AUTH_REQUIRED', 401)
    const user = await response.json() as {
      id?: unknown
      phone?: unknown
      phone_confirmed_at?: unknown
      is_anonymous?: unknown
    }
    if (typeof user.id !== 'string' || user.is_anonymous === true) {
      throw new AiRouteError('AI_ACCOUNT_UNAVAILABLE', 403)
    }
    if (typeof user.phone !== 'string' || !user.phone ||
        typeof user.phone_confirmed_at !== 'string' || !user.phone_confirmed_at) {
      throw new AiRouteError('AI_PHONE_VERIFICATION_REQUIRED', 403)
    }
    let accountResponse: Response
    try {
      accountResponse = await this.#fetch(`${this.#url}/rest/v1/rpc/get_my_account_v1`, {
        method: 'POST',
        signal,
        headers: {
          authorization: `Bearer ${match[1]}`,
          apikey: this.#anonKey,
          'content-type': 'application/json'
        },
        body: '{}'
      })
    } catch {
      if (signal?.aborted) throw new AiRouteError('AI_ABORTED', 499)
      throw new AiRouteError('AI_ACCOUNT_UNAVAILABLE', 503)
    }
    if (!accountResponse.ok) throw new AiRouteError('AI_ACCOUNT_UNAVAILABLE', 403)
    const account = await accountResponse.json() as { status?: unknown } | null
    if (!account || account.status !== 'active') {
      throw new AiRouteError('AI_ACCOUNT_UNAVAILABLE', 403)
    }
    return {
      id: user.id,
      anonymousId: createHash('sha256').update(user.id).digest('hex').slice(0, 20),
      accessToken: match[1]
    }
  }
}
