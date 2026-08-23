import localforage from 'localforage'
import { loadAppearanceSettings, saveAppearanceSettings } from '../data/settings'
import {
  APPEARANCE_EXTENSION,
  APPEARANCE_MIME,
  createAppearanceArchive,
  parseAppearanceArchive,
  parseAppearanceFile,
  unsupportedLegacyAppearance
} from './packageFormat'
import { compileAppearanceTokens, createDefaultTokenDocument } from './tokenCompiler'
import type {
  AppearanceExport,
  AppearanceImportResult,
  AppearancePackage,
  LegacyAppearanceRecord
} from './types'

const LEGACY_JSON_KEY = 'netrin.appearancePackages.v1'
const LEGACY_ARCHIVE_KEY = 'netrin.appearancePackages.v2'
const PACKAGES_KEY = 'netrin.appearancePackages.v3'
export const APPEARANCE_REPOSITORY_EVENT = 'netrin:appearance-repository-change'

type StoredAppearance = {
  id: string
  archive: Uint8Array
  installedAt: string
}

type LegacyArchiveRecord = {
  id: string
  archive?: Uint8Array
  legacyJson?: string
}

function asArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

function bytesFrom(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

function announceRepositoryChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(APPEARANCE_REPOSITORY_EVENT))
}

const fieldGuideTokens = createDefaultTokenDocument()
const fieldGuideCompilation = compileAppearanceTokens(fieldGuideTokens)

export const FIELD_GUIDE_APPEARANCE: AppearancePackage = {
  manifest: {
    schemaVersion: 3,
    packageFormat: 'netrin-appearance-zip',
    interfaceContractVersion: 2,
    id: 'field-guide-phenotype',
    displayName: 'Field Guide',
    summary: 'Bundled Netrin field-console phenotype.',
    version: '1.0.0',
    type: 'phenotype',
    author: 'Netrin',
    license: 'Project license',
    compatibility: { minAppVersion: '0.1.0' },
    entrypoints: { tokens: 'tokens.json', theme: 'theme.css' },
    assets: [],
    files: []
  },
  tokensDocument: fieldGuideTokens,
  compiledTokens: fieldGuideCompilation.compiledTokens,
  builtin: true
}

async function loadStoredRecords(): Promise<StoredAppearance[]> {
  try {
    const value = await localforage.getItem<StoredAppearance[]>(PACKAGES_KEY)
    return Array.isArray(value) ? value.filter((record) => record?.id && record.archive) : []
  } catch {
    return []
  }
}

async function saveStoredRecords(records: StoredAppearance[]): Promise<void> {
  await localforage.setItem(PACKAGES_KEY, records)
  announceRepositoryChange()
}

async function parseStored(record: StoredAppearance): Promise<AppearancePackage | undefined> {
  try {
    return (await parseAppearanceArchive(bytesFrom(record.archive))).package
  } catch {
    return undefined
  }
}

async function loadCustomPackages(): Promise<AppearancePackage[]> {
  const parsed = await Promise.all((await loadStoredRecords()).map(parseStored))
  return parsed.filter((item): item is AppearancePackage => Boolean(item))
}

function legacyJsonId(value: unknown, index: number): string {
  if (value && typeof value === 'object' && 'manifest' in value) {
    const manifest = (value as { manifest?: unknown }).manifest
    if (manifest && typeof manifest === 'object' && 'id' in manifest && typeof manifest.id === 'string') return manifest.id
  }
  return `legacy-json-${index + 1}`
}

async function loadLegacyRecords(): Promise<Array<LegacyAppearanceRecord & { raw: string | Uint8Array }>> {
  const settings = await loadAppearanceSettings()
  const output: Array<LegacyAppearanceRecord & { raw: string | Uint8Array }> = []
  try {
    const jsonRecords = await localforage.getItem<unknown[]>(LEGACY_JSON_KEY)
    if (Array.isArray(jsonRecords)) {
      jsonRecords.forEach((value, index) => {
        const raw = JSON.stringify(value)
        const id = legacyJsonId(value, index)
        output.push({ id, bytes: new TextEncoder().encode(raw).byteLength, source: 'v1-json', active: settings.appearanceId === id, raw })
      })
    }
    const archiveRecords = await localforage.getItem<LegacyArchiveRecord[]>(LEGACY_ARCHIVE_KEY)
    if (Array.isArray(archiveRecords)) {
      archiveRecords.forEach((record) => {
        const raw = record.archive ? bytesFrom(record.archive) : record.legacyJson ?? ''
        output.push({
          id: record.id,
          bytes: typeof raw === 'string' ? new TextEncoder().encode(raw).byteLength : raw.byteLength,
          source: record.archive ? 'v2-archive' : 'v1-json',
          active: settings.appearanceId === record.id,
          raw
        })
      })
    }
  } catch {
    return output
  }
  return output
}

export interface AppearanceRepository {
  list(): Promise<AppearancePackage[]>
  inspect(input: Blob | string): Promise<AppearanceImportResult>
  import(input: Blob | string): Promise<AppearanceImportResult>
  export(id: string): Promise<AppearanceExport | undefined>
  get(id: string): Promise<AppearancePackage | undefined>
  remove(id: string): Promise<boolean>
  setActive(id: string): Promise<boolean>
  resolveActive(id: string): Promise<{ appearance: AppearancePackage; fellBack: boolean; previousId?: string }>
  listLegacy(): Promise<LegacyAppearanceRecord[]>
  exportLegacy(id: string): Promise<AppearanceExport | undefined>
  removeLegacy(id: string): Promise<boolean>
}

export const localAppearanceRepository: AppearanceRepository = {
  async list() {
    const custom = await loadCustomPackages()
    return [FIELD_GUIDE_APPEARANCE, ...custom.filter((item) => item.manifest.id !== FIELD_GUIDE_APPEARANCE.manifest.id)]
  },
  async inspect(input) {
    if (typeof input === 'string') return unsupportedLegacyAppearance()
    return parseAppearanceFile(input)
  },
  async import(input) {
    if (typeof input === 'string') return unsupportedLegacyAppearance()
    const bytes = new Uint8Array(await input.arrayBuffer())
    const result = await parseAppearanceArchive(bytes)
    if (!result.package) return result
    const current = await loadStoredRecords()
    await saveStoredRecords([
      { id: result.package.manifest.id, archive: bytes, installedAt: new Date().toISOString() },
      ...current.filter((item) => item.id !== result.package!.manifest.id)
    ])
    return result
  },
  async export(id) {
    if (id === FIELD_GUIDE_APPEARANCE.manifest.id) return undefined
    const record = (await loadStoredRecords()).find((item) => item.id === id)
    if (!record) return undefined
    return {
      blob: new Blob([asArrayBuffer(bytesFrom(record.archive))], { type: APPEARANCE_MIME }),
      fileName: `${id}${APPEARANCE_EXTENSION}`
    }
  },
  async get(id) {
    if (id === FIELD_GUIDE_APPEARANCE.manifest.id) return FIELD_GUIDE_APPEARANCE
    const record = (await loadStoredRecords()).find((item) => item.id === id)
    return record ? parseStored(record) : undefined
  },
  async remove(id) {
    if (id === FIELD_GUIDE_APPEARANCE.manifest.id) return false
    const current = await loadStoredRecords()
    const next = current.filter((item) => item.id !== id)
    if (next.length === current.length) return false
    await saveStoredRecords(next)
    const settings = await loadAppearanceSettings()
    if (settings.appearanceId === id) {
      await saveAppearanceSettings({ ...settings, appearanceId: FIELD_GUIDE_APPEARANCE.manifest.id })
    }
    return true
  },
  async setActive(id) {
    const appearance = await this.get(id)
    if (!appearance) return false
    const settings = await loadAppearanceSettings()
    await saveAppearanceSettings({ ...settings, appearanceId: appearance.manifest.id })
    announceRepositoryChange()
    return true
  },
  async resolveActive(id) {
    const appearance = await this.get(id)
    if (appearance) return { appearance, fellBack: false }
    const settings = await loadAppearanceSettings()
    await saveAppearanceSettings({ ...settings, appearanceId: FIELD_GUIDE_APPEARANCE.manifest.id })
    return { appearance: FIELD_GUIDE_APPEARANCE, fellBack: true, previousId: id }
  },
  async listLegacy() {
    return (await loadLegacyRecords()).map(({ raw: _raw, ...record }) => record)
  },
  async exportLegacy(id) {
    const record = (await loadLegacyRecords()).find((item) => item.id === id)
    if (!record) return undefined
    if (typeof record.raw === 'string') {
      return { blob: new Blob([record.raw], { type: 'application/json' }), fileName: `${id}.legacy.json` }
    }
    return { blob: new Blob([asArrayBuffer(record.raw)], { type: APPEARANCE_MIME }), fileName: `${id}.legacy${APPEARANCE_EXTENSION}` }
  },
  async removeLegacy(id) {
    let removed = false
    const jsonRecords = await localforage.getItem<unknown[]>(LEGACY_JSON_KEY)
    if (Array.isArray(jsonRecords)) {
      const next = jsonRecords.filter((value, index) => legacyJsonId(value, index) !== id)
      removed ||= next.length !== jsonRecords.length
      if (next.length !== jsonRecords.length) await localforage.setItem(LEGACY_JSON_KEY, next)
    }
    const archiveRecords = await localforage.getItem<LegacyArchiveRecord[]>(LEGACY_ARCHIVE_KEY)
    if (Array.isArray(archiveRecords)) {
      const next = archiveRecords.filter((record) => record.id !== id)
      removed ||= next.length !== archiveRecords.length
      if (next.length !== archiveRecords.length) await localforage.setItem(LEGACY_ARCHIVE_KEY, next)
    }
    if (removed) announceRepositoryChange()
    return removed
  }
}

export async function exportSourcePackage(appearance: AppearancePackage): Promise<AppearanceExport> {
  const archive = await createAppearanceArchive(appearance)
  return {
    blob: new Blob([asArrayBuffer(archive)], { type: APPEARANCE_MIME }),
    fileName: `${appearance.manifest.id}${APPEARANCE_EXTENSION}`
  }
}
