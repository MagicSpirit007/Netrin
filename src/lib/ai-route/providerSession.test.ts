import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAllProviderSessionData,
  clearProviderSessionKey,
  loadProviderSessionKey,
  saveProviderSessionKey
} from './providerSession'

class MemorySessionStorage implements Storage {
  readonly #items = new Map<string, string>()
  get length() { return this.#items.size }
  clear() { this.#items.clear() }
  getItem(key: string) { return this.#items.get(key) ?? null }
  key(index: number) { return [...this.#items.keys()][index] ?? null }
  removeItem(key: string) { this.#items.delete(key) }
  setItem(key: string, value: string) { this.#items.set(key, value) }
}

describe('AI provider session key storage', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', new MemorySessionStorage())
    clearAllProviderSessionData()
  })

  it('keeps keys in page memory, isolates provider fingerprints, and avoids web storage', async () => {
    const fixed = { providerId: 'deepseek-cn' }
    const custom = { providerId: 'custom-openai', baseUrl: 'https://llm.example.com/v1' }
    await saveProviderSessionKey(fixed, 'deepseek-secret')
    await saveProviderSessionKey(custom, 'custom-secret')
    expect(await loadProviderSessionKey(fixed)).toBe('deepseek-secret')
    expect(await loadProviderSessionKey(custom)).toBe('custom-secret')
    expect(sessionStorage.length).toBe(0)
  })

  it('clears one key or all in-memory provider data without touching unrelated session state', async () => {
    const fixed = { providerId: 'deepseek-cn' }
    const custom = { providerId: 'custom-openai', baseUrl: 'https://llm.example.com/v1' }
    await saveProviderSessionKey(fixed, 'deepseek-secret')
    await saveProviderSessionKey(custom, 'custom-secret')
    sessionStorage.setItem('unrelated', 'keep-me')
    await clearProviderSessionKey(fixed)
    expect(await loadProviderSessionKey(fixed)).toBe('')
    expect(await loadProviderSessionKey(custom)).toBe('custom-secret')
    clearAllProviderSessionData()
    expect(await loadProviderSessionKey(custom)).toBe('')
    expect(sessionStorage.getItem('unrelated')).toBe('keep-me')
  })
})
