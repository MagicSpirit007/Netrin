import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const distAssets = resolve(root, 'dist', 'assets')
const baseline = JSON.parse(readFileSync(resolve(root, 'scripts', 'performance-baseline.json'), 'utf8'))
if (!existsSync(distAssets)) throw new Error('dist/assets is missing; run vite build first')

const files = readdirSync(distAssets).map((name) => ({ name, bytes: statSync(resolve(distAssets, name)).size }))
const failures = []
for (const [label, rule] of Object.entries(baseline.assets)) {
  const matches = files.filter((file) => file.name.startsWith(rule.prefix) && file.name.endsWith(rule.suffix))
  if (matches.length !== 1) { failures.push(`${label}: expected one ${rule.prefix}*${rule.suffix}, found ${matches.length}`); continue }
  const limit = Math.ceil(rule.bytes * 1.1)
  if (matches[0].bytes > limit) failures.push(`${label}: ${matches[0].bytes} bytes exceeds 110% budget ${limit}`)
}

if (failures.length) {
  failures.forEach((failure) => console.error(`ERROR: ${failure}`))
  process.exitCode = 1
} else {
  console.log(`Performance budget passed (${Object.keys(baseline.assets).length} recorded baseline assets, <=10% regression).`)
}
