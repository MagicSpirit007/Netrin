import { preview as createPreview, createServer } from 'vite'
import { startAiCapabilitiesMock } from './lib/ai-capabilities-mock.mjs'

const command = process.argv[2]
if (command !== 'dev' && command !== 'preview') {
  throw new Error('Usage: node scripts/local-ai-vite.mjs <dev|preview> [--host HOST] [--port PORT] [--strictPort]')
}

const args = process.argv.slice(3)
const option = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const host = option('--host') || '127.0.0.1'
const port = Number(option('--port') || (command === 'dev' ? 5173 : 4173))
const strictPort = args.includes('--strictPort')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid local preview port: ${port}`)

const configuredTarget = process.env.NETRIN_AI_ROUTE_PROXY_TARGET?.trim()
let mock
let target
if (configuredTarget) {
  const parsed = new URL(configuredTarget)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('NETRIN_AI_ROUTE_PROXY_TARGET must be an HTTP(S) URL without credentials, query, or hash.')
  }
  target = parsed.toString().replace(/\/+$/, '')
} else {
  mock = await startAiCapabilitiesMock()
  target = mock.url
}

// Standard local preview always exercises the same-origin production contract.
// A stale ignored .env.local must not make the browser bypass this owned proxy.
process.env.VITE_AI_ROUTE_API_BASE = ''

const proxy = {
  '/v1/ai-route': {
    target,
    changeOrigin: true,
    configure(proxyServer) {
      // The browser talks to the local Vite origin. The explicit local proxy is
      // the origin boundary, so do not forward a misleading browser Origin.
      proxyServer.on('proxyReq', (proxyRequest) => proxyRequest.removeHeader('origin'))
    }
  }
}

const server = command === 'dev'
  ? await createServer({ server: { host, port, strictPort, proxy } })
  : await createPreview({ preview: { host, port, strictPort, proxy } })

if (command === 'dev') await server.listen()
server.printUrls()
process.stdout.write(`[local-ai] ${configuredTarget ? `proxy -> ${target}` : 'deterministic mock enabled'}\n`)

let closing = false
const close = async (exitCode) => {
  if (closing) return
  closing = true
  await server.close().catch(() => undefined)
  await mock?.close().catch(() => undefined)
  process.exit(exitCode)
}
process.once('SIGINT', () => { void close(130) })
process.once('SIGTERM', () => { void close(143) })
