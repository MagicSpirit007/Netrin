import { createAppearanceArchive, parseAppearanceArchive, parseAppearanceFile, unsupportedLegacyAppearance } from './packageFormat'
import type { AppearanceImportResult, AppearancePackage, AppearancePackageAuditReport } from './types'

/**
 * v3 intentionally stops accepting the historical JSON/token package format.
 * The function remains exported so old call sites fail with a precise audit
 * diagnostic instead of attempting to execute legacy data.
 */
export function parseAndAuditAppearancePackage(_input: string): AppearanceImportResult {
  return unsupportedLegacyAppearance()
}

export { parseAppearanceFile }

export async function auditAppearancePackage(appearance: AppearancePackage): Promise<AppearancePackageAuditReport> {
  try {
    const archive = await createAppearanceArchive(appearance)
    return (await parseAppearanceArchive(archive)).report
  } catch (error) {
    return {
      valid: false,
      activatable: false,
      checkedAt: new Date().toISOString(),
      diagnostics: [{
        severity: 'error',
        code: 'package-source',
        message: error instanceof Error ? error.message : 'Appearance source could not be packaged.'
      }],
      checks: {
        archiveSafety: 'not-run', schema: 'not-run', declaredFiles: 'not-run', checksums: 'not-run',
        safeAssets: 'not-run', tokens: 'not-run', tokenReferences: 'not-run', tokenTypes: 'not-run',
        contrast: 'not-run', touchTargets: 'not-run', cssSafety: 'not-run', cssScope: 'not-run',
        externalResources: 'not-run', compatibility: 'not-run', reducedMotion: 'not-run', mapAttribution: 'not-run'
      }
    }
  }
}
