import path from 'node:path'
import { checkAppearanceInput } from './appearance-source'

const args = process.argv.slice(2)
const json = args.includes('--json')
const input = args.find((argument) => argument !== '--json')
if (!input) throw new Error('Usage: npm run appearance:check -- <directory-or-package> [--json]')
const result = await checkAppearanceInput(input)
if (json) console.log(JSON.stringify(result.report))
else {
  console.log(JSON.stringify({ input: path.resolve(input), ...result.report }, null, 2))
}
if (!result.report.valid) process.exitCode = 1
