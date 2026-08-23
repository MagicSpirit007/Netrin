// @ts-nocheck -- Vite executes this Node-only plugin; the app tsconfig intentionally exposes browser types only.
import type { Plugin } from 'vite'
import path from 'node:path'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { buildAppearanceSource } from './appearance-source'

const PREFIX = '/__netrin/appearance-dev/'
const LAYOUT_FIXTURE = process.env.NETRIN_APPEARANCE_DEV_LAYOUT_FIXTURE === '1'
const LAYOUT_FIXTURE_PATH = `appearance-work/${'long-source-directory-'.repeat(8)}appearance.manifest.json`

function json(response: import('node:http').ServerResponse, status: number, value: unknown) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(value))
}

export function netrinAppearanceDevPlugin(): Plugin {
  const configured = process.env.NETRIN_APPEARANCE_DEV_SOURCE
  if (!configured) return { name: 'netrin-appearance-dev-disabled' }
  const sourceDirectory = path.resolve(configured)
  let revision = 0
  return {
    name: 'netrin-appearance-dev',
    apply: 'serve',
    config() {
      return { define: { 'import.meta.env.NETRIN_APPEARANCE_DEV_ISOLATED': JSON.stringify('1') } }
    },
    configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        response.setHeader('content-security-policy', "default-src 'self'; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; font-src 'self' blob:")
        next()
      })
      server.watcher.add(sourceDirectory)
      server.watcher.on('all', (_event, changedPath) => {
        const relative = path.relative(sourceDirectory, path.resolve(changedPath))
        if (relative.startsWith('..') || path.isAbsolute(relative)) return
        revision += 1
        server.ws.send({ type: 'custom', event: 'netrin:appearance-dev-update', data: { revision } })
      })
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (!url.pathname.startsWith(PREFIX)) return next()
        try {
          const { archive, result } = await buildAppearanceSource(sourceDirectory)
          if (url.pathname === `${PREFIX}status`) {
            const report = LAYOUT_FIXTURE ? {
              ...result.report,
              diagnostics: [
                ...result.report.diagnostics,
                {
                  severity: 'warning',
                  code: 'layout-regression-fixture',
                  file: LAYOUT_FIXTURE_PATH,
                  line: 987654,
                  column: 321,
                  selector: `[data-appearance-slot="brand-wordmark"][data-layout-fixture="${'diagnostic-value-'.repeat(18)}"]`,
                  message: `Long diagnostic fixture: ${'中英文 diagnostic content '.repeat(18)}`
                }
              ]
            } : result.report
            json(response, 200, {
              revision,
              sourceDirectory: LAYOUT_FIXTURE ? LAYOUT_FIXTURE_PATH : path.basename(sourceDirectory),
              report
            })
            return
          }
          if (url.pathname === `${PREFIX}package`) {
            response.statusCode = result.report.valid ? 200 : 422
            response.setHeader('content-type', 'application/vnd.netrin.appearance+zip')
            response.setHeader('cache-control', 'no-store')
            response.end(Buffer.from(archive))
            return
          }
          json(response, 404, { error: 'unknown-appearance-dev-endpoint' })
        } catch (error) {
          json(response, 422, { error: error instanceof Error ? error.message : String(error) })
        }
      })
    }
  }
}
