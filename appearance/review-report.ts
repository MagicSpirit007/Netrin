import {
  APPEARANCE_INTERFACE_CONTRACT_VERSION,
  APPEARANCE_REVIEW_ROUTES,
  REQUIRED_APPEARANCE_SCREENS
} from './contract.ts'

export const APPEARANCE_REVIEW_CHECKS = [
  'packageAudit',
  'typecheck',
  'productionBuild',
  'routeSmoke',
  'locales',
  'viewport390x844',
  'reducedMotion',
  'networkIsolation'
] as const

export type AppearanceReviewCheckName = (typeof APPEARANCE_REVIEW_CHECKS)[number]
export type AppearanceReviewStatus = 'passed' | 'failed' | 'not-run'

export type StrictAppearanceReview = {
  schemaVersion: 1
  packageId: string
  packageVersion: string
  packageSha256: string
  appVersion: string
  interfaceContractVersion: typeof APPEARANCE_INTERFACE_CONTRACT_VERSION
  generatedAt: string
  checks: Record<AppearanceReviewCheckName, AppearanceReviewStatus>
  screenshots: Array<{
    screenId: (typeof REQUIRED_APPEARANCE_SCREENS)[number]
    route: string
    locale: 'zh-CN' | 'en'
    viewport: { width: 390; height: 844 }
    reducedMotion: true
    file: string
    sha256: string
  }>
  diagnostics: Array<{
    severity: 'error' | 'warning'
    code: string
    message: string
    file?: string
    line?: number
    column?: number
    selector?: string
    tokenPath?: string
  }>
}

export type AppearanceReviewExpectation = {
  packageId: string
  packageVersion: string
  packageSha256: string
  interfaceContractVersion?: number
}

export type AppearanceReviewValidation =
  | { ok: true; report: StrictAppearanceReview; summary: AppearanceReviewValidationSummary }
  | { ok: false; issues: string[] }

export type AppearanceReviewValidationSummary = {
  packageSha256: string
  interfaceContractVersion: number
  passedChecks: AppearanceReviewCheckName[]
  screenshotCount: 20
  screenCount: 10
  locales: ['zh-CN', 'en']
  errorDiagnostics: 0
  reducedMotionEvidence: true
}

const SHA256 = /^[a-f0-9]{64}$/
const PACKAGE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SAFE_SCREENSHOT_PATH = /^(?![/.])(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.png$/
const LOCALES = ['zh-CN', 'en'] as const

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key))
}

function validDiagnostic(value: unknown): boolean {
  const item = record(value)
  if (!item) return false
  const allowed = ['severity', 'code', 'message', 'file', 'line', 'column', 'selector', 'tokenPath']
  if (Object.keys(item).some((key) => !allowed.includes(key))) return false
  if (!['error', 'warning'].includes(String(item.severity)) || typeof item.code !== 'string' || !item.code ||
    typeof item.message !== 'string' || !item.message) return false
  for (const name of ['file', 'selector', 'tokenPath']) {
    if (item[name] !== undefined && typeof item[name] !== 'string') return false
  }
  for (const name of ['line', 'column']) {
    if (item[name] !== undefined && (!Number.isInteger(item[name]) || Number(item[name]) < 1)) return false
  }
  return true
}

export function validateAppearanceReviewReport(
  value: unknown,
  expectation?: AppearanceReviewExpectation
): AppearanceReviewValidation {
  const issues: string[] = []
  const review = record(value)
  if (!review) return { ok: false, issues: ['review-object'] }

  const topLevelKeys = [
    'schemaVersion', 'packageId', 'packageVersion', 'packageSha256', 'appVersion',
    'interfaceContractVersion', 'generatedAt', 'checks', 'screenshots', 'diagnostics'
  ]
  if (!hasOnlyKeys(review, topLevelKeys)) issues.push('review-fields')
  if (review.schemaVersion !== 1) issues.push('schema-version')
  if (typeof review.packageId !== 'string' || !PACKAGE_ID.test(review.packageId)) issues.push('package-id')
  if (typeof review.packageVersion !== 'string' || !VERSION.test(review.packageVersion)) issues.push('package-version')
  if (typeof review.packageSha256 !== 'string' || !SHA256.test(review.packageSha256)) issues.push('package-sha256')
  if (typeof review.appVersion !== 'string' || !VERSION.test(review.appVersion)) issues.push('app-version')
  if (review.interfaceContractVersion !== APPEARANCE_INTERFACE_CONTRACT_VERSION) issues.push('interface-contract')
  if (typeof review.generatedAt !== 'string' || !Number.isFinite(Date.parse(review.generatedAt))) issues.push('generated-at')

  const checks = record(review.checks)
  if (!checks || !hasOnlyKeys(checks, APPEARANCE_REVIEW_CHECKS)) {
    issues.push('review-checks')
  } else {
    for (const name of APPEARANCE_REVIEW_CHECKS) {
      if (checks[name] !== 'passed') issues.push(`review-check:${name}:${String(checks[name])}`)
    }
  }

  const screenshots = Array.isArray(review.screenshots) ? review.screenshots : []
  if (screenshots.length !== REQUIRED_APPEARANCE_SCREENS.length * LOCALES.length) issues.push('screenshot-count')
  const combinations = new Set<string>()
  for (const rawShot of screenshots) {
    const shot = record(rawShot)
    if (!shot || !hasOnlyKeys(shot, ['screenId', 'route', 'locale', 'viewport', 'reducedMotion', 'file', 'sha256'])) {
      issues.push('screenshot-fields')
      continue
    }
    const screenId = typeof shot.screenId === 'string' && REQUIRED_APPEARANCE_SCREENS.includes(shot.screenId as never)
      ? shot.screenId as (typeof REQUIRED_APPEARANCE_SCREENS)[number]
      : undefined
    const locale = shot.locale === 'zh-CN' || shot.locale === 'en' ? shot.locale : undefined
    if (!screenId) issues.push('screenshot-screen')
    if (!locale) issues.push('screenshot-locale')
    if (screenId && shot.route !== APPEARANCE_REVIEW_ROUTES[screenId]) issues.push(`screenshot-route:${screenId}`)
    const viewport = record(shot.viewport)
    if (!viewport || !hasOnlyKeys(viewport, ['width', 'height']) || viewport.width !== 390 || viewport.height !== 844) {
      issues.push('screenshot-viewport')
    }
    if (shot.reducedMotion !== true) issues.push('screenshot-reduced-motion')
    if (typeof shot.file !== 'string' || !SAFE_SCREENSHOT_PATH.test(shot.file) || shot.file.includes('\\')) issues.push('screenshot-file')
    if (typeof shot.sha256 !== 'string' || !SHA256.test(shot.sha256)) issues.push('screenshot-sha256')
    if (screenId && locale) {
      const key = `${screenId}:${locale}`
      if (combinations.has(key)) issues.push(`screenshot-duplicate:${key}`)
      combinations.add(key)
    }
  }
  for (const screenId of REQUIRED_APPEARANCE_SCREENS) {
    for (const locale of LOCALES) {
      if (!combinations.has(`${screenId}:${locale}`)) issues.push(`screenshot-missing:${screenId}:${locale}`)
    }
  }

  const diagnostics = Array.isArray(review.diagnostics) ? review.diagnostics : []
  if (!Array.isArray(review.diagnostics) || !diagnostics.every(validDiagnostic)) issues.push('diagnostics-fields')
  if (diagnostics.some((item) => record(item)?.severity === 'error')) issues.push('error-diagnostics')

  if (expectation) {
    if (review.packageId !== expectation.packageId) issues.push('mismatch:package-id')
    if (review.packageVersion !== expectation.packageVersion) issues.push('mismatch:package-version')
    if (review.packageSha256 !== expectation.packageSha256.toLowerCase()) issues.push('mismatch:package-sha256')
    if (review.interfaceContractVersion !== (expectation.interfaceContractVersion ?? APPEARANCE_INTERFACE_CONTRACT_VERSION)) {
      issues.push('mismatch:interface-contract')
    }
  }

  if (issues.length > 0) return { ok: false, issues: [...new Set(issues)] }
  return {
    ok: true,
    report: review as StrictAppearanceReview,
    summary: {
      packageSha256: review.packageSha256 as string,
      interfaceContractVersion: APPEARANCE_INTERFACE_CONTRACT_VERSION,
      passedChecks: [...APPEARANCE_REVIEW_CHECKS],
      screenshotCount: 20,
      screenCount: 10,
      locales: ['zh-CN', 'en'],
      errorDiagnostics: 0,
      reducedMotionEvidence: true
    }
  }
}
