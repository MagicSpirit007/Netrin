import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const files = process.argv.slice(2).map((value) => resolve(value))
if (!files.length) throw new Error('Usage: node scripts/prepare-appearance-release.mjs <artifact> [...]')
const lines = []
for (const file of files) {
  const bytes = await readFile(file)
  if (file.endsWith('.sh') && bytes.includes(0x0d)) throw new Error(`CRLF shell script rejected before upload: ${file}`)
  lines.push(`${createHash('sha256').update(bytes).digest('hex')}  ${file.replaceAll('\\', '/')}`)
}
const manifest = resolve(process.cwd(), 'appearance-release.sha256')
await writeFile(manifest, `${lines.join('\n')}\n`, 'utf8')
console.log(manifest)
