import { beforeEach, describe, expect, it, vi } from 'vitest'

const memory = vi.hoisted(() => new Map<string, unknown>())

vi.mock('localforage', () => ({
  default: {
    getItem: async (key: string) => memory.get(key),
    setItem: async (key: string, value: unknown) => { memory.set(key, structuredClone(value)); return value }
  }
}))

import {
  deleteCustomProviderPreset,
  loadCustomProviderPresets,
  saveCustomProviderPreset
} from './customProviderStore'

describe('custom provider non-secret presets', () => {
  beforeEach(() => memory.clear())

  it('stores at most ten normalized presets and never persists unknown secret fields', async () => {
    for (let index = 0; index < 12; index += 1) {
      await saveCustomProviderPreset({
        id: `preset-${index}`,
        name: ` Provider ${index} `,
        baseUrl: `https://llm-${index}.example.com/v1`,
        modelId: `model-${index}`,
        apiKey: 'must-not-persist'
      } as Parameters<typeof saveCustomProviderPreset>[0] & { apiKey: string })
    }
    const stored = await loadCustomProviderPresets()
    expect(stored).toHaveLength(10)
    expect(stored[0]).toMatchObject({ id: 'preset-11', name: 'Provider 11' })
    expect(JSON.stringify(memory)).not.toContain('must-not-persist')
    expect(JSON.stringify(stored)).not.toContain('must-not-persist')
  })

  it('updates by id and deletes only the selected preset', async () => {
    await saveCustomProviderPreset({
      id: 'one', name: 'One', baseUrl: 'https://one.example.com/v1', modelId: 'a'
    })
    await saveCustomProviderPreset({
      id: 'one', name: 'Updated', baseUrl: 'https://one.example.com/v1', modelId: 'b'
    })
    expect(await loadCustomProviderPresets()).toEqual([{
      id: 'one', name: 'Updated', baseUrl: 'https://one.example.com/v1', modelId: 'b'
    }])
    expect(await deleteCustomProviderPreset('one')).toEqual([])
  })
})
