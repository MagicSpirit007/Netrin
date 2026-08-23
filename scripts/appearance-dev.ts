import { stat } from 'node:fs/promises'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { buildAppearanceSource } from './appearance-source'

const input = process.argv[2]
if (!input) throw new Error('Usage: npm run appearance:dev -- <source-directory>')
const sourceDirectory = path.resolve(input)
if (!(await stat(sourceDirectory)).isDirectory()) throw new Error(`Not a directory: ${sourceDirectory}`)
const built = await buildAppearanceSource(sourceDirectory)
process.env.NETRIN_APPEARANCE_DEV_SOURCE = sourceDirectory
process.env.NETRIN_APPEARANCE_DEV_ISOLATED = '1'

let server: ViteDevServer | undefined
let closing: Promise<void> | undefined
const close = () => {
  if (!closing) closing = server?.close().then(() => undefined) ?? Promise.resolve()
  return closing
}
const terminate = (signal: NodeJS.Signals) => {
  void close().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
}
process.once('SIGINT', terminate)
process.once('SIGTERM', terminate)
process.once('beforeExit', () => { void close() })

try {
  server = await createServer({
    root: process.cwd(),
    server: { host: '127.0.0.1', port: 0, strictPort: true },
    clearScreen: false,
    define: { 'import.meta.env.NETRIN_APPEARANCE_DEV_ISOLATED': JSON.stringify('1') }
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('appearance:dev did not expose a TCP port.')
  console.log(`appearance:dev URL: http://127.0.0.1:${address.port}/netrin/appearance-studio?tab=workbench`)
  console.log(`appearance:dev source: ${sourceDirectory}`)
  console.log(`appearance:dev SHA-256: ${built.result.report.packageSha256 ?? 'invalid'}`)
} catch (error) {
  await close()
  throw error
}
