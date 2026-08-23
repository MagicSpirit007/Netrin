import { validateAppearanceReviewReport, type AppearanceReviewValidationSummary, type StrictAppearanceReview } from './review-report.ts'

export type AppearanceReviewCandidate = {
  id: string
  packageId: string
  packageVersion: string
  packageSha256: string
  storagePath: string
  moderationStatus: string
}

export type AppearanceMachineAudit = {
  manifest: { id: string; version: string; interfaceContractVersion: number }
  report: { valid: boolean; packageSha256?: string }
}

export type AppearanceApprovalGateDependencies = {
  loadSubmission(id: string): Promise<AppearanceReviewCandidate | null>
  download(storagePath: string): Promise<Uint8Array>
  audit(bytes: Uint8Array): Promise<AppearanceMachineAudit>
}

export type AppearanceApprovalGateResult =
  | {
      ok: true
      submission: AppearanceReviewCandidate
      bytes: Uint8Array
      report: StrictAppearanceReview
      summary: AppearanceReviewValidationSummary & { machineAuditValid: true; submissionId: string; packageBytes: number }
    }
  | { ok: false; status: 400 | 404 | 409; code: string; issues?: string[] }

export function validateAppearanceReviewDecision(input: {
  decision: unknown
  reason: string
  displayName: string
  summary: string
  hasReview: boolean
}): { ok: true; decision: 'approved' | 'rejected' } | { ok: false; code: string } {
  if (input.decision !== 'approved' && input.decision !== 'rejected') return { ok: false, code: 'invalid-decision' }
  if (input.reason.length > 500 || input.displayName.length > 80 || input.summary.length > 500) return { ok: false, code: 'review-text-too-long' }
  if (input.decision === 'rejected' && !input.reason.trim()) return { ok: false, code: 'rejection-reason-required' }
  if (input.decision === 'approved' && (!input.hasReview || !input.displayName.trim() || !input.summary.trim())) {
    return { ok: false, code: 'approval-evidence-required' }
  }
  return { ok: true, decision: input.decision }
}

export async function validateAppearanceApproval(
  submissionId: string,
  adminReview: unknown,
  dependencies: AppearanceApprovalGateDependencies
): Promise<AppearanceApprovalGateResult> {
  const submission = await dependencies.loadSubmission(submissionId)
  if (!submission) return { ok: false, status: 404, code: 'submission-not-found' }
  if (submission.moderationStatus !== 'pending') return { ok: false, status: 409, code: 'submission-not-pending' }
  let bytes: Uint8Array
  try { bytes = await dependencies.download(submission.storagePath) } catch { return { ok: false, status: 409, code: 'package-unavailable' } }
  let audited: AppearanceMachineAudit
  try { audited = await dependencies.audit(bytes) } catch { return { ok: false, status: 409, code: 'machine-audit-failed' } }
  const { manifest, report } = audited
  if (!report.valid || !report.packageSha256 || manifest.id !== submission.packageId ||
    manifest.version !== submission.packageVersion || report.packageSha256 !== submission.packageSha256 ||
    manifest.interfaceContractVersion !== 2) {
    return { ok: false, status: 409, code: 'package-identity-mismatch' }
  }
  const validated = validateAppearanceReviewReport(adminReview, {
    packageId: manifest.id,
    packageVersion: manifest.version,
    packageSha256: report.packageSha256,
    interfaceContractVersion: manifest.interfaceContractVersion
  })
  if (!validated.ok) return { ok: false, status: 400, code: 'review-mismatch', issues: validated.issues }
  return {
    ok: true,
    submission,
    bytes,
    report: validated.report,
    summary: {
      ...validated.summary,
      machineAuditValid: true,
      submissionId,
      packageBytes: bytes.byteLength
    }
  }
}
