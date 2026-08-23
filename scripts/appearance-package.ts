import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildAppearanceSource } from './appearance-source'

const input = process.argv[2]
if (!input) throw new Error('Usage: npm run appearance:package -- <directory> [output-file]')
const { archive, result } = await buildAppearanceSource(input)
if (!result.report.valid || !result.package) {
  console.error(JSON.stringify(result.report, null, 2))
  process.exitCode = 1
} else {
  const output = path.resolve(process.argv[3] ?? `${result.package.manifest.id}.netrin-appearance`)
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, archive)
  console.log(`${output}\n${archive.byteLength} bytes\nsha256 ${result.report.packageSha256}`)
}
