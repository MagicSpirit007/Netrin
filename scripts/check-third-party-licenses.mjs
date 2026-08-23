import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const PROJECT_LICENSE = 'AGPL-3.0-or-later'
const LOCKFILES = [
  'package-lock.json',
  'services/netrin-ai-orchestrator/package-lock.json'
]

// Any new expression must be reviewed before it is added here. This keeps a
// lockfile refresh from silently introducing a new license family.
const REVIEWED_LICENSE_EXPRESSIONS = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  '(MIT AND Zlib)',
  'MIT OR Apache-2.0',
  '(MIT OR CC0-1.0)',
  '(MIT OR GPL-3.0-or-later)',
  'MPL-2.0',
  'Unlicense'
])

function packageName(packagePath) {
  return packagePath.split('node_modules/').at(-1)
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(relativePath), 'utf8'))
}

const problems = []
const inventory = []

for (const lockfile of LOCKFILES) {
  const lock = readJson(lockfile)
  const root = lock.packages?.['']
  if (root?.license !== PROJECT_LICENSE) {
    problems.push(`${lockfile}: root license must be ${PROJECT_LICENSE}`)
  }

  for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
    if (!packagePath?.includes('node_modules/')) continue

    const name = packageName(packagePath)
    const version = metadata.version ?? '(unknown)'
    const license = metadata.license
    if (!license) {
      problems.push(`${lockfile}: ${name}@${version} has no license metadata`)
      continue
    }
    if (!REVIEWED_LICENSE_EXPRESSIONS.has(license)) {
      problems.push(`${lockfile}: ${name}@${version} uses unreviewed license expression ${license}`)
    }
    if (name === 'jszip' && license !== '(MIT OR GPL-3.0-or-later)') {
      problems.push(`${lockfile}: jszip license expression changed; review the selected MIT branch`)
    }

    inventory.push({ lockfile, name, version, license })
  }
}

if (!inventory.some((item) => item.name === 'jszip')) {
  problems.push('package-lock.json: expected jszip dependency is missing; review THIRD_PARTY_NOTICES.md')
}

if (!fs.existsSync('THIRD_PARTY_NOTICES.md')) {
  problems.push('THIRD_PARTY_NOTICES.md is missing')
}

if (problems.length > 0) {
  console.error('Third-party license check failed:')
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}

const byLicense = new Map()
for (const item of inventory) {
  byLicense.set(item.license, (byLicense.get(item.license) ?? 0) + 1)
}

console.log(`Checked ${inventory.length} locked package entries across ${LOCKFILES.length} packages.`)
for (const [license, count] of [...byLicense].sort(([left], [right]) => left.localeCompare(right))) {
  console.log(`${license}: ${count}`)
}
console.log('jszip: MIT branch selected from (MIT OR GPL-3.0-or-later).')
