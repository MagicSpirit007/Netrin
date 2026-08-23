export type AppearanceKind = 'skin' | 'phenotype'

export type AppearanceCheckStatus = 'passed' | 'failed' | 'not-run'

export type AppearanceDiagnostic = {
  severity: 'error' | 'warning'
  code: string
  message: string
  file?: string
  line?: number
  column?: number
  selector?: string
  tokenPath?: string
}

/** @deprecated Kept as a source-compatible name for CSS audit helpers. */
export type AppearanceAuditIssue = AppearanceDiagnostic

export const APPEARANCE_PACKAGE_CHECKS = [
  'archiveSafety',
  'schema',
  'declaredFiles',
  'checksums',
  'safeAssets',
  'tokens',
  'tokenReferences',
  'tokenTypes',
  'contrast',
  'touchTargets',
  'cssSafety',
  'cssScope',
  'externalResources',
  'compatibility',
  'reducedMotion',
  'mapAttribution'
] as const

export type AppearancePackageCheck = (typeof APPEARANCE_PACKAGE_CHECKS)[number]

export type AppearancePackageAuditReport = {
  valid: boolean
  activatable: boolean
  packageId?: string
  packageSha256?: string
  checkedAt: string
  diagnostics: AppearanceDiagnostic[]
  checks: Record<AppearancePackageCheck, AppearanceCheckStatus>
}

export type AppearanceReviewCheck =
  | 'packageAudit'
  | 'typecheck'
  | 'productionBuild'
  | 'routeSmoke'
  | 'locales'
  | 'viewport390x844'
  | 'reducedMotion'
  | 'networkIsolation'

export type AppearanceReviewScreenshot = {
  screenId: string
  route: string
  locale: 'zh-CN' | 'en'
  viewport: { width: 390; height: 844 }
  reducedMotion: boolean
  file: string
  sha256: string
}

export type AppearanceReviewReport = {
  schemaVersion: 1
  packageId: string
  packageVersion: string
  packageSha256: string
  appVersion: string
  interfaceContractVersion: 2
  generatedAt: string
  checks: Record<AppearanceReviewCheck, AppearanceCheckStatus>
  screenshots: AppearanceReviewScreenshot[]
  diagnostics: AppearanceDiagnostic[]
}

export type AppearanceTokenType =
  | 'color'
  | 'dimension'
  | 'duration'
  | 'fontFamily'
  | 'fontWeight'
  | 'shadow'
  | 'number'

export type AppearanceTokenLeaf = {
  $type: AppearanceTokenType
  $value: string | number
  $description?: string
}

export type AppearanceTokensDocument = {
  $schema?: string
  primitive: Record<string, unknown>
  semantic: Record<string, unknown>
  component: Record<string, unknown>
}

export type AppearanceAsset = {
  path: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'font/woff2'
  bytes: number
  sha256: string
}

export type AppearanceFile = {
  path: string
  bytes: number
  sha256: string
}

export type AppearanceManifest = {
  schemaVersion: 3
  packageFormat: 'netrin-appearance-zip'
  interfaceContractVersion: 2
  id: string
  displayName: string
  summary: string
  version: string
  type: AppearanceKind
  author: string
  license: string
  compatibility: { minAppVersion: string; maxAppVersion?: string }
  entrypoints: { tokens: 'tokens.json'; theme: 'theme.css' }
  assets: AppearanceAsset[]
  files: AppearanceFile[]
}

export type AppearanceBinaryAsset = {
  mimeType: AppearanceAsset['mimeType']
  data: Uint8Array
  sha256: string
}

export type AppearancePackage = {
  manifest: AppearanceManifest
  tokensDocument?: AppearanceTokensDocument
  compiledTokens?: Record<string, string>
  themeCss?: string
  sanitizedCss?: string
  assets?: Record<string, AppearanceBinaryAsset>
  builtin?: boolean
}

export type AppearanceImportResult = {
  package?: AppearancePackage
  report: AppearancePackageAuditReport
}

export type AppearanceExport = {
  blob: Blob
  fileName: string
}

export type LegacyAppearanceRecord = {
  id: string
  bytes: number
  source: 'v1-json' | 'v2-archive'
  active: boolean
}

export type AppearanceCoverageItem = {
  id: string
  rendered: boolean
  styledBy: 'token' | 'css' | 'inherited'
}

export type AppearanceCoverageReport = {
  screens: AppearanceCoverageItem[]
  components: AppearanceCoverageItem[]
  slots: AppearanceCoverageItem[]
}
