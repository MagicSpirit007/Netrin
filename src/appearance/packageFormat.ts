import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import packageMetadata from '../../package.json'
import {
  APPEARANCE_SUMMARY_MAX_LENGTH,
  APPEARANCE_SUMMARY_MIN_LENGTH
} from '../../appearance/contract'
import { auditAndScopeCss } from './cssSecurity'
import { compileAppearanceTokens } from './tokenCompiler'
import {
  APPEARANCE_PACKAGE_CHECKS,
  type AppearanceAsset,
  type AppearanceBinaryAsset,
  type AppearanceCheckStatus,
  type AppearanceDiagnostic,
  type AppearanceFile,
  type AppearanceImportResult,
  type AppearanceManifest,
  type AppearancePackage,
  type AppearancePackageAuditReport,
  type AppearancePackageCheck
} from './types'

export const APPEARANCE_EXTENSION = '.netrin-appearance'
export const APPEARANCE_MIME = 'application/vnd.netrin.appearance+zip'
export const APP_VERSION = packageMetadata.version

const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TEXT_BYTES = 256 * 1024
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i
const SAFE_PATH = /^[a-z0-9][a-z0-9._/-]*$/i
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const ZIP_MTIME = new Date('1980-01-01T00:00:00.000Z')

const MIME_BY_EXTENSION: Record<string, AppearanceAsset['mimeType']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function diagnostic(code: string, message: string, file?: string): AppearanceDiagnostic {
  return { severity: 'error', code, message, file }
}

function emptyChecks(): Record<AppearancePackageCheck, AppearanceCheckStatus> {
  return Object.fromEntries(APPEARANCE_PACKAGE_CHECKS.map((check) => [check, 'not-run'])) as Record<AppearancePackageCheck, AppearanceCheckStatus>
}

function reportFromDiagnostics(
  diagnostics: AppearanceDiagnostic[],
  checks: Partial<Record<AppearancePackageCheck, AppearanceCheckStatus>> = {},
  packageId?: string,
  packageSha256?: string
): AppearancePackageAuditReport {
  const allChecks = { ...emptyChecks(), ...checks }
  const valid = !diagnostics.some((entry) => entry.severity === 'error') &&
    Object.values(allChecks).every((status) => status !== 'failed' && status !== 'not-run')
  return {
    valid,
    activatable: valid,
    packageId,
    packageSha256,
    checkedAt: new Date().toISOString(),
    diagnostics,
    checks: allChecks
  }
}

function failedResult(code: string, message: string, file?: string): AppearanceImportResult {
  return { report: reportFromDiagnostics([diagnostic(code, message, file)]) }
}

class AppearanceArchiveError extends Error {
  constructor(readonly code: 'archive-path' | 'archive-size', message: string) {
    super(message)
  }
}

function safePath(path: string): boolean {
  if (!SAFE_PATH.test(path) || path.startsWith('/') || path.includes('\\')) return false
  const parts = path.split('/')
  return parts.every((part) => part && part !== '.' && part !== '..')
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('-', 1)[0].split('.').map(Number)
  const rightParts = right.split('-', 1)[0].split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

function compatible(manifest: AppearanceManifest): boolean {
  return SAFE_VERSION.test(manifest.compatibility.minAppVersion) &&
    compareVersions(manifest.compatibility.minAppVersion, APP_VERSION) <= 0 &&
    (!manifest.compatibility.maxAppVersion || (
      SAFE_VERSION.test(manifest.compatibility.maxAppVersion) &&
      compareVersions(manifest.compatibility.maxAppVersion, APP_VERSION) >= 0
    ))
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function validAssets(value: unknown): value is AppearanceAsset[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) &&
    exactKeys(item, ['path', 'mimeType', 'bytes', 'sha256']) &&
    typeof item.path === 'string' && typeof item.mimeType === 'string' &&
    typeof item.bytes === 'number' && typeof item.sha256 === 'string')
}

function validFiles(value: unknown): value is AppearanceFile[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) &&
    exactKeys(item, ['path', 'bytes', 'sha256']) &&
    typeof item.path === 'string' && typeof item.bytes === 'number' && typeof item.sha256 === 'string')
}

function parseManifest(value: unknown, diagnostics: AppearanceDiagnostic[]): AppearanceManifest | undefined {
  if (isRecord(value) && (value.schemaVersion === 1 || value.schemaVersion === 2)) {
    diagnostics.push(diagnostic('unsupported-schema-version', 'Appearance schema v1/v2 is no longer supported. Use schemaVersion 3.', 'appearance.manifest.json'))
    return undefined
  }
  if (!isRecord(value) || !isRecord(value.compatibility) || !isRecord(value.entrypoints)) {
    diagnostics.push(diagnostic('schema', 'appearance.manifest.json does not match the v3 object shape.', 'appearance.manifest.json'))
    return undefined
  }
  const allowed = [
    'schemaVersion', 'packageFormat', 'interfaceContractVersion', 'id', 'displayName', 'summary',
    'version', 'type', 'author', 'license', 'compatibility', 'entrypoints', 'assets', 'files'
  ]
  const valid = exactKeys(value, allowed) && value.schemaVersion === 3 &&
    value.packageFormat === 'netrin-appearance-zip' && value.interfaceContractVersion === 2 &&
    typeof value.id === 'string' && SAFE_ID.test(value.id) && value.id.length <= 80 &&
    typeof value.displayName === 'string' && value.displayName.trim().length > 0 && value.displayName.length <= 80 &&
    typeof value.summary === 'string' &&
    value.summary.length >= APPEARANCE_SUMMARY_MIN_LENGTH &&
    value.summary.length <= APPEARANCE_SUMMARY_MAX_LENGTH &&
    typeof value.version === 'string' && SAFE_VERSION.test(value.version) &&
    value.type === 'skin' && typeof value.author === 'string' && value.author.trim().length > 0 && value.author.length <= 120 &&
    typeof value.license === 'string' && value.license.trim().length > 0 && value.license.length <= 120 &&
    exactKeys(value.compatibility, ['minAppVersion', 'maxAppVersion']) &&
    typeof value.compatibility.minAppVersion === 'string' &&
    (value.compatibility.maxAppVersion === undefined || typeof value.compatibility.maxAppVersion === 'string') &&
    exactKeys(value.entrypoints, ['tokens', 'theme']) && value.entrypoints.tokens === 'tokens.json' && value.entrypoints.theme === 'theme.css' &&
    validAssets(value.assets) && validFiles(value.files)
  if (!valid) {
    diagnostics.push(diagnostic('schema', 'appearance.manifest.json does not satisfy the v3 schema.', 'appearance.manifest.json'))
    return undefined
  }
  return value as unknown as AppearanceManifest
}

function extension(path: string): string {
  const index = path.lastIndexOf('.')
  return index < 0 ? '' : path.slice(index).toLowerCase()
}

function hasExpectedMagic(data: Uint8Array, mimeType: AppearanceAsset['mimeType']): boolean {
  if (mimeType === 'image/png') return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
  if (mimeType === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9
  if (mimeType === 'image/webp') return strFromU8(data.slice(0, 4)) === 'RIFF' && strFromU8(data.slice(8, 12)) === 'WEBP'
  if (mimeType === 'font/woff2') return strFromU8(data.slice(0, 4)) === 'wOF2'
  return false
}

export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2])
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const slice = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', slice)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`
}

export async function parseAppearanceArchive(bytes: Uint8Array): Promise<AppearanceImportResult> {
  if (!isZipBytes(bytes)) return failedResult('archive', 'File is not a ZIP-based .netrin-appearance package.')
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) return failedResult('archive-size', 'Appearance archive exceeds 5 MiB.')
  const packageSha256 = await sha256Hex(bytes)
  let archive: Record<string, Uint8Array>
  try {
    let expandedBytes = 0
    const seenPaths = new Set<string>()
    archive = unzipSync(bytes, {
      filter(info) {
        const directory = info.name.endsWith('/')
        const path = directory ? info.name.slice(0, -1) : info.name
        if (!safePath(path)) {
          throw new AppearanceArchiveError('archive-path', `Archive contains an unsafe path: ${info.name}`)
        }
        if (info.originalSize > MAX_FILE_BYTES) {
          throw new AppearanceArchiveError('archive-size', `Archive entry exceeds 2 MiB: ${info.name}`)
        }
        expandedBytes += info.originalSize
        if (expandedBytes > MAX_UNCOMPRESSED_BYTES) {
          throw new AppearanceArchiveError('archive-size', 'Expanded appearance archive exceeds 8 MiB.')
        }
        if (!directory && seenPaths.has(path)) {
          throw new AppearanceArchiveError('archive-path', `Archive contains a duplicate path: ${path}`)
        }
        if (!directory) seenPaths.add(path)
        return !directory
      }
    })
  } catch (error) {
    if (error instanceof AppearanceArchiveError) return failedResult(error.code, error.message)
    return failedResult('archive', 'Appearance archive cannot be decompressed safely.')
  }

  const diagnostics: AppearanceDiagnostic[] = []
  const checks = emptyChecks()
  const paths = Object.keys(archive).sort()
  const allowedPaths = paths.every((path) => safePath(path) && (
    path === 'appearance.manifest.json' || path === 'tokens.json' || path === 'theme.css' || path.startsWith('assets/')
  ))
  const totalBytes = paths.reduce((total, path) => total + archive[path].byteLength, 0)
  const sizesSafe = totalBytes <= MAX_UNCOMPRESSED_BYTES && paths.every((path) => archive[path].byteLength <= MAX_FILE_BYTES) &&
    (archive['tokens.json']?.byteLength ?? Infinity) <= MAX_TEXT_BYTES &&
    (archive['theme.css']?.byteLength ?? Infinity) <= MAX_TEXT_BYTES
  checks.archiveSafety = allowedPaths && sizesSafe ? 'passed' : 'failed'
  if (!allowedPaths) diagnostics.push(diagnostic('archive-path', 'Archive contains an undeclared or unsafe path.'))
  if (!sizesSafe) diagnostics.push(diagnostic('archive-size', 'Archive exceeds an entry or uncompressed-size limit.'))
  if (!archive['appearance.manifest.json'] || !archive['tokens.json'] || !archive['theme.css']) {
    diagnostics.push(diagnostic('archive-required', 'v3 packages require appearance.manifest.json, tokens.json and theme.css.'))
    return { report: reportFromDiagnostics(diagnostics, checks, undefined, packageSha256) }
  }

  let manifestValue: unknown
  let tokensValue: unknown
  let themeCss = ''
  try {
    manifestValue = JSON.parse(textDecoder.decode(archive['appearance.manifest.json']))
  } catch {
    diagnostics.push(diagnostic('manifest-json', 'appearance.manifest.json must be valid UTF-8 JSON.', 'appearance.manifest.json'))
  }
  try {
    tokensValue = JSON.parse(textDecoder.decode(archive['tokens.json']))
  } catch {
    diagnostics.push(diagnostic('tokens-json', 'tokens.json must be valid UTF-8 JSON.', 'tokens.json'))
  }
  try {
    themeCss = textDecoder.decode(archive['theme.css'])
  } catch {
    diagnostics.push(diagnostic('theme-css', 'theme.css must be valid UTF-8.', 'theme.css'))
  }

  const manifest = parseManifest(manifestValue, diagnostics)
  checks.schema = manifest ? 'passed' : 'failed'
  if (!manifest) return { report: reportFromDiagnostics(diagnostics, checks, undefined, packageSha256) }

  const declared = [...manifest.files].sort((left, right) => left.path.localeCompare(right.path))
  const actualFilePaths = paths.filter((path) => path !== 'appearance.manifest.json')
  const declaredFiles = declared.length === actualFilePaths.length && declared.every((file, index) =>
    file.path === actualFilePaths[index] && safePath(file.path) && file.bytes === archive[file.path]?.byteLength
  )
  checks.declaredFiles = declaredFiles ? 'passed' : 'failed'
  if (!declaredFiles) diagnostics.push(diagnostic('declared-files', 'Manifest files must exactly match archive entries and byte sizes.', 'appearance.manifest.json'))

  let checksums = declaredFiles
  if (declaredFiles) {
    for (const file of declared) {
      if (!/^[a-f0-9]{64}$/.test(file.sha256) || await sha256Hex(archive[file.path]) !== file.sha256) checksums = false
    }
  }
  checks.checksums = checksums ? 'passed' : 'failed'
  if (!checksums) diagnostics.push(diagnostic('checksums', 'One or more declared file hashes do not match.', 'appearance.manifest.json'))

  const assetPaths = paths.filter((path) => path.startsWith('assets/'))
  const manifestAssets = [...manifest.assets].sort((left, right) => left.path.localeCompare(right.path))
  let safeAssets = assetPaths.length === manifestAssets.length
  const assets: Record<string, AppearanceBinaryAsset> = {}
  for (let index = 0; index < manifestAssets.length; index += 1) {
    const asset = manifestAssets[index]
    const data = archive[asset.path]
    const expectedMime = MIME_BY_EXTENSION[extension(asset.path)]
    if (!data || asset.path !== assetPaths[index] || expectedMime !== asset.mimeType || asset.bytes !== data.byteLength ||
      asset.sha256 !== await sha256Hex(data) || !hasExpectedMagic(data, asset.mimeType)) {
      safeAssets = false
      continue
    }
    assets[asset.path] = { mimeType: asset.mimeType, data, sha256: asset.sha256 }
  }
  checks.safeAssets = safeAssets ? 'passed' : 'failed'
  if (!safeAssets) diagnostics.push(diagnostic('safe-assets', 'Asset declarations, extensions, magic bytes or hashes do not match.', 'appearance.manifest.json'))

  const tokenResult = compileAppearanceTokens(tokensValue)
  diagnostics.push(...tokenResult.diagnostics)
  checks.tokens = tokenResult.valid ? 'passed' : 'failed'
  checks.tokenReferences = tokenResult.checks.references ? 'passed' : 'failed'
  checks.tokenTypes = tokenResult.checks.types ? 'passed' : 'failed'
  checks.contrast = tokenResult.checks.contrast ? 'passed' : 'failed'
  checks.touchTargets = tokenResult.checks.touchTargets ? 'passed' : 'failed'

  const cssAudit = auditAndScopeCss(themeCss, manifest.id, manifest.assets.map((asset) => asset.path))
  diagnostics.push(...cssAudit.issues)
  checks.cssSafety = cssAudit.checks.safeRuntime ? 'passed' : 'failed'
  checks.cssScope = cssAudit.checks.cssScope ? 'passed' : 'failed'
  checks.externalResources = cssAudit.checks.externalResources ? 'passed' : 'failed'
  checks.touchTargets = checks.touchTargets === 'passed' && cssAudit.checks.touchTargets ? 'passed' : 'failed'
  checks.reducedMotion = cssAudit.checks.reducedMotion ? 'passed' : 'failed'
  checks.mapAttribution = cssAudit.checks.mapAttribution ? 'passed' : 'failed'

  const isCompatible = compatible(manifest)
  checks.compatibility = isCompatible ? 'passed' : 'failed'
  if (!isCompatible) diagnostics.push(diagnostic('compatibility', `Package is not compatible with app ${APP_VERSION}.`, 'appearance.manifest.json'))

  const report = reportFromDiagnostics(diagnostics, checks, manifest.id, packageSha256)
  const appearance: AppearancePackage | undefined = report.valid ? {
    manifest,
    tokensDocument: tokenResult.document,
    compiledTokens: tokenResult.compiledTokens,
    themeCss,
    sanitizedCss: cssAudit.sanitizedCss,
    assets
  } : undefined
  return appearance ? { package: appearance, report } : { report }
}

function normalizedAssets(assets: Record<string, AppearanceBinaryAsset>): Array<[string, AppearanceBinaryAsset]> {
  return Object.entries(assets).sort(([left], [right]) => left.localeCompare(right))
}

export async function createAppearanceArchive(appearance: AppearancePackage): Promise<Uint8Array> {
  if (!appearance.tokensDocument) throw new Error('v3 packages require tokensDocument.')
  const themeCss = (appearance.themeCss ?? '').replaceAll('\r\n', '\n')
  const tokensBytes = strToU8(stableJson(appearance.tokensDocument))
  const themeBytes = strToU8(themeCss)
  const assets = normalizedAssets(appearance.assets ?? {})
  const manifestAssets: AppearanceAsset[] = []
  const files: AppearanceFile[] = [
    { path: 'theme.css', bytes: themeBytes.byteLength, sha256: await sha256Hex(themeBytes) },
    { path: 'tokens.json', bytes: tokensBytes.byteLength, sha256: await sha256Hex(tokensBytes) }
  ]
  for (const [path, asset] of assets) {
    const sha256 = await sha256Hex(asset.data)
    manifestAssets.push({ path, mimeType: asset.mimeType, bytes: asset.data.byteLength, sha256 })
    files.push({ path, bytes: asset.data.byteLength, sha256 })
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  const manifest: AppearanceManifest = {
    ...appearance.manifest,
    schemaVersion: 3,
    packageFormat: 'netrin-appearance-zip',
    interfaceContractVersion: 2,
    type: 'skin',
    entrypoints: { tokens: 'tokens.json', theme: 'theme.css' },
    assets: manifestAssets,
    files
  }
  const entries = ([
    ['appearance.manifest.json', strToU8(stableJson(manifest))],
    ['theme.css', themeBytes],
    ['tokens.json', tokensBytes],
    ...assets.map(([path, asset]) => [path, asset.data] as [string, Uint8Array])
  ] as Array<[string, Uint8Array]>).sort(([left], [right]) => left.localeCompare(right))
  const archive: Zippable = {}
  for (const [path, data] of entries) archive[path] = [data, { level: 9, mtime: ZIP_MTIME }]
  return zipSync(archive, { level: 9 })
}

export async function parseAppearanceFile(file: Blob): Promise<AppearanceImportResult> {
  return parseAppearanceArchive(new Uint8Array(await file.arrayBuffer()))
}

export function unsupportedLegacyAppearance(): AppearanceImportResult {
  return failedResult('unsupported-schema-version', 'Appearance schema v1/v2 is no longer supported.')
}
