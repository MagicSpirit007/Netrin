const KEY_PREFIX = 'netrin.ai.provider-key.'
const providerKeys = new Map<string, string>()

export type ProviderSessionIdentity = {
  providerId: string
  baseUrl?: string
}

async function fingerprint(identity: ProviderSessionIdentity): Promise<string> {
  const input = new TextEncoder().encode(`${identity.providerId}\0${identity.baseUrl?.trim() ?? ''}`)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function storageKey(prefix: string, identity: ProviderSessionIdentity): Promise<string> {
  return `${prefix}${await fingerprint(identity)}`
}

export async function loadProviderSessionKey(identity: ProviderSessionIdentity): Promise<string> {
  try { return providerKeys.get(await storageKey(KEY_PREFIX, identity)) ?? '' } catch { return '' }
}

export async function saveProviderSessionKey(identity: ProviderSessionIdentity, apiKey: string): Promise<void> {
  try {
    const key = await storageKey(KEY_PREFIX, identity)
    if (apiKey) providerKeys.set(key, apiKey)
    else providerKeys.delete(key)
  } catch {
    // The screen-local form value remains usable if fingerprinting is unavailable.
  }
}

export async function clearProviderSessionKey(identity: ProviderSessionIdentity): Promise<void> {
  try { providerKeys.delete(await storageKey(KEY_PREFIX, identity)) } catch { /* noop */ }
}

export function clearAllProviderSessionData(): void {
  providerKeys.clear()
}
