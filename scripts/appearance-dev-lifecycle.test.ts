import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const temporary: string[] = []
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function waitFor<T>(read: () => Promise<T | undefined>, timeout = 20_000): Promise<T> {
  const deadline = Date.now() + timeout
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (value !== undefined) return value
    } catch (error) { lastError = error }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Timed out waiting for appearance:dev lifecycle: ${String(lastError)}`)
}

async function runInit(source: string) {
  const child = spawn(process.execPath, [
    resolve(root, 'node_modules/tsx/dist/cli.mjs'),
    resolve(root, 'scripts/appearance-init.ts'),
    'temporary-v3-lifecycle-fixture',
    source
  ], { cwd: root, windowsHide: true, stdio: 'ignore' })
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error(`appearance:init exited with ${code}`)
}

async function stopChild(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) return
  const waitUntilStopped = async () => {
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) return true
      try {
        process.kill(child.pid!, 0)
      } catch {
        return true
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
    return false
  }

  child.kill('SIGTERM')
  if (await waitUntilStopped()) return

  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    child.kill('SIGKILL')
  }
  if (!await waitUntilStopped()) throw new Error('appearance:dev did not exit')
}

describe('appearance:dev process lifecycle', () => {
  it('serves, emits an HMR revision, closes the port and leaves no Vite child tree', async () => {
    const source = await mkdtemp(resolve(tmpdir(), 'netrin-appearance-dev-lifecycle-'))
    temporary.push(source)
    await runInit(source)
    const child = spawn(process.execPath, [
      resolve(root, 'node_modules/tsx/dist/cli.mjs'),
      resolve(root, 'scripts/appearance-dev.ts'),
      source
    ], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    try {
      const url = await waitFor(async () => {
        const match = /appearance:dev URL: (http:\/\/127\.0\.0\.1:\d+\/netrin\/appearance-studio\?tab=workbench)/.exec(output)
        const metadataReady = output.includes(`appearance:dev source: ${source}`)
          && /appearance:dev SHA-256: [a-f0-9]{64}/.test(output)
        return match && metadataReady ? match[1] : undefined
      })
      const response = await fetch(url)
      expect(response.ok).toBe(true)
      expect(response.headers.get('content-security-policy')).toContain("connect-src 'self' ws://127.0.0.1:*")
      const origin = new URL(url).origin
      const before = await (await fetch(`${origin}/__netrin/appearance-dev/status`)).json() as { revision: number }
      await appendFile(resolve(source, 'theme.css'), '\n[data-appearance-slot="brand-mark"] { opacity: .99; }\n')
      const after = await waitFor(async () => {
        const value = await (await fetch(`${origin}/__netrin/appearance-dev/status`)).json() as { revision: number }
        return value.revision > before.revision ? value : undefined
      })
      expect(after.revision).toBeGreaterThan(before.revision)
      await stopChild(child)
      await expect(fetch(url)).rejects.toThrow()
      expect(() => process.kill(child.pid!, 0)).toThrow()
    } finally {
      await stopChild(child)
    }
  }, 40_000)
})
