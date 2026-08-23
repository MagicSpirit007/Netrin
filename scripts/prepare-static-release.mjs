import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const releaseId = process.argv[2]

if (!releaseId || !/^netrin-[a-zA-Z0-9._-]+$/.test(releaseId)) {
  throw new Error('Usage: npm run release:static -- netrin-<release-id>')
}

const repositoryRoot = process.cwd()
const distRoot = path.join(repositoryRoot, 'dist')
const releaseRoot = path.join(repositoryRoot, 'deploy', releaseId)
const archivePath = path.join(releaseRoot, 'netrin-static.tar.gz')
const manifestPath = path.join(releaseRoot, 'dist-files.sha256')
const metadataPath = path.join(releaseRoot, 'release.json')

const distStats = await stat(distRoot).catch(() => null)
if (!distStats?.isDirectory()) {
  throw new Error('dist/ does not exist; run the production build first')
}

const releaseStats = await stat(releaseRoot).catch(() => null)
if (releaseStats) {
  throw new Error(`Refusing to overwrite existing release directory: ${releaseRoot}`)
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const collected = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collected.push(...await collectFiles(absolutePath))
    } else if (entry.isFile()) {
      collected.push(absolutePath)
    }
  }

  return collected
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

const files = await collectFiles(distRoot)
if (files.length === 0) {
  throw new Error('dist/ is empty')
}

const forbiddenPaths = files
  .map((file) => path.relative(distRoot, file).replaceAll('\\', '/'))
  .filter((relativePath) => /(^|\/)(\.env(?:\.|$)|.*\.map$)/i.test(relativePath))

if (forbiddenPaths.length > 0) {
  throw new Error(`Forbidden deployment artifacts found: ${forbiddenPaths.join(', ')}`)
}

const manifestLines = []
for (const file of files) {
  const relativePath = path.relative(distRoot, file).replaceAll('\\', '/')
  const content = await readFile(file)
  manifestLines.push(`${sha256(content)}  ${relativePath}`)
}

await mkdir(path.dirname(releaseRoot), { recursive: true })
await mkdir(releaseRoot, { recursive: false })
await writeFile(manifestPath, `${manifestLines.join('\n')}\n`, 'utf8')

execFileSync('tar', ['-czf', archivePath, '-C', distRoot, '.'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
})

const archive = await readFile(archivePath)
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'))
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim()

const metadata = {
  releaseId,
  version: packageJson.version,
  sourceCommit,
  createdAtUtc: new Date().toISOString(),
  archive: path.basename(archivePath),
  archiveSha256: sha256(archive),
  archiveSizeBytes: archive.byteLength,
  fileManifest: path.basename(manifestPath),
  fileCount: files.length,
}

await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`)
