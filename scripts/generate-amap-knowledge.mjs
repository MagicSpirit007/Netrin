import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = path.join(root, 'knowledge', 'amap', 'catalog.json')
const outputPath = path.join(root, 'knowledge', 'amap', 'README.md')
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))

if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries)) {
  throw new Error('Invalid AMap knowledge catalog root.')
}
const required = [
  'id', 'product', 'version', 'capability', 'api', 'useCases', 'inputs', 'outputs',
  'coordinateSystem', 'keyType', 'security', 'statuses', 'limits', 'projectMapping',
  'sourceUrl', 'sourceLastUpdated', 'reviewedAt', 'notes'
]
const ids = new Set()
for (const entry of catalog.entries) {
  for (const field of required) {
    if (!(field in entry)) throw new Error(`Knowledge entry ${entry.id ?? '<unknown>'} lacks ${field}.`)
  }
  if (ids.has(entry.id)) throw new Error(`Duplicate knowledge id: ${entry.id}`)
  ids.add(entry.id)
  const source = new URL(entry.sourceUrl)
  if (source.protocol !== 'https:' || source.hostname !== 'lbs.amap.com') {
    throw new Error(`Non-official source URL: ${entry.sourceUrl}`)
  }
}

if (process.argv.includes('--check-links')) {
  const failed = []
  for (const entry of catalog.entries) {
    try {
      const response = await fetch(entry.sourceUrl, { method: 'GET', redirect: 'follow' })
      if (!response.ok) failed.push(`${entry.id}: HTTP ${response.status}`)
    } catch (error) {
      failed.push(`${entry.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failed.length) throw new Error(`AMap source link check failed:\n${failed.join('\n')}`)
}

const lines = [
  '# AMap Development Knowledge',
  '',
  `Generated from \`catalog.json\`. Reviewed: ${catalog.reviewedAt}.`,
  '',
  '| Capability | API | Coordinate boundary | Project use | Official source |',
  '| --- | --- | --- | --- | --- |'
]

for (const entry of [...catalog.entries].sort((a, b) => a.id.localeCompare(b.id))) {
  const sourceDate = entry.sourceLastUpdated ? ` (${entry.sourceLastUpdated})` : ''
  lines.push(
    `| ${entry.capability} | \`${entry.api}\` | ${entry.coordinateSystem} | ${entry.projectMapping.join('; ')} | [${entry.product}${sourceDate}](${entry.sourceUrl}) |`
  )
}

lines.push('', '## Operating rules', '')
lines.push('- Persist only WGS-84 point content; convert at the AMap adapter boundary.')
lines.push('- Treat walking paths, instructions, distance and duration as in-memory provider output.')
lines.push('- Use the production serviceHost proxy and keep security codes outside the frontend repository.')
lines.push('- Pause navigation and offer retry when AMap routing is unavailable; do not present a straight line as navigation.')
lines.push('')

const output = `${lines.join('\n')}\n`
if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '')
  if (current !== output) throw new Error('AMap knowledge README is stale. Run npm run knowledge:amap.')
} else {
  await writeFile(outputPath, output, 'utf8')
}
