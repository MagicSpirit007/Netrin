const KEY_PREFIX = 'netrin.ai.provider-key.'

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
  try { return sessionStorage.getItem(await storageKey(KEY_PREFIX, identity)) ?? '' } catch { return '' }
}

export async function saveProviderSessionKey(identity: ProviderSessionIdentity, apiKey: string): Promise<void> {
  try {
    const key = await storageKey(KEY_PREFIX, identity)
    if (apiKey) sessionStorage.setItem(key, apiKey)
    else sessionStorage.removeItem(key)
  } catch {
    // Session persistence is optional; the in-memory form remains usable.
  }
}

export async function clearProviderSessionKey(identity: ProviderSessionIdentity): Promise<void> {
  try { sessionStorage.removeItem(await storageKey(KEY_PREFIX, identity)) } catch { /* noop */ }
}

export function clearAllProviderSessionData(): void {
  try {
    const remove: string[] = []
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(KEY_PREFIX)) remove.push(key)
    }
    remove.forEach((key) => sessionStorage.removeItem(key))
  } catch { /* noop */ }
}
