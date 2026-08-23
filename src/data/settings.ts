import localforage from 'localforage'
import {
  MAP_STYLE_IDS,
  type AppearanceSettings,
  type MapStyleId
} from './types'

const SETTINGS_KEY = 'netrin.appearance'

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  mapStyleId: 'dark',
  appearanceId: 'field-guide-phenotype'
}

const LEGACY_MAP_STYLE_IDS: Record<string, MapStyleId> = {
  'field-console': 'dark',
  'campus-atlas': 'normal',
  'forest-walk': 'fresh',
  'night-trace': 'darkblue',
  'osm-clear': 'normal',
  'night-high-contrast': 'darkblue',
  'offline-simple': 'dark'
}

function isMapStyleId(value: unknown): value is MapStyleId {
  return typeof value === 'string' && MAP_STYLE_IDS.includes(value as MapStyleId)
}

function normalizeMapStyleId(value: unknown): MapStyleId {
  if (isMapStyleId(value)) return value
  if (typeof value === 'string' && LEGACY_MAP_STYLE_IDS[value]) return LEGACY_MAP_STYLE_IDS[value]
  return DEFAULT_APPEARANCE_SETTINGS.mapStyleId
}

function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<AppearanceSettings> : {}
  return {
    mapStyleId: normalizeMapStyleId(candidate.mapStyleId),
    appearanceId:
      typeof candidate.appearanceId === 'string' && candidate.appearanceId.trim()
        ? candidate.appearanceId.trim()
        : DEFAULT_APPEARANCE_SETTINGS.appearanceId
  }
}

export async function loadAppearanceSettings(): Promise<AppearanceSettings> {
  if (import.meta.env.DEV && import.meta.env.NETRIN_APPEARANCE_DEV_ISOLATED === '1') return DEFAULT_APPEARANCE_SETTINGS
  try {
    const value = await localforage.getItem<AppearanceSettings>(SETTINGS_KEY)
    return normalizeAppearanceSettings(value)
  } catch {
    return DEFAULT_APPEARANCE_SETTINGS
  }
}

export async function saveAppearanceSettings(settings: AppearanceSettings): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.NETRIN_APPEARANCE_DEV_ISOLATED === '1') return
  try {
    await localforage.setItem(SETTINGS_KEY, normalizeAppearanceSettings(settings))
  } catch {
    // Settings are an enhancement; the default remains usable if storage fails.
  }
}
