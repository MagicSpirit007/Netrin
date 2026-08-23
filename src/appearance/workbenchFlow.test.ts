import { describe, expect, it } from 'vitest'
import { APPEARANCE_REVIEW_CHECKS } from '../../appearance/review-report'
import { APPEARANCE_REVIEW_ROUTES, REQUIRED_APPEARANCE_SCREENS } from './contract'
import { classifyAppearanceFiles, reviewMatchesCurrentPackage } from './workbenchFlow'
import type { AppearancePackageAuditReport, AppearanceReviewReport } from './types'

function review(): AppearanceReviewReport {
  return {
    schemaVersion: 1,
    packageId: 'temporary-v3-fixture',
    packageVersion: '0.0.1',
    packageSha256: 'a'.repeat(64),
    appVersion: '0.1.1',
    interfaceContractVersion: 2,
    generatedAt: '2026-08-13T00:00:00.000Z',
    checks: Object.fromEntries(APPEARANCE_REVIEW_CHECKS.map((name) => [name, 'passed'])) as AppearanceReviewReport['checks'],
    screenshots: REQUIRED_APPEARANCE_SCREENS.flatMap((screenId) => (['zh-CN', 'en'] as const).map((locale) => ({
      screenId, route: APPEARANCE_REVIEW_ROUTES[screenId], locale,
      viewport: { width: 390, height: 844 }, reducedMotion: true,
      file: `screenshots/${screenId}-${locale}.png`, sha256: 'b'.repeat(64)
    }))),
    diagnostics: []
  }
}

function audit(): AppearancePackageAuditReport {
  return {
    valid: true, activatable: true, packageId: 'temporary-v3-fixture', packageSha256: 'a'.repeat(64),
    checkedAt: '2026-08-13T00:00:00.000Z', diagnostics: [],
    checks: Object.fromEntries([
      'archiveSafety', 'schema', 'declaredFiles', 'checksums', 'safeAssets', 'tokens', 'tokenReferences', 'tokenTypes',
      'contrast', 'touchTargets', 'cssSafety', 'cssScope', 'externalResources', 'compatibility', 'reducedMotion', 'mapAttribution'
    ].map((name) => [name, 'passed'])) as AppearancePackageAuditReport['checks']
  }
}

describe('appearance workbench file flow', () => {
  it('classifies one package and one report without sending JSON to the package importer', async () => {
    const packageFile = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'fixture.netrin-appearance', { type: 'application/zip' })
    const reportFile = new File([JSON.stringify(review())], 'fixture.netrin-review.json', { type: 'application/json' })
    const result = await classifyAppearanceFiles([reportFile, packageFile])
    expect(result).toMatchObject({ ok: true, files: { packageFile, reviewFile: reportFile } })
  })

  it('rejects ordinary JSON, duplicate categories and extra files atomically', async () => {
    const json = new File(['{}'], 'appearance.json', { type: 'application/json' })
    expect(await classifyAppearanceFiles([json])).toEqual({ ok: false, error: 'unknown-file' })
    const packageA = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'a.netrin-appearance')
    const packageB = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'b.netrin-appearance')
    expect(await classifyAppearanceFiles([packageA, packageB])).toEqual({ ok: false, error: 'duplicate-package' })
    expect(await classifyAppearanceFiles([packageA, packageB, json])).toEqual({ ok: false, error: 'too-many-files' })
  })

  it('invalidates a prior report when the selected package identity or live digest changes', () => {
    expect(reviewMatchesCurrentPackage(review(), audit(), 'temporary-v3-fixture', '0.0.1', 2)).toBe(true)
    expect(reviewMatchesCurrentPackage(review(), audit(), 'another-fixture', '0.0.1', 2)).toBe(false)
    expect(reviewMatchesCurrentPackage(review(), { ...audit(), packageSha256: 'c'.repeat(64) }, 'temporary-v3-fixture', '0.0.1', 2)).toBe(false)
  })
})
