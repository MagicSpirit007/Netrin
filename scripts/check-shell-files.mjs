import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tracked = execFileSync('git', ['ls-files', '*.sh'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean)
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '*.sh'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean)
const deployRoot = resolve(root, 'deploy')
const deployFiles = existsSync(deployRoot)
  ? readdirSync(deployRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sh'))
      .map((entry) => relative(root, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  : []
const requested = process.argv.slice(2)
const files = [...new Set([...tracked, ...untracked, ...deployFiles, ...requested])]
  .filter((file) => existsSync(resolve(root, file)))
  .sort()
const crlf = files.filter((file) => readFileSync(resolve(root, file)).includes(0x0d))
if (crlf.length) {
  crlf.forEach((file) => console.error(`CRLF shell script rejected: ${file}`))
  process.exit(1)
}
for (const file of files) execFileSync('bash', ['-n', file.replaceAll('\\', '/')], { cwd: root, stdio: 'inherit' })
console.log(`Shell gate passed: ${files.length} LF-only script(s); bash -n clean.`)
