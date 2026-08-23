import { validateAppearanceReviewReport } from '../../appearance/review-report'
import type { AppearancePackageAuditReport, AppearanceReviewReport } from './types'

export type ClassifiedAppearanceFiles = {
  packageFile?: File
  reviewFile?: File
  reviewReport?: AppearanceReviewReport
}

export type AppearanceFileClassification =
  | { ok: true; files: ClassifiedAppearanceFiles }
  | { ok: false; error: 'too-many-files' | 'duplicate-package' | 'duplicate-review' | 'unknown-file' | 'invalid-package' | 'invalid-review' }

async function isZip(file: File): Promise<boolean> {
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return magic.length === 4 && magic[0] === 0x50 && magic[1] === 0x4b && [0x03, 0x05, 0x07].includes(magic[2]) && [0x04, 0x06, 0x08].includes(magic[3])
}

export async function classifyAppearanceFiles(input: FileList | File[]): Promise<AppearanceFileClassification> {
  const files = Array.from(input)
  if (files.length === 0 || files.length > 2) return { ok: false, error: files.length > 2 ? 'too-many-files' : 'unknown-file' }
  const classified: ClassifiedAppearanceFiles = {}
  for (const file of files) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.netrin-appearance')) {
      if (classified.packageFile) return { ok: false, error: 'duplicate-package' }
      if (!await isZip(file)) return { ok: false, error: 'invalid-package' }
      classified.packageFile = file
      continue
    }
    if (lower.endsWith('.netrin-review.json')) {
      if (classified.reviewFile) return { ok: false, error: 'duplicate-review' }
      let value: unknown
      try { value = JSON.parse(await file.text()) } catch { return { ok: false, error: 'invalid-review' } }
      const validated = validateAppearanceReviewReport(value)
      if (!validated.ok) return { ok: false, error: 'invalid-review' }
      classified.reviewFile = file
      classified.reviewReport = validated.report as AppearanceReviewReport
      continue
    }
    return { ok: false, error: 'unknown-file' }
  }
  return { ok: true, files: classified }
}

export function reviewMatchesCurrentPackage(
  review: AppearanceReviewReport | null,
  audit: AppearancePackageAuditReport | null,
  packageId?: string,
  packageVersion?: string,
  interfaceContractVersion?: number
): boolean {
  if (!review || !audit?.valid || !audit.activatable || !audit.packageSha256 || !packageId || !packageVersion) return false
  return validateAppearanceReviewReport(review, {
    packageId,
    packageVersion,
    packageSha256: audit.packageSha256,
    interfaceContractVersion
  }).ok
}
