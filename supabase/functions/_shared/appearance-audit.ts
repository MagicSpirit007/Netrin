import { strFromU8, unzipSync } from 'npm:fflate@0.8.2'
import {
  APPEARANCE_INTERFACE_CONTRACT_VERSION,
  APPEARANCE_SUMMARY_MAX_LENGTH,
  APPEARANCE_SUMMARY_MIN_LENGTH
} from '../../../appearance/contract.ts'
import { compileAppearanceTokens } from '../../../src/appearance/tokenCompiler.ts'

const MAX_ARCHIVE = 5 * 1024 * 1024
const MAX_EXPANDED = 8 * 1024 * 1024
const MAX_FILE = 2 * 1024 * 1024
const MAX_TEXT = 256 * 1024
const SAFE_PATH = /^[a-z0-9][a-z0-9._/-]*$/i
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i
const SHA = /^[a-f0-9]{64}$/
const FORBIDDEN_CSS = /(?:@import\b|javascript\s*:|expression\s*\(|behavior\s*:|<script\b|https?:\/\/|(?:^|[,{])\s*(?:html|body|:root|\*|\.amap-|#amap-)|display\s*:\s*none|visibility\s*:\s*hidden|position\s*:\s*fixed)/im
const MOTION = /(?:animation|transition)\s*:/i
const REDUCED_MOTION = /@media\s*\([^)]*prefers-reduced-motion\s*:\s*reduce[^)]*\)/i

function hasApplicationPrivateClassSelector(css: string): boolean {
  const rulePrelude = /(?:^|[{}])\s*([^@{}][^{}]*)\{/g
  return [...css.matchAll(rulePrelude)].some((match) => /\.[a-z_][a-z0-9_-]*/i.test(match[1]))
}

type CheckStatus = 'passed' | 'failed' | 'not-run'
type Diagnostic = { severity: 'error' | 'warning'; code: string; message: string; file?: string; line?: number; column?: number; selector?: string; tokenPath?: string }
type Manifest = {
  schemaVersion: 3; packageFormat: 'netrin-appearance-zip'; interfaceContractVersion: 2; id: string; displayName: string;
  summary: string; version: string; type: 'skin'; author: string; license: string;
  compatibility: { minAppVersion: string; maxAppVersion?: string }; entrypoints: { tokens: 'tokens.json'; theme: 'theme.css' };
  files: Array<{ path: string; bytes: number; sha256: string }>;
  assets: Array<{ path: string; bytes: number; sha256: string; mimeType: string }>
}

function safePath(value: string): boolean {
  return SAFE_PATH.test(value) && !value.startsWith('/') && !value.includes('\\') && value.split('/').every((part) => part && part !== '.' && part !== '..')
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
async function sha256(bytes: Uint8Array): Promise<string> {
  const view = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', view))].map((value) => value.toString(16).padStart(2, '0')).join('')
}
function hasExpectedMagic(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') return bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value)
  if (mimeType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  if (mimeType === 'image/webp') return bytes.length >= 12 && strFromU8(bytes.slice(0, 4)) === 'RIFF' && strFromU8(bytes.slice(8, 12)) === 'WEBP'
  if (mimeType === 'font/woff2') return bytes.length >= 4 && strFromU8(bytes.slice(0, 4)) === 'wOF2'
  return false
}
function validManifest(value: unknown): value is Manifest {
  if (!record(value)) return false
  const allowed = new Set(['schemaVersion','packageFormat','interfaceContractVersion','id','displayName','summary','version','type','author','license','compatibility','entrypoints','assets','files'])
  return Object.keys(value).every((key) => allowed.has(key)) && value.schemaVersion === 3 && value.packageFormat === 'netrin-appearance-zip' &&
    value.interfaceContractVersion === APPEARANCE_INTERFACE_CONTRACT_VERSION && value.type === 'skin' &&
    typeof value.id === 'string' && SAFE_ID.test(value.id) && typeof value.displayName === 'string' && value.displayName.length > 0 && value.displayName.length <= 80 &&
    typeof value.summary === 'string' && value.summary.length >= APPEARANCE_SUMMARY_MIN_LENGTH &&
    value.summary.length <= APPEARANCE_SUMMARY_MAX_LENGTH && typeof value.version === 'string' && SAFE_VERSION.test(value.version) &&
    typeof value.author === 'string' && value.author.length > 0 && typeof value.license === 'string' && value.license.length > 0 &&
    record(value.compatibility) && typeof value.compatibility.minAppVersion === 'string' && SAFE_VERSION.test(value.compatibility.minAppVersion) &&
    record(value.entrypoints) && value.entrypoints.tokens === 'tokens.json' && value.entrypoints.theme === 'theme.css' && Array.isArray(value.files) && Array.isArray(value.assets)
}

export type ServerAppearanceAudit = {
  valid: boolean; activatable: boolean; checkedAt: string; packageId: string; packageSha256: string;
  diagnostics: Diagnostic[]; checks: Record<string, CheckStatus>
}

export async function auditAppearanceArchive(bytes: Uint8Array): Promise<{ manifest: Manifest; report: ServerAppearanceAudit }> {
  if (bytes.byteLength < 4 || bytes.byteLength > MAX_ARCHIVE || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Package must be a v3 ZIP no larger than 5 MiB.')
  const packageSha256 = await sha256(bytes)
  let expanded = 0
  const seen = new Set<string>()
  const files = unzipSync(bytes, { filter(info) {
    const entry = info.name.endsWith('/') ? info.name.slice(0, -1) : info.name
    if (!safePath(entry) || info.originalSize > MAX_FILE) throw new Error(`Unsafe archive entry: ${info.name}`)
    expanded += info.originalSize
    if (expanded > MAX_EXPANDED) throw new Error('Expanded package exceeds 8 MiB.')
    if (!info.name.endsWith('/') && seen.has(entry)) throw new Error(`Duplicate archive entry: ${entry}`)
    if (!info.name.endsWith('/')) seen.add(entry)
    return !info.name.endsWith('/')
  } })
  const manifestBytes = files['appearance.manifest.json']
  if (!manifestBytes || manifestBytes.byteLength > 128 * 1024) throw new Error('appearance.manifest.json is required.')
  let rawManifest: unknown
  try { rawManifest = JSON.parse(strFromU8(manifestBytes)) } catch { throw new Error('appearance.manifest.json is invalid JSON.') }
  if (!validManifest(rawManifest)) throw new Error('unsupported-schema-version: only schemaVersion 3 / interfaceContractVersion 2 skin packages are accepted.')
  const manifest = rawManifest
  const diagnostics: Diagnostic[] = []
  const checks: Record<string, CheckStatus> = {
    archiveSafety: 'passed', schema: 'passed', declaredFiles: 'passed', checksums: 'passed', safeAssets: 'passed', tokens: 'not-run',
    tokenReferences: 'not-run', tokenTypes: 'not-run', contrast: 'not-run', touchTargets: 'not-run', cssSafety: 'not-run', cssScope: 'not-run',
    externalResources: 'not-run', compatibility: 'passed', reducedMotion: 'not-run', mapAttribution: 'not-run'
  }
  const actualPaths = Object.keys(files).sort()
  if (!actualPaths.every((entry) => entry === 'appearance.manifest.json' || entry === 'tokens.json' || entry === 'theme.css' || entry.startsWith('assets/'))) checks.declaredFiles = 'failed'
  const declared = new Map(manifest.files.map((file) => [file.path, file]))
  const payloadPaths = actualPaths.filter((entry) => entry !== 'appearance.manifest.json')
  if (payloadPaths.length !== declared.size || !payloadPaths.every((entry) => declared.has(entry)) || !declared.has('tokens.json') || !declared.has('theme.css')) checks.declaredFiles = 'failed'
  for (const [entry, expected] of declared) {
    const content = files[entry]
    if (!safePath(entry) || !content || content.byteLength !== expected.bytes || !SHA.test(expected.sha256) || await sha256(content) !== expected.sha256) checks.checksums = 'failed'
  }
  const assetPaths = payloadPaths.filter((entry) => entry.startsWith('assets/')).sort()
  const manifestAssetPaths = manifest.assets.map((asset) => asset.path).sort()
  if (assetPaths.length !== manifestAssetPaths.length || !assetPaths.every((entry, index) => entry === manifestAssetPaths[index]) || manifest.assets.some((asset) => !files[asset.path] || !hasExpectedMagic(files[asset.path], asset.mimeType))) checks.safeAssets = 'failed'
  try {
    const tokenBytes = files['tokens.json']
    if (!tokenBytes || tokenBytes.byteLength > MAX_TEXT) throw new Error('tokens.json is missing or too large.')
    const compiled = compileAppearanceTokens(JSON.parse(strFromU8(tokenBytes)))
    diagnostics.push(...compiled.diagnostics)
    checks.tokens = compiled.valid ? 'passed' : 'failed'
    checks.tokenReferences = compiled.checks.references ? 'passed' : 'failed'
    checks.tokenTypes = compiled.checks.types ? 'passed' : 'failed'
    checks.contrast = compiled.checks.contrast ? 'passed' : 'failed'
    checks.touchTargets = compiled.checks.touchTargets ? 'passed' : 'failed'
  } catch (error) {
    checks.tokens = checks.tokenReferences = checks.tokenTypes = checks.contrast = checks.touchTargets = 'failed'
    diagnostics.push({ severity: 'error', code: 'tokens', message: String(error), file: 'tokens.json' })
  }
  const cssBytes = files['theme.css']
  const css = cssBytes && cssBytes.byteLength <= MAX_TEXT ? strFromU8(cssBytes) : ''
  const cssSafe = Boolean(cssBytes) && !FORBIDDEN_CSS.test(css) && !hasApplicationPrivateClassSelector(css)
  checks.cssSafety = checks.cssScope = checks.externalResources = checks.mapAttribution = cssSafe ? 'passed' : 'failed'
  checks.reducedMotion = !MOTION.test(css) || REDUCED_MOTION.test(css) ? 'passed' : 'failed'
  for (const [code, status] of Object.entries(checks)) if (status === 'failed') diagnostics.push({ severity: 'error', code, message: `${code} check failed.` })
  const valid = Object.values(checks).every((status) => status === 'passed') && !diagnostics.some((item) => item.severity === 'error')
  const report = { valid, activatable: valid, checkedAt: new Date().toISOString(), packageId: manifest.id, packageSha256, diagnostics, checks }
  if (!valid) throw new Error(`Package machine audit failed: ${diagnostics.map((item) => item.code).join(', ')}`)
  return { manifest, report }
}
