import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import packageMetadata from '../package.json'
import { createDefaultTokenDocument } from '../src/appearance/tokenCompiler'
import { stableJson } from '../src/appearance/packageFormat'

const id = process.argv[2]
if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Usage: npm run appearance:init -- <lowercase-id> [directory]')
const directory = path.resolve(process.argv[3] ?? id)
await mkdir(directory, { recursive: true })
if ((await readdir(directory)).length) throw new Error(`Refusing to overwrite non-empty directory: ${directory}`)
await mkdir(path.join(directory, 'assets'))
const manifest = {
  schemaVersion: 3, packageFormat: 'netrin-appearance-zip', interfaceContractVersion: 2,
  id, displayName: id.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' '),
  summary: 'A Netrin appearance package.', version: '0.1.0', type: 'skin', author: 'Your name', license: 'MIT',
  compatibility: { minAppVersion: packageMetadata.version }, entrypoints: { tokens: 'tokens.json', theme: 'theme.css' }, assets: [], files: []
}
await writeFile(path.join(directory, 'appearance.manifest.json'), stableJson(manifest), { flag: 'wx' })
await writeFile(path.join(directory, 'tokens.json'), stableJson(createDefaultTokenDocument()), { flag: 'wx' })
await writeFile(path.join(directory, 'theme.css'), '[data-appearance-hook="button"] {\n  box-shadow: var(--shadow-hard);\n}\n', { flag: 'wx' })
await writeFile(path.join(directory, 'README.md'), `# ${manifest.displayName}\n\nRun \`npm run appearance:dev -- ${directory}\` from the Netrin repository.\n`, { flag: 'wx' })
console.log(directory)
