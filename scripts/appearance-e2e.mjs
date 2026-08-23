import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const APPEARANCE_REVIEW_CHECKS = [
  'packageAudit', 'typecheck', 'productionBuild', 'routeSmoke', 'locales',
  'viewport390x844', 'reducedMotion', 'networkIsolation'
]

const root = resolve(import.meta.dirname, '..')
const tsx = resolve(root, 'node_modules/tsx/dist/cli.mjs')
const temporary = await mkdtemp(join(tmpdir(), 'netrin-appearance-e2e-'))
const source = join(temporary, 'source')
const artifacts = join(temporary, 'artifacts')
const packagePath = join(artifacts, 'temporary-v3-e2e-fixture.netrin-appearance')

async function run(script, args, options = {}) {
  const child = spawn(process.execPath, [tsx, resolve(root, `scripts/${script}`), ...args], {
    cwd: root, windowsHide: true, stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: { ...process.env, ...options.env }
  })
  let output = ''
  child.stdout?.on('data', (chunk) => { output += String(chunk) })
  child.stderr?.on('data', (chunk) => { output += String(chunk) })
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error(output || `${script} exited with ${code}`)
  return output
}

try {
  await mkdir(artifacts, { recursive: true })
  await run('appearance-init.ts', ['temporary-v3-e2e-fixture', source])
  const dev = spawn(process.execPath, [tsx, resolve(root, 'scripts/appearance-dev.ts'), source], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  })
  let devOutput = ''
  dev.stdout.on('data', (chunk) => { devOutput += String(chunk) })
  dev.stderr.on('data', (chunk) => { devOutput += String(chunk) })
  const deadline = Date.now() + 20_000
  let devUrl = ''
  while (Date.now() < deadline && !devUrl) {
    devUrl = /appearance:dev URL: (http:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(devOutput)?.[1] ?? ''
    if (!devUrl) await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  if (!devUrl || !(await fetch(devUrl)).ok) throw new Error(`appearance:dev did not become ready: ${devOutput}`)
  dev.kill('SIGTERM')
  await once(dev, 'exit')
  await fetch(devUrl).then(() => { throw new Error('appearance:dev port remained open after termination') }, () => undefined)

  await run('appearance-check.ts', [source, '--json'])
  await run('appearance-package.ts', [source, packagePath])
  await run('appearance-review.ts', [source, artifacts])
  const reportPath = join(artifacts, 'temporary-v3-e2e-fixture.netrin-review.json')
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  if (report.packageId !== 'temporary-v3-e2e-fixture' || report.interfaceContractVersion !== 2 ||
    !/^[a-f0-9]{64}$/.test(report.packageSha256) || report.screenshots?.length !== 20 ||
    report.screenshots.some((shot) => shot.viewport?.width !== 390 || shot.viewport?.height !== 844 || shot.reducedMotion !== true || !/^[a-f0-9]{64}$/.test(shot.sha256)) ||
    report.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
    Object.values(report.checks).some((status) => status !== 'passed')) {
    throw new Error('Generated review failed strict eight-check/twenty-evidence validation.')
  }
  if (Object.keys(report.checks).sort().join(',') !== [...APPEARANCE_REVIEW_CHECKS].sort().join(',')) {
    throw new Error('Generated review does not contain exactly the eight required checks.')
  }
  console.log(`[appearance-e2e] PASS: ${report.packageSha256}; 8 checks; 20 screenshots`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
