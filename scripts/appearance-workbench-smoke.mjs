import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const port = Number(process.env.NETRIN_APPEARANCE_LAYOUT_PORT ?? 4193)
const debugPort = Number(process.env.NETRIN_APPEARANCE_LAYOUT_DEBUG_PORT ?? 9343)
const baseUrl = `http://127.0.0.1:${port}/netrin/appearance-studio?tab=workbench`
const artifactDir = resolve(process.env.NETRIN_APPEARANCE_LAYOUT_ARTIFACT_DIR ?? join(tmpdir(), 'netrin-appearance-workbench-smoke'))
const browserCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean)

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

async function waitForJson(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
      lastError = new Error(`${response.status} ${response.statusText}`)
    } catch (error) {
      lastError = error
    }
    await delay(200)
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`)
}

async function waitForPage(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch { /* retry */ }
    await delay(200)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

class CdpClient {
  #id = 0
  #pending = new Map()
  #listeners = new Map()

  constructor(socket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.#pending.get(message.id)
        if (!pending) return
        this.#pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
        return
      }
      this.#listeners.get(message.method)?.forEach((listener) => listener(message.params))
    })
  }

  send(method, params = {}) {
    const id = ++this.#id
    return new Promise((resolveRequest, rejectRequest) => {
      this.#pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, listener) {
    const listeners = this.#listeners.get(method) ?? new Set()
    listeners.add(listener)
    this.#listeners.set(method, listeners)
    return () => listeners.delete(listener)
  }

  waitFor(method, timeoutMs = 10_000) {
    return new Promise((resolveEvent, rejectEvent) => {
      const remove = this.on(method, (params) => {
        clearTimeout(timeout)
        remove()
        resolveEvent(params)
      })
      const timeout = setTimeout(() => {
        remove()
        rejectEvent(new Error(`Timed out waiting for CDP event ${method}`))
      }, timeoutMs)
    })
  }
}

function stopProcess(child) {
  if (child && !child.killed) child.kill('SIGTERM')
}

async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options })
  const chunks = []
  child.stdout?.on('data', (chunk) => chunks.push(String(chunk)))
  child.stderr?.on('data', (chunk) => chunks.push(String(chunk)))
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error(chunks.join('').trim() || `${command} exited with ${code}`)
}

async function createSource(directory) {
  await run(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, 'scripts/appearance-init.ts'), 'appearance-layout-fixture', directory])
  await writeFile(resolve(directory, 'theme.css'), [
    '[data-appearance-slot="brand-wordmark"] { background:var(--surface-paper); border:1px solid var(--signal-info); }',
    '[data-appearance-slot="brand-title"] { color:var(--signal-info); }',
    '[data-appearance-slot="brand-name"] { font-family:var(--font-display); }',
    '[data-appearance-slot="brand-mark"] { background:var(--signal-success); }'
  ].join('\n'))
}

async function inspect(cdp, item) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: item.width,
    height: item.height,
    deviceScaleFactor: item.deviceScaleFactor ?? 1,
    mobile: item.width === 390
  })
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: item.pageScaleFactor ?? 1 })
  await cdp.send('Runtime.evaluate', { expression: `localStorage.setItem('netrin.language', ${JSON.stringify(item.locale)})` })
  const loaded = cdp.waitFor('Page.loadEventFired')
  await cdp.send('Page.navigate', { url: baseUrl })
  await loaded
  await delay(1_100)
  const evaluation = await cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const workspace = document.querySelector('.appearance-studio-workspace')
      const previewColumn = document.querySelector('.appearance-studio-preview-column')
      const host = document.querySelector('.appearance-dev-workbench .appearance-preview-shadow')
      const shadowFrame = host?.shadowRoot?.querySelector('.app-frame')
      const columns = workspace ? [...workspace.children].map((element) => element.getBoundingClientRect()) : []
      const overlaps = columns.some((left, index) => columns.slice(index + 1).some((right) => (
        Math.min(left.right, right.right) - Math.max(left.left, right.left) > 0.5 &&
        Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 0.5
      )))
      const controls = [
        document.querySelector('.appearance-dropzone'),
        document.querySelector('.appearance-package-list'),
        document.querySelector('.appearance-preview-shadow'),
        document.querySelector('.admin-file-button'),
        document.querySelector('.appearance-studio-actions')
      ]
      const sourceHash = document.querySelector('.appearance-dev-source-hash code')?.textContent?.trim() ?? ''
      const diagnostic = document.querySelector('.appearance-dev-diagnostic')?.textContent ?? ''
      const sourcePath = document.querySelector('.appearance-dev-source-path')?.textContent ?? ''
      const previewRect = previewColumn?.getBoundingClientRect()
      const hostRect = host?.getBoundingClientRect()
      return {
        locale: document.documentElement.lang,
        innerWidth: window.innerWidth,
        devicePixelRatio: window.devicePixelRatio,
        visualScale: window.visualViewport?.scale ?? 1,
        gridColumns: workspace ? getComputedStyle(workspace).gridTemplateColumns.trim().split(/\\s+/).filter(Boolean).length : 0,
        overlaps,
        bodyScrollWidth: document.body.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        controlsAccessible: controls.every((element) => Boolean(element && getComputedStyle(element).display !== 'none')),
        sourceHashLength: sourceHash.length,
        hasLongDiagnostic: diagnostic.includes('layout-regression-fixture') && diagnostic.length > 500,
        hasLongPath: sourcePath.length > 180,
        brandFixtureCount: host?.shadowRoot?.querySelectorAll('[data-brand-slot-fixture]').length ?? 0,
        brandCoverageCount: document.querySelectorAll('[data-appearance-coverage="slots"] [data-appearance-coverage-source="css"]').length,
        previewWidth: shadowFrame?.getBoundingClientRect().width ?? 0,
        previewContained: Boolean(previewRect && hostRect && hostRect.left >= previewRect.left - 0.5 && hostRect.right <= previewRect.right + 0.5),
        previewSelfScrolls: Boolean(host && host.scrollWidth > host.clientWidth),
        title: document.title,
        text: document.body.innerText
      }
    })()`
  })
  const state = evaluation.result.value
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const screenshotPath = resolve(artifactDir, `appearance-workbench-${item.name}.png`)
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  const failures = []
  if (state.innerWidth !== item.width) failures.push(`viewport ${state.innerWidth} != ${item.width}`)
  if (state.devicePixelRatio !== (item.deviceScaleFactor ?? 1)) failures.push(`device scale ${state.devicePixelRatio}`)
  if (state.locale !== item.locale) failures.push(`locale ${state.locale} != ${item.locale}`)
  if (state.gridColumns !== item.columns) failures.push(`columns ${state.gridColumns} != ${item.columns}`)
  if (state.overlaps) failures.push('columns overlap')
  if (state.bodyScrollWidth > item.width || state.documentScrollWidth > item.width) failures.push('page-level horizontal overflow')
  if (!state.controlsAccessible) failures.push('one or more workbench functions are inaccessible')
  if (state.sourceHashLength !== 64) failures.push(`SHA-256 length ${state.sourceHashLength}`)
  if (!state.hasLongDiagnostic || !state.hasLongPath) failures.push('long diagnostic/path fixture missing')
  if (state.brandFixtureCount !== 4 || state.brandCoverageCount !== 4) failures.push('brand slot fixtures/coverage incomplete')
  if (state.previewWidth !== 390 || !state.previewContained) failures.push('Shadow DOM preview escapes its column')
  if (item.expectPreviewScroll && !state.previewSelfScrolls) failures.push('narrow preview does not self-scroll')
  if (item.locale === 'zh-CN' && !state.text.includes('v3 实时开发工作台')) failures.push('Chinese workbench copy missing')
  if (item.locale === 'en' && !state.text.includes('v3 realtime development workbench')) failures.push('English workbench copy missing')
  if (failures.length) throw new Error(`${item.name}: ${failures.join('; ')}\n${JSON.stringify(state)}`)
  return { ...item, screenshot: screenshotPath, state }
}

async function main() {
  if (typeof WebSocket !== 'function') throw new Error('Node.js 22 or another runtime with global WebSocket is required.')
  const browserPath = browserCandidates.find((candidate) => existsSync(candidate))
  if (!browserPath) throw new Error('Chrome or Edge was not found. Set CHROME_PATH.')
  await mkdir(artifactDir, { recursive: true })
  const sourceDirectory = await mkdtemp(join(tmpdir(), 'netrin-appearance-layout-source-'))
  const profileDirectory = await mkdtemp(join(tmpdir(), 'netrin-appearance-layout-profile-'))
  let vite
  let browser
  let socket
  try {
    await createSource(sourceDirectory)
    vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: root,
      env: { ...process.env, NETRIN_APPEARANCE_DEV_SOURCE: sourceDirectory, NETRIN_APPEARANCE_DEV_LAYOUT_FIXTURE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    await waitForPage(baseUrl)
    browser = spawn(browserPath, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDirectory}`, 'about:blank'
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`)
    const target = targets.find((candidate) => candidate.type === 'page')
    if (!target?.webSocketDebuggerUrl) throw new Error('Chromium did not expose a page target.')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolveSocket, rejectSocket) => {
      socket.addEventListener('open', resolveSocket, { once: true })
      socket.addEventListener('error', rejectSocket, { once: true })
    })
    const cdp = new CdpClient(socket)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    const results = []
    for (const item of [
      { name: 'mobile-390-zh', width: 390, height: 844, locale: 'zh-CN', columns: 1, expectPreviewScroll: true },
      { name: 'medium-760-en', width: 760, height: 900, locale: 'en', columns: 2, expectPreviewScroll: false },
      { name: 'zoom-125-en', width: 820, height: 720, locale: 'en', columns: 2, deviceScaleFactor: 1.25, expectPreviewScroll: false },
      { name: 'desktop-1024-en', width: 1024, height: 900, locale: 'en', columns: 2, expectPreviewScroll: false },
      { name: 'desktop-1180-zh', width: 1180, height: 900, locale: 'zh-CN', columns: 3, expectPreviewScroll: false }
    ]) results.push(await inspect(cdp, item))
    const evidencePath = resolve(artifactDir, 'appearance-workbench-layout-evidence.json')
    await writeFile(evidencePath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2))
    console.log(`[appearance-workbench-smoke] PASS: ${results.length} responsive cases -> ${evidencePath}`)
  } finally {
    socket?.close()
    stopProcess(browser)
    stopProcess(vite)
    await delay(300)
    await rm(sourceDirectory, { recursive: true, force: true }).catch(() => undefined)
    await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
