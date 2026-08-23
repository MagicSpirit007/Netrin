import { describe, expect, it } from 'vitest'
import { APPEARANCE_REVIEW_ROUTES, REQUIRED_APPEARANCE_SCREENS } from './contract'
import { APPEARANCE_REVIEW_CHECKS, validateAppearanceReviewReport } from '../../appearance/review-report'

function fixture() {
  return {
    schemaVersion: 1,
    packageId: 'temporary-v3-fixture',
    packageVersion: '0.0.1',
    packageSha256: 'a'.repeat(64),
    appVersion: '0.1.1',
    interfaceContractVersion: 2,
    generatedAt: '2026-08-13T00:00:00.000Z',
    checks: Object.fromEntries(APPEARANCE_REVIEW_CHECKS.map((name) => [name, 'passed'])),
    screenshots: REQUIRED_APPEARANCE_SCREENS.flatMap((screenId) => (['zh-CN', 'en'] as const).map((locale) => ({
      screenId,
      route: APPEARANCE_REVIEW_ROUTES[screenId],
      locale,
      viewport: { width: 390, height: 844 },
      reducedMotion: true,
      file: `screenshots/${screenId}-${locale}.png`,
      sha256: 'b'.repeat(64)
    }))),
    diagnostics: [] as Array<{ severity: 'error' | 'warning'; code: string; message: string }>
  }
}

describe('strict v3 appearance review gate', () => {
  it('accepts exactly eight passed checks and twenty unique bilingual screenshots', () => {
    expect(validateAppearanceReviewReport(fixture(), {
      packageId: 'temporary-v3-fixture', packageVersion: '0.0.1', packageSha256: 'a'.repeat(64), interfaceContractVersion: 2
    }).ok).toBe(true)
  })

  it.each(['failed', 'not-run'] as const)('rejects %s instead of promoting it to passed', (status) => {
    const report = fixture()
    report.checks.packageAudit = status
    expect(validateAppearanceReviewReport(report)).toMatchObject({ ok: false })
  })

  it('rejects missing, duplicate and malformed evidence', () => {
    const missing = fixture()
    missing.screenshots.pop()
    expect(validateAppearanceReviewReport(missing)).toMatchObject({ ok: false })

    const duplicate = fixture()
    duplicate.screenshots[19] = { ...duplicate.screenshots[0] }
    expect(validateAppearanceReviewReport(duplicate)).toMatchObject({ ok: false })

    const malformed = fixture()
    malformed.screenshots[0] = { ...malformed.screenshots[0], viewport: { width: 760, height: 844 }, reducedMotion: false }
    expect(validateAppearanceReviewReport(malformed)).toMatchObject({ ok: false })
  })

  it('rejects package identity drift and error diagnostics', () => {
    const report = fixture()
    report.diagnostics.push({ severity: 'error', code: 'console-error', message: 'fixture failure' })
    expect(validateAppearanceReviewReport(report, {
      packageId: 'different-fixture', packageVersion: '0.0.1', packageSha256: 'c'.repeat(64), interfaceContractVersion: 2
    })).toMatchObject({ ok: false })
  })
})
