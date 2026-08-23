import { describe, expect, it, vi } from 'vitest'
import { APPEARANCE_REVIEW_CHECKS } from '../../appearance/review-report'
import { validateAppearanceApproval, validateAppearanceReviewDecision, type AppearanceApprovalGateDependencies } from '../../appearance/review-gate-core'
import { APPEARANCE_REVIEW_ROUTES, REQUIRED_APPEARANCE_SCREENS } from './contract'

const digest = 'a'.repeat(64)
const candidate = {
  id: '00000000-0000-4000-8000-000000000001', packageId: 'temporary-v3-fixture', packageVersion: '0.0.1',
  packageSha256: digest, storagePath: 'appearances/fixture/archive.netrin-appearance', moderationStatus: 'pending'
}
function review() {
  return {
    schemaVersion: 1, packageId: candidate.packageId, packageVersion: candidate.packageVersion,
    packageSha256: digest, appVersion: '0.1.1', interfaceContractVersion: 2,
    generatedAt: '2026-08-13T00:00:00.000Z',
    checks: Object.fromEntries(APPEARANCE_REVIEW_CHECKS.map((name) => [name, 'passed'])),
    screenshots: REQUIRED_APPEARANCE_SCREENS.flatMap((screenId) => (['zh-CN', 'en'] as const).map((locale) => ({
      screenId, route: APPEARANCE_REVIEW_ROUTES[screenId], locale,
      viewport: { width: 390, height: 844 }, reducedMotion: true,
      file: `${screenId}-${locale}.png`, sha256: 'b'.repeat(64)
    }))), diagnostics: []
  }
}
function dependencies(overrides: Partial<AppearanceApprovalGateDependencies> = {}): AppearanceApprovalGateDependencies {
  return {
    loadSubmission: vi.fn(async () => candidate),
    download: vi.fn(async () => new Uint8Array([1, 2, 3])),
    audit: vi.fn(async () => ({
      manifest: { id: candidate.packageId, version: candidate.packageVersion, interfaceContractVersion: 2 },
      report: { valid: true, packageSha256: digest }
    })),
    ...overrides
  }
}

describe('server-side appearance approval core', () => {
  it('accepts a reasoned rejection and rejects an empty reason', () => {
    expect(validateAppearanceReviewDecision({ decision: 'rejected', reason: 'Evidence mismatch.', displayName: '', summary: '', hasReview: false }))
      .toEqual({ ok: true, decision: 'rejected' })
    expect(validateAppearanceReviewDecision({ decision: 'rejected', reason: ' ', displayName: '', summary: '', hasReview: false }))
      .toEqual({ ok: false, code: 'rejection-reason-required' })
    expect(validateAppearanceReviewDecision({ decision: 'approved', reason: '', displayName: 'Fixture', summary: 'Qualified.', hasReview: false }))
      .toEqual({ ok: false, code: 'approval-evidence-required' })
  })
  it('re-downloads and audits candidate bytes before accepting a qualified report', async () => {
    const deps = dependencies()
    const result = await validateAppearanceApproval(candidate.id, review(), deps)
    expect(result).toMatchObject({ ok: true, summary: { screenshotCount: 20, errorDiagnostics: 0, machineAuditValid: true } })
    expect(deps.download).toHaveBeenCalledWith(candidate.storagePath)
    expect(deps.audit).toHaveBeenCalledOnce()
  })

  it('rejects a tampered package and never trusts report claims over actual bytes', async () => {
    const result = await validateAppearanceApproval(candidate.id, review(), dependencies({
      audit: async () => ({
        manifest: { id: candidate.packageId, version: candidate.packageVersion, interfaceContractVersion: 2 },
        report: { valid: true, packageSha256: 'c'.repeat(64) }
      })
    }))
    expect(result).toEqual({ ok: false, status: 409, code: 'package-identity-mismatch' })
  })

  it('rejects a report mismatch, missing package and non-pending submission', async () => {
    const mismatched = review()
    mismatched.packageVersion = '9.9.9'
    expect(await validateAppearanceApproval(candidate.id, mismatched, dependencies())).toMatchObject({ ok: false, code: 'review-mismatch' })
    expect(await validateAppearanceApproval(candidate.id, review(), dependencies({ loadSubmission: async () => null })))
      .toEqual({ ok: false, status: 404, code: 'submission-not-found' })
    expect(await validateAppearanceApproval(candidate.id, review(), dependencies({
      loadSubmission: async () => ({ ...candidate, moderationStatus: 'approved' })
    }))).toEqual({ ok: false, status: 409, code: 'submission-not-pending' })
  })
})
