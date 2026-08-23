import {
  downloadAppearancePackage,
  type AppearanceCatalogItem,
  type DataResult
} from '../data/moderation'
import { localAppearanceRepository } from './repository'
import type { AppearanceImportResult, AppearancePackage, AppearancePackageAuditReport } from './types'

export type AppearanceCatalogInstallError =
  | 'download-failed'
  | 'package-audit-failed'
  | 'catalog-mismatch'
  | 'install-failed'

export type AppearanceCatalogInstallResult =
  | { ok: true; appearance: AppearancePackage; report: AppearancePackageAuditReport }
  | { ok: false; error: AppearanceCatalogInstallError }

type AppearanceCatalogInstallDependencies = {
  download: (id: string) => Promise<DataResult<Blob>>
  inspect: (blob: Blob) => Promise<AppearanceImportResult>
  install: (blob: Blob) => Promise<AppearanceImportResult>
}

const defaultDependencies: AppearanceCatalogInstallDependencies = {
  download: downloadAppearancePackage,
  inspect: (blob) => localAppearanceRepository.inspect(blob),
  install: (blob) => localAppearanceRepository.import(blob)
}

export function catalogItemMatchesPackage(
  item: AppearanceCatalogItem,
  inspected: AppearanceImportResult
): boolean {
  const appearance = inspected.package
  return inspected.report.valid &&
    inspected.report.activatable &&
    Boolean(appearance) &&
    appearance?.manifest.type === 'skin' &&
    appearance.manifest.id === item.packageId &&
    appearance.manifest.version === item.packageVersion &&
    inspected.report.packageSha256?.toLowerCase() === item.sha256.toLowerCase()
}

export async function installAppearanceCatalogItem(
  item: AppearanceCatalogItem,
  dependencies: AppearanceCatalogInstallDependencies = defaultDependencies
): Promise<AppearanceCatalogInstallResult> {
  const downloaded = await dependencies.download(item.id)
  if (!downloaded.ok) return { ok: false, error: 'download-failed' }

  const inspected = await dependencies.inspect(downloaded.data)
  if (!inspected.report.valid || !inspected.report.activatable || !inspected.package) {
    return { ok: false, error: 'package-audit-failed' }
  }
  if (!catalogItemMatchesPackage(item, inspected)) {
    return { ok: false, error: 'catalog-mismatch' }
  }

  const installed = await dependencies.install(downloaded.data)
  if (!installed.report.valid || !installed.package || !catalogItemMatchesPackage(item, installed)) {
    return { ok: false, error: 'install-failed' }
  }
  return { ok: true, appearance: installed.package, report: installed.report }
}
