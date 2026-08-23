import { describe, expect, it, vi } from 'vitest'
import type { AppearanceCatalogItem, DataResult } from '../data/moderation'
import { catalogItemMatchesPackage, installAppearanceCatalogItem } from './catalog'
import type { AppearanceImportResult, AppearancePackageAuditReport } from './types'

const item: AppearanceCatalogItem = {
  id: 'submission-1',
  packageId: 'temporary-v3-fixture',
  packageVersion: '0.0.1',
  displayName: 'Temporary v3 fixture',
  summary: 'Generated only for the catalog integrity test.',
  declaredAuthor: 'Test runner',
  license: 'MIT',
  sha256: 'a'.repeat(64),
  bytes: 3729,
  updatedAt: '2026-08-12T00:00:00.000Z'
}

function result(overrides: Partial<AppearanceImportResult> = {}): AppearanceImportResult {
  const report: AppearancePackageAuditReport = {
    valid: true,
    activatable: true,
    packageId: item.packageId,
    packageSha256: item.sha256,
    checkedAt: '2026-08-12T00:00:00.000Z',
    diagnostics: [],
    checks: {
      archiveSafety: 'passed', schema: 'passed', declaredFiles: 'passed', checksums: 'passed',
      safeAssets: 'passed', tokens: 'passed', tokenReferences: 'passed', tokenTypes: 'passed',
      contrast: 'passed', touchTargets: 'passed', cssSafety: 'passed', cssScope: 'passed',
      externalResources: 'passed', compatibility: 'passed', reducedMotion: 'passed', mapAttribution: 'passed'
    }
  }
  return {
    package: {
      manifest: {
        schemaVersion: 3,
        packageFormat: 'netrin-appearance-zip',
        interfaceContractVersion: 2,
        id: item.packageId,
        displayName: item.displayName,
        summary: item.summary,
        version: item.packageVersion,
        type: 'skin',
        author: item.declaredAuthor,
        license: item.license,
        compatibility: { minAppVersion: '0.1.1' },
        entrypoints: { tokens: 'tokens.json', theme: 'theme.css' },
        assets: [],
        files: []
      }
    },
    report,
    ...overrides
  }
}

describe('appearance catalog installation', () => {
  it('matches the approved identity, version and package digest', () => {
    expect(catalogItemMatchesPackage(item, result())).toBe(true)
    expect(catalogItemMatchesPackage(item, result({
      report: { ...result().report, packageSha256: 'b'.repeat(64) }
    }))).toBe(false)
  })

  it('audits before writing the downloaded package', async () => {
    const blob = new Blob(['package'])
    const install = vi.fn(async () => result())
    const installed = await installAppearanceCatalogItem(item, {
      download: async (): Promise<DataResult<Blob>> => ({ ok: true, data: blob }),
      inspect: async () => result(),
      install
    })

    expect(installed.ok).toBe(true)
    expect(install).toHaveBeenCalledWith(blob)
  })

  it('rejects a digest mismatch without writing IndexedDB', async () => {
    const install = vi.fn(async () => result())
    const inspected = result({ report: { ...result().report, packageSha256: 'b'.repeat(64) } })
    const installed = await installAppearanceCatalogItem(item, {
      download: async () => ({ ok: true, data: new Blob(['tampered']) }),
      inspect: async () => inspected,
      install
    })

    expect(installed).toEqual({ ok: false, error: 'catalog-mismatch' })
    expect(install).not.toHaveBeenCalled()
  })

  it.each([
    ['package ID', { packageId: 'tampered-id' }],
    ['version', { packageVersion: '9.9.9' }],
    ['catalog digest', { sha256: 'c'.repeat(64) }]
  ])('rejects tampered %s metadata before installation', async (_label, patch) => {
    const install = vi.fn(async () => result())
    const installed = await installAppearanceCatalogItem({ ...item, ...patch }, {
      download: async () => ({ ok: true, data: new Blob(['package']) }),
      inspect: async () => result(),
      install
    })
    expect(installed).toEqual({ ok: false, error: 'catalog-mismatch' })
    expect(install).not.toHaveBeenCalled()
  })
})
