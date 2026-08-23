import localforage from 'localforage'

const STORAGE_KEY = 'netrin.ai.custom-providers.v1'
const MAX_PRESETS = 10

export type CustomProviderPreset = {
  id: string
  name: string
  baseUrl: string
  modelId: string
}

function normalizePreset(value: unknown): CustomProviderPreset | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Partial<CustomProviderPreset>
  if (typeof item.id !== 'string' || !item.id.trim() ||
      typeof item.name !== 'string' || !item.name.trim() ||
      typeof item.baseUrl !== 'string' || !item.baseUrl.trim() ||
      typeof item.modelId !== 'string') return undefined
  return {
    id: item.id.trim().slice(0, 80),
    name: item.name.trim().slice(0, 80),
    baseUrl: item.baseUrl.trim().slice(0, 512),
    modelId: item.modelId.trim().slice(0, 200)
  }
}

export async function loadCustomProviderPresets(): Promise<CustomProviderPreset[]> {
  try {
    const value = await localforage.getItem<unknown>(STORAGE_KEY)
    if (!Array.isArray(value)) return []
    return value.map(normalizePreset).filter((item): item is CustomProviderPreset => Boolean(item)).slice(0, MAX_PRESETS)
  } catch {
    return []
  }
}

export async function saveCustomProviderPreset(preset: CustomProviderPreset): Promise<CustomProviderPreset[]> {
  const normalized = normalizePreset(preset)
  if (!normalized) return loadCustomProviderPresets()
  const current = await loadCustomProviderPresets()
  const next = [normalized, ...current.filter((item) => item.id !== normalized.id)].slice(0, MAX_PRESETS)
  try { await localforage.setItem(STORAGE_KEY, next) } catch { /* local enhancement */ }
  return next
}

export async function deleteCustomProviderPreset(id: string): Promise<CustomProviderPreset[]> {
  const next = (await loadCustomProviderPresets()).filter((item) => item.id !== id)
  try { await localforage.setItem(STORAGE_KEY, next) } catch { /* local enhancement */ }
  return next
}
