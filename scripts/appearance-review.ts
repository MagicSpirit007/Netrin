import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startAiCapabilitiesMock } from './lib/ai-capabilities-mock.mjs'
import packageMetadata from '../package.json'
import { APPEARANCE_REVIEW_ROUTES, REQUIRED_APPEARANCE_SCREENS, type AppearanceScreenId } from '../src/appearance/contract'
import { sha256Hex, stableJson } from '../src/appearance/packageFormat'
import type { AppearanceCheckStatus, AppearanceDiagnostic, AppearanceReviewCheck, AppearanceReviewReport } from '../src/appearance/types'
import { buildAppearanceSource } from './appearance-source'

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: 'inherit', windowsHide: true })
    child.on('error', rejectRun)
    child.on('exit', (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with ${code}`)))
  })
}

const input = process.argv[2]
if (!input) throw new Error('Usage: npm run appearance:review -- <source-directory> [artifact-directory]')
const sourceDirectory = path.resolve(input)
const { archive, result } = await buildAppearanceSource(sourceDirectory)
const packageId = result.package?.manifest.id ?? path.basename(sourceDirectory)
const packageVersion = result.package?.manifest.version ?? '0.0.0'
const artifactDirectory = path.resolve(process.argv[3] ?? `appearance/review-artifacts/${packageId}`)
await mkdir(artifactDirectory, { recursive: true })
await Promise.all((await readdir(artifactDirectory)).filter((file) => /^appearance-(?:zh-CN|en)-.+\.png$/.test(file))
  .map((file) => rm(path.join(artifactDirectory, file), { force: true })))
const packagePath = path.join(artifactDirectory, `${packageId}.netrin-appearance`)
await writeFile(packagePath, archive)

const checks = Object.fromEntries([
  'packageAudit', 'typecheck', 'productionBuild', 'routeSmoke', 'locales', 'viewport390x844', 'reducedMotion', 'networkIsolation'
].map((name) => [name, 'not-run'])) as Record<AppearanceReviewCheck, AppearanceCheckStatus>
const diagnostics: AppearanceDiagnostic[] = [...result.report.diagnostics]
checks.packageAudit = result.report.valid ? 'passed' : 'failed'
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('npm_execpath is unavailable; run this command through npm.')
const invokeNpm = (script: string, env = process.env) => run(process.execPath, [npmCli, 'run', script], env)

if (result.report.valid) {
  const aiMock = await startAiCapabilitiesMock()
  let interrupted = false
  const interrupt = () => { interrupted = true; void aiMock.close() }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    try { await invokeNpm('typecheck'); checks.typecheck = 'passed' }
    catch (error) { checks.typecheck = 'failed'; diagnostics.push({ severity: 'error', code: 'typecheck', message: String(error) }) }
    try {
      await invokeNpm('build', {
        ...process.env,
        VITE_AMAP_SERVICE_HOST: process.env.VITE_AMAP_SERVICE_HOST || 'https://utopians.cloud/_AMapService',
        VITE_AI_ROUTE_API_BASE: aiMock.url
      })
      checks.productionBuild = 'passed'
    } catch (error) {
      checks.productionBuild = 'failed'
      diagnostics.push({ severity: 'error', code: 'production-build', message: String(error) })
    }
    if (checks.productionBuild === 'passed' && !interrupted) {
      try {
        await invokeNpm('test:smoke', {
          ...process.env, NETRIN_SMOKE_ARTIFACT_DIR: artifactDirectory, NETRIN_APPEARANCE_TEST_FILE: packagePath,
          NETRIN_SMOKE_AI_CAPABILITIES: '1', NETRIN_SMOKE_AI_BASE_URL: aiMock.url
        })
        if (!aiMock.requests.some((request) => request.url === '/v1/ai-route/providers')) {
          throw new Error('Browser smoke did not reach the owned AI capabilities mock.')
        }
        checks.routeSmoke = checks.locales = checks.viewport390x844 = checks.reducedMotion = checks.networkIsolation = 'passed'
      } catch (error) {
        checks.routeSmoke = checks.locales = checks.viewport390x844 = checks.reducedMotion = checks.networkIsolation = 'failed'
        diagnostics.push({ severity: 'error', code: 'browser-review', message: String(error) })
      }
    }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    await aiMock.close()
  }
}

const screenshotFiles = (await readdir(artifactDirectory)).filter((file) => /^appearance-(?:zh-CN|en)-.+\.png$/.test(file)).sort()
const screenshots = await Promise.all(screenshotFiles.map(async (file) => {
  const match = /^appearance-(zh-CN|en)-(.+)\.png$/.exec(file)!
  const screenId = match[2] as AppearanceScreenId
  const bytes = new Uint8Array(await readFile(path.join(artifactDirectory, file)))
  return {
    screenId, route: APPEARANCE_REVIEW_ROUTES[screenId] ?? '', locale: match[1] as 'zh-CN' | 'en',
    viewport: { width: 390 as const, height: 844 as const }, reducedMotion: true, file, sha256: await sha256Hex(bytes)
  }
}))
if (screenshots.length !== REQUIRED_APPEARANCE_SCREENS.length * 2) {
  if (checks.routeSmoke === 'passed') checks.routeSmoke = 'failed'
  diagnostics.push({ severity: 'error', code: 'screenshot-evidence', message: `Expected 20 bilingual screen-family screenshots; found ${screenshots.length}.` })
}
const report: AppearanceReviewReport = {
  schemaVersion: 1, packageId, packageVersion, packageSha256: result.report.packageSha256 ?? await sha256Hex(archive),
  appVersion: packageMetadata.version, interfaceContractVersion: 2, generatedAt: new Date().toISOString(), checks, screenshots, diagnostics
}
const reportPath = path.join(artifactDirectory, `${packageId}.netrin-review.json`)
await writeFile(reportPath, stableJson(report))
console.log(`${packagePath}\n${reportPath}\n${Object.entries(checks).map(([name, status]) => `${name}: ${status}`).join('\n')}`)
if (Object.values(checks).some((status) => status !== 'passed')) process.exitCode = 1
