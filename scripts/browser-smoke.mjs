import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { preview as createPreview } from 'vite'
import { startAiCapabilitiesMock } from './lib/ai-capabilities-mock.mjs'

const root = process.cwd()
const liveBaseUrl = process.env.NETRIN_SMOKE_BASE_URL?.replace(/\/?$/, '/')
const requireAmap = process.env.NETRIN_SMOKE_REQUIRE_AMAP === '1'
const requireCloudRoutes = process.env.NETRIN_SMOKE_REQUIRE_CLOUD_ROUTES === '1'
const aiUnavailableSmoke = process.env.NETRIN_SMOKE_EXPECT_AI_UNAVAILABLE === '1'
const aiCapabilitiesSmoke = process.env.NETRIN_SMOKE_AI_CAPABILITIES === '1' || (!liveBaseUrl && !aiUnavailableSmoke)
const aiConfiguredSmoke = !aiUnavailableSmoke
const skipOffRouteUiAssert = process.env.NETRIN_SMOKE_SKIP_OFF_ROUTE_UI_ASSERT === '1'
const externalAiMockUrl = process.env.NETRIN_SMOKE_AI_BASE_URL?.replace(/\/$/, '')
const artifactDir = resolve(
  process.env.NETRIN_SMOKE_ARTIFACT_DIR ?? join(tmpdir(), 'netrin-browser-smoke')
)

const routes = [
  { name: 'home', path: '', expectedText: '移步换景' },
  { name: 'discover', path: 'discover', expectedText: '选择路线' },
  { name: 'workshop', path: 'workshop', expectedText: '创意工坊' },
  { name: 'create', path: 'create', expectedText: '创作路线' },
  {
    name: 'create-ai',
    path: 'create/ai',
    expectedText: aiUnavailableSmoke
      ? 'AI 路线服务暂时不可用'
      : aiCapabilitiesSmoke
      ? '文字文件'
      : '描述你的旅程'
  },
  { name: 'auth', path: 'auth', expectedText: '手机号登录' },
  { name: 'admin-denied', path: 'admin', expectedText: '无管理员权限' },
  { name: 'appearance-studio-mobile', path: 'appearance-studio', expectedText: '作者流程' },
  { name: 'appearance-guide-mobile', path: 'appearance-studio?tab=guide', expectedText: 'Netrin 外观组 v3 作者指南' },
  {
    name: 'route-detail-missing',
    path: 'route/00000000-0000-0000-0000-000000000000',
    expectedText: '路线暂不可用'
  },
  {
    name: 'guide-missing',
    path: 'guide/00000000-0000-0000-0000-000000000000',
    expectedText: '无法开始导览'
  },
  { name: 'profile', path: 'profile', expectedText: '我的' },
  { name: 'legal', path: 'legal', expectedText: '服务、隐私与第三方说明' }
]

const appearanceScreenByPath = {
  '': 'map-navigation',
  discover: 'route-catalog',
  workshop: 'route-catalog',
  create: 'route-authoring',
  'create/ai': 'ai-route-authoring',
  profile: 'profile-community',
  'appearance-studio': 'appearance-studio',
  'route/00000000-0000-0000-0000-000000000000': 'route-detail',
  'guide/00000000-0000-0000-0000-000000000000': 'map-navigation',
  auth: 'phone-auth',
  admin: 'admin-moderation',
  legal: 'legal-document'
}

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

const delay = (milliseconds) => new Promise((resolveDelay) => {
  setTimeout(resolveDelay, milliseconds)
})

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
  let lastError

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error(`${response.status} ${response.statusText}`)
    } catch (error) {
      lastError = error
    }
    await delay(200)
  }

  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`)
}

async function waitForBodyText(cdp, expectedText, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  const expected = JSON.stringify(expectedText)

  while (Date.now() < deadline) {
    const evaluation = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `document.body.innerText.includes(${expected})`
    })
    if (evaluation.result.value === true) return true
    await delay(200)
  }

  return false
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

      const listeners = this.#listeners.get(message.method)
      listeners?.forEach((listener) => listener(message.params))
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
  if (!child || child.killed || child.exitCode !== null) return
  child.kill('SIGTERM')
}

async function main() {
  if (!liveBaseUrl && !existsSync(resolve(root, 'dist/index.html'))) {
    throw new Error('dist/index.html is missing. Run npm run build before npm run test:smoke.')
  }

  if (typeof WebSocket !== 'function') {
    throw new Error('Browser smoke tests require Node.js 22 or a runtime with global WebSocket support.')
  }

  const browserPath = browserCandidates.find((candidate) => existsSync(candidate))
  if (!browserPath) {
    throw new Error('Chrome or Edge was not found. Set CHROME_PATH to a Chromium browser executable.')
  }

  await mkdir(artifactDir, { recursive: true })
  const profileDir = await mkdtemp(join(tmpdir(), 'netrin-browser-profile-'))
  const previewLog = []
  const browserLog = []
  let previewServer
  let browser
  let aiMock
  let socket
  let cdp
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    await cdp?.send('Browser.close').catch(() => undefined)
    socket?.close()
    stopProcess(browser)
    await previewServer?.close().catch(() => undefined)
    await aiMock?.close().catch(() => undefined)
    await delay(250)
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined)
  }
  const onSignal = (code) => { void cleanup().finally(() => process.exit(code)) }
  const onSigint = () => onSignal(130)
  const onSigterm = () => onSignal(143)
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)

  try {
    if (!liveBaseUrl) {
      if (!externalAiMockUrl) aiMock = await startAiCapabilitiesMock({ delayMs: 700 })
    }
    let baseUrl = liveBaseUrl
    if (!liveBaseUrl) {
      const localAiTarget = externalAiMockUrl || aiMock?.url
      previewServer = await createPreview({
        root,
        preview: {
          host: '127.0.0.1',
          port: 0,
          strictPort: true,
          ...(localAiTarget ? {
            proxy: { '/v1/ai-route': { target: localAiTarget, changeOrigin: true } }
          } : {})
        }
      })
      const address = previewServer.httpServer.address()
      if (!address || typeof address === 'string') throw new Error('Vite preview did not expose a TCP address.')
      baseUrl = `http://127.0.0.1:${address.port}/netrin/`
    }
    await waitForPage(baseUrl)

    browser = spawn(
      browserPath,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        'about:blank'
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
    )
    browser.stderr.on('data', (chunk) => browserLog.push(String(chunk)))

    let debugPort = 0
    for (let attempt = 0; attempt < 100 && !debugPort; attempt += 1) {
      try {
        const value = await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8')
        debugPort = Number(value.split(/\r?\n/)[0])
      } catch { await delay(50) }
    }
    if (!debugPort) throw new Error('Chromium did not publish its dynamic debugging port.')
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`)
    const target = targets.find((candidate) => candidate.type === 'page')
    if (!target?.webSocketDebuggerUrl) throw new Error('Chromium did not expose a page target.')

    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolveSocket, rejectSocket) => {
      socket.addEventListener('open', resolveSocket, { once: true })
      socket.addEventListener('error', rejectSocket, { once: true })
    })

    cdp = new CdpClient(socket)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('DOM.enable')
    await cdp.send('Network.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    })

    let routeErrors = []
    let checkingAppearanceNetwork = false
    const appearanceNetworkRequests = []
    const cloudContractResponses = []
    cdp.on('Network.requestWillBeSent', (event) => {
      if (!checkingAppearanceNetwork) return
      const url = event.request?.url ?? ''
      const catalogRead = /\/rest\/v1\/appearance_catalog_public(?:\?|$)/i.test(url)
      if (!catalogRead && /(?:\/rest\/v1|\/storage\/v1|webapi\.amap|restapi\.amap|\/_AMapService)/i.test(url)) {
        appearanceNetworkRequests.push(url)
      }
    })
    cdp.on('Network.responseReceived', (event) => {
      const url = event.response?.url ?? ''
      if (/\/rest\/v1\/rpc\/routes_discovery_v1(?:\?|$)/i.test(url)) {
        cloudContractResponses.push({ kind: 'routes', requestId: event.requestId, status: event.response.status })
      } else if (/\/functions\/v1\/netrin-media(?:\?|$)/i.test(url)) {
        cloudContractResponses.push({ kind: 'media', requestId: event.requestId, status: event.response.status })
      } else if (/\/storage\/v1\/object\/sign\/route-media\//i.test(url)) {
        cloudContractResponses.push({
          kind: 'media-image',
          requestId: event.requestId,
          status: event.response.status,
          publicOrigin: new URL(url).origin === new URL(baseUrl).origin
        })
      }
    })
    cdp.on('Network.loadingFinished', (event) => {
      const response = cloudContractResponses.findLast((item) => item.requestId === event.requestId)
      if (!requireCloudRoutes || !response || response.kind === 'media-image' || response.bodyPromise) return
      response.bodyPromise = cdp
        .send('Network.getResponseBody', { requestId: response.requestId })
        .catch((error) => ({ captureError: String(error) }))
    })
    cdp.on('Runtime.exceptionThrown', (event) => {
      routeErrors.push(event.exceptionDetails?.text ?? 'Uncaught runtime exception')
    })
    cdp.on('Runtime.consoleAPICalled', (event) => {
      if (event.type !== 'error') return
      routeErrors.push(event.args.map((argument) => (
        argument.value ?? argument.description ?? argument.type
      )).join(' '))
    })

    const failures = []
    for (const route of routes) {
      routeErrors = []
      const loaded = cdp.waitFor('Page.loadEventFired')
      await cdp.send('Page.navigate', { url: `${baseUrl}${route.path}` })
      await loaded
      await delay(
        requireAmap && route.name === 'home'
          ? 4_000
          : requireCloudRoutes && route.name === 'workshop'
            ? 10_000
            : 1_500
      )
      await waitForBodyText(cdp, route.expectedText)

      const evaluation = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const frame = document.querySelector('.app-frame')?.getBoundingClientRect()
          const text = document.body.innerText.trim()
          return {
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio,
            rootChildren: document.getElementById('root')?.childElementCount ?? 0,
            bodyLength: text.length,
            text,
            title: document.title,
            lang: document.documentElement.lang,
            manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? '',
            errorOverlay: Boolean(document.querySelector('.vite-error-overlay, #webpack-dev-server-client-overlay, [data-nextjs-dialog]')),
            amapReady: Boolean(document.querySelector('.amap-netrin-map__canvas .amap-maps')),
            amapAttribution: Boolean(document.querySelector('.amap-netrin-map__canvas .amap-copyright, .amap-netrin-map__canvas .amap-logo')),
            amapStatusOverlay: Boolean(document.querySelector('.amap-netrin-map__overlay')),
            fieldFontSizes: [...document.querySelectorAll('.nfield input, .nfield textarea, .nfield select, .nsearch input')]
              .map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
            bottomNavVisible: Boolean(document.querySelector('.nnav')),
            studioWorkspaceVisible: Boolean(
              document.querySelector('.appearance-studio-workspace') &&
              getComputedStyle(document.querySelector('.appearance-studio-workspace')).display !== 'none'
            ),
            studioGuideVisible: Boolean(document.querySelector('.appearance-guide')),
            studioMobileGateVisible: Boolean(document.querySelector('.appearance-studio-mobile-gate')),
            bodyScrollWidth: document.body.scrollWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            discoverSubtitleCount: document.querySelectorAll('.discover-screen .screen-heading p').length,
            workshopSubtitleCount: document.querySelectorAll('.workshop-screen .screen-heading p').length,
            createEntrySubtitleCount: document.querySelectorAll('.create-entry .screen-heading p').length,
            profileHeading: document.querySelector('[data-appearance-state="menu"] .screen-heading h1')?.textContent.trim() ?? '',
            discoverWorkshopButton: [...document.querySelectorAll('.discover-toolbar button')]
              .some((button) => button.innerText.includes('创意工坊')),
            discoverCloudErrorVisible: document.body.innerText.includes('发现服务暂不可用'),
            recommendationControlsVisible: Boolean(document.querySelector('.workshop-route-subnav[aria-label="导览路线分类"]')),
            workshopCatalogTabsVisible: (() => {
              const tabs = document.querySelector('.workshop-catalog-tabs')
              return Boolean(tabs && tabs.innerText.includes('导览路线') && tabs.innerText.includes('外观组'))
            })(),
            routeCatalogFilterCount: document.querySelectorAll('[data-route-catalog-filters]').length,
            tagFilterCount: [...document.querySelectorAll('[data-route-catalog-filters] .nfield__label')]
              .filter((label) => label.textContent.trim() === '标签').length,
            cityFilterCount: document.querySelectorAll('.city-search-filter').length,
            createEntryCardCount: document.querySelectorAll('.create-entry__card').length,
            createEntryColumnCount: (() => {
              const grid = document.querySelector('.create-entry__grid')
              if (!grid) return 0
              return getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).filter(Boolean).length
            })(),
            homeHeaderCompassCount: document.querySelectorAll('.home__chrome-actions button[aria-label="复位北向"]').length,
            homeMapCompassCount: document.querySelectorAll('.home__map .netmap__compass').length,
            frame: frame ? { left: frame.left, right: frame.right, width: frame.width } : null
          }
        })()`
      })
      const state = evaluation.result.value
      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false
      })
      const screenshotPath = resolve(artifactDir, `${route.name}.png`)
      await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))

      const issues = []
      if (route.name === 'create-ai' && aiCapabilitiesSmoke) {
        const initialTabs = await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => {
            const tabs = [...document.querySelectorAll('[role="tab"]')]
            tabs[1]?.focus()
            return {
              count: tabs.length,
              labels: tabs.map((tab) => tab.innerText.trim()),
              focusable: document.activeElement === tabs[1],
              minHeights: tabs.map((tab) => tab.getBoundingClientRect().height),
              horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
              hasAllConstraints: ['返回起点', '必须经过', '避开', '偏好']
                .every((label) => document.body.innerText.includes(label))
            }
          })()`
        })
        await cdp.send('Runtime.evaluate', {
          expression: `document.querySelectorAll('[role="tab"]')[1]?.click()`
        })
        await delay(200)
        const fileMode = await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => ({
            hasFileInput: Boolean(document.querySelector('input[type="file"]')),
            hasTextLayerRule: document.body.innerText.includes('最多 30 页'),
            hasNoVisionClaim: !document.body.innerText.includes('视觉模型'),
            hasNoUrlInput: !document.querySelector('input[type="url"]')
          }))()`
        })
        const setSessionKey = await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          awaitPromise: true,
          expression: `(async () => {
            const provider = [...document.querySelectorAll('.nfield')]
              .find((item) => item.querySelector('.nfield__label')?.innerText === '模型服务商')
              ?.querySelector('select')?.value || 'deepseek-cn'
            const digest = await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(provider + '\\0')
            )
            const fingerprint = [...new Uint8Array(digest)]
              .map((byte) => byte.toString(16).padStart(2, '0')).join('')
            sessionStorage.setItem('netrin.ai.provider-key.' + fingerprint, 'smoke-session-key')
            return true
          })()`
        })
        await delay(200)
        const reload = cdp.waitFor('Page.loadEventFired')
        await cdp.send('Runtime.evaluate', { expression: 'location.reload()' })
        await reload
        await waitForBodyText(cdp, '模型服务商')
        await delay(2_500)
        const restoredProvider = await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          awaitPromise: true,
          expression: `(async () => {
            const provider = [...document.querySelectorAll('.nfield')]
              .find((item) => item.querySelector('.nfield__label')?.innerText === '模型服务商')
              ?.querySelector('select')
            const key = document.querySelector('.ai-route-screen input[type="password"]')
            const providerKeys = Object.keys(sessionStorage)
              .filter((name) => name.startsWith('netrin.ai.provider-key.'))
            return {
              options: provider ? [...provider.options].map((option) => option.value) : [],
              providerValue: provider?.value ?? '',
              restoredKey: key?.value ?? '',
              sessionKeyCount: providerKeys.length
            }
          })()`
        })
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const select = [...document.querySelectorAll('.nfield')]
              .find((item) => item.querySelector('.nfield__label')?.innerText === '模型服务商')
              ?.querySelector('select')
            if (!select) return
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'custom-openai')
            select.dispatchEvent(new Event('change', { bubbles: true }))
          })()`
        })
        await delay(300)
        const customPanel = await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => ({
            hasBaseUrl: Boolean(document.querySelector('input[type="url"]')),
            hasDiscovery: document.body.innerText.includes('发现模型'),
            hasManual: document.body.innerText.includes('模型 ID'),
            hasProbe: document.body.innerText.includes('测试连接与工具调用'),
            hasConfirmation: document.body.innerText.includes('我确认 Key'),
            hasPolicy: document.body.innerText.includes('仅允许公网域名')
          }))()`
        })
        if (
          initialTabs.result.value.count !== 2 ||
          !initialTabs.result.value.focusable ||
          initialTabs.result.value.minHeights.some((height) => height < 44) ||
          initialTabs.result.value.horizontalOverflow ||
          !initialTabs.result.value.hasAllConstraints ||
          !fileMode.result.value.hasFileInput ||
          !fileMode.result.value.hasTextLayerRule ||
          !fileMode.result.value.hasNoVisionClaim ||
          !fileMode.result.value.hasNoUrlInput ||
          !setSessionKey.result.value ||
          restoredProvider.result.value.restoredKey !== 'smoke-session-key' ||
          restoredProvider.result.value.sessionKeyCount !== 1 ||
          !restoredProvider.result.value.options.includes('deepseek-cn') ||
          !restoredProvider.result.value.options.includes('qwen-cn') ||
          !restoredProvider.result.value.options.includes('kimi-cn') ||
          !restoredProvider.result.value.options.includes('custom-openai') ||
          restoredProvider.result.value.options.includes('openrouter') ||
          Object.values(customPanel.result.value).some((value) => value !== true)
        ) {
          issues.push(`AI capability tabs failed: ${JSON.stringify({
            initial: initialTabs.result.value,
            file: fileMode.result.value,
            restoredProvider: restoredProvider.result.value,
            custom: customPanel.result.value
          })}`)
        } else {
          console.log('[smoke] AI route: text+file tabs, session key restore, and custom Provider panel OK')
        }
      }
      let mapPlanningState = null
      if (route.name === 'create') {
        const startPlanning = await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => {
            const button = [...document.querySelectorAll('button')]
              .find((candidate) => candidate.innerText.trim() === '开始规划')
            if (!button) return false
            button.click()
            return true
          })()`
        })
        if (!startPlanning.result.value) {
          issues.push('map planning entry button was not found')
        } else {
          await waitForBodyText(cdp, '搜索地点')
          await delay(500)
          const planningEvaluation = await cdp.send('Runtime.evaluate', {
            returnByValue: true,
            expression: `(() => {
              const search = document.querySelector('.place-search-picker input[role="combobox"]')
              const map = document.querySelector('.map-planner__map')
              const orderedPoints = [...document.querySelectorAll('.section-title')]
                .find((heading) => heading.textContent.trim() === '有序关键点')
              const searchRect = search?.getBoundingClientRect()
              const mapRect = map?.getBoundingClientRect()
              const orderedRect = orderedPoints?.getBoundingClientRect()
              const text = document.body.innerText
              return {
                appearanceState: document.querySelector('main .screen[data-appearance-state]')?.getAttribute('data-appearance-state') ?? '',
                comboboxCount: document.querySelectorAll('.place-search-picker input[role="combobox"]').length,
                comboboxControls: search?.getAttribute('aria-controls') ?? '',
                comboboxAutocomplete: search?.getAttribute('aria-autocomplete') ?? '',
                comboboxHeight: searchRect?.height ?? 0,
                hasMapPlanningHint: text.includes('搜索城市、地点或当前路线重点'),
                hasEmptyPointList: text.includes('在地图建立有序点'),
                hasRecordingStatus: Boolean(document.querySelector('.rec-status')),
                hasSnapControl: Boolean(document.querySelector('.rec-snap--gps')),
                hasFieldActions: text.includes('添加关键点') || text.includes('结束记录') || text.includes('继续记录'),
                visualOrder: Boolean(
                  searchRect &&
                  mapRect &&
                  orderedRect &&
                  searchRect.top < mapRect.top &&
                  mapRect.top < orderedRect.top
                ),
                horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
                width: window.innerWidth,
                height: window.innerHeight
              }
            })()`
          })
          mapPlanningState = planningEvaluation.result.value
          const planningScreenshot = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false
          })
          const planningScreenshotPath = resolve(artifactDir, 'create-map-planning.png')
          await writeFile(planningScreenshotPath, Buffer.from(planningScreenshot.data, 'base64'))
          console.log(`[smoke] create-map-planning: captured -> ${planningScreenshotPath}`)
        }
      }
      if (state.width !== 390 || state.height !== 844 || state.dpr !== 1) {
        issues.push(`unexpected viewport ${state.width}x${state.height}@${state.dpr}`)
      }
      if (!state.rootChildren || state.bodyLength < 20) issues.push('page has no meaningful content')
      if (!state.text.includes(route.expectedText)) issues.push(`missing text: ${route.expectedText}`)
      if (state.errorOverlay) issues.push('framework error overlay is visible')
      if (!state.frame || state.frame.left < -0.5 || state.frame.right > 390.5) {
        issues.push(`app frame overflows viewport: ${JSON.stringify(state.frame)}`)
      }
      if (state.bodyScrollWidth > 390.5 || state.documentScrollWidth > 390.5) {
        issues.push(`page-level horizontal overflow: ${JSON.stringify({ body: state.bodyScrollWidth, document: state.documentScrollWidth })}`)
      }
      if (routeErrors.length) issues.push(`runtime errors: ${routeErrors.join(' | ')}`)
      if (route.name === 'auth' && (state.fieldFontSizes.length === 0 || state.fieldFontSizes.some((size) => size < 16))) {
        issues.push(`auth fields can trigger iOS zoom: ${JSON.stringify(state.fieldFontSizes)}`)
      }
      if (
        route.name === 'discover' &&
        (
          state.discoverSubtitleCount !== 0 ||
          !state.discoverWorkshopButton ||
          state.discoverCloudErrorVisible ||
          state.recommendationControlsVisible ||
          state.cityFilterCount !== 1 ||
          state.routeCatalogFilterCount !== 1 ||
          state.tagFilterCount !== 0
        )
      ) {
        issues.push(`discover information architecture failed: ${JSON.stringify({
          subtitleCount: state.discoverSubtitleCount,
          workshopButton: state.discoverWorkshopButton,
          cloudErrorVisible: state.discoverCloudErrorVisible,
          recommendationControls: state.recommendationControlsVisible,
          cityFilters: state.cityFilterCount,
          routeCatalogFilters: state.routeCatalogFilterCount,
          tagFilters: state.tagFilterCount
        })}`)
      }
      if (
        route.name === 'workshop' &&
        (
          !state.recommendationControlsVisible ||
          !state.workshopCatalogTabsVisible ||
          state.workshopSubtitleCount !== 0 ||
          state.cityFilterCount !== 1 ||
          state.routeCatalogFilterCount !== 1 ||
          state.tagFilterCount !== 0
        )
      ) {
        issues.push(`workshop catalog controls failed: ${JSON.stringify({
          recommendationControls: state.recommendationControlsVisible,
          catalogTabs: state.workshopCatalogTabsVisible,
          subtitleCount: state.workshopSubtitleCount,
          cityFilters: state.cityFilterCount,
          routeCatalogFilters: state.routeCatalogFilterCount,
          tagFilters: state.tagFilterCount
        })}`)
      }
      if (
        route.name === 'create' &&
        (
          state.createEntryCardCount !== (aiConfiguredSmoke ? 4 : 3) ||
          state.createEntryColumnCount !== 1 ||
          state.createEntrySubtitleCount !== 0
        )
      ) {
        issues.push(`create entry layout failed: ${JSON.stringify({
          cards: state.createEntryCardCount,
          columns: state.createEntryColumnCount,
          subtitleCount: state.createEntrySubtitleCount
        })}`)
      }
      if (
        route.name === 'create' &&
        (
          !mapPlanningState ||
          mapPlanningState.width !== 390 ||
          mapPlanningState.height !== 844 ||
          mapPlanningState.appearanceState !== 'planning-idle' ||
          mapPlanningState.comboboxCount !== 1 ||
          !mapPlanningState.comboboxControls ||
          mapPlanningState.comboboxAutocomplete !== 'list' ||
          mapPlanningState.comboboxHeight < 44 ||
          !mapPlanningState.hasMapPlanningHint ||
          !mapPlanningState.hasEmptyPointList ||
          mapPlanningState.hasRecordingStatus ||
          mapPlanningState.hasSnapControl ||
          mapPlanningState.hasFieldActions ||
          !mapPlanningState.visualOrder ||
          mapPlanningState.horizontalOverflow
        )
      ) {
        issues.push(`map planning workspace failed: ${JSON.stringify(mapPlanningState)}`)
      }
      if (route.name === 'appearance-studio-mobile' && (state.bottomNavVisible || !state.studioWorkspaceVisible || state.studioMobileGateVisible)) {
        issues.push(`mobile studio single-column access failed: ${JSON.stringify({
          bottomNavVisible: state.bottomNavVisible,
          studioWorkspaceVisible: state.studioWorkspaceVisible,
          mobileGateVisible: state.studioMobileGateVisible
        })}`)
      }
      if (
        route.name === 'appearance-guide-mobile' &&
        (state.bottomNavVisible || state.studioWorkspaceVisible || !state.studioGuideVisible || state.studioMobileGateVisible)
      ) {
        issues.push(`mobile appearance guide failed: ${JSON.stringify({
          bottomNavVisible: state.bottomNavVisible,
          workspaceVisible: state.studioWorkspaceVisible,
          guideVisible: state.studioGuideVisible,
          mobileGateVisible: state.studioMobileGateVisible
        })}`)
      }
      if (route.name === 'home') {
        if (state.lang !== 'zh-CN') issues.push(`unexpected html lang: ${state.lang}`)
        if (!state.title.includes('移步换景')) issues.push(`unexpected title: ${state.title}`)
        if (!state.manifestHref.includes('manifest.zh-CN.webmanifest')) {
          issues.push(`unexpected manifest: ${state.manifestHref}`)
        }
        if (state.homeHeaderCompassCount !== 1 || state.homeMapCompassCount !== 0) {
          issues.push(`home compass placement failed: ${JSON.stringify({
            header: state.homeHeaderCompassCount,
            map: state.homeMapCompassCount
          })}`)
        }
        if (requireAmap && (!state.amapReady || !state.amapAttribution || state.amapStatusOverlay)) {
          issues.push(`AMap did not reach ready state: ${JSON.stringify({
            ready: state.amapReady,
            attribution: state.amapAttribution,
            statusOverlay: state.amapStatusOverlay
          })}`)
        }
      }
      if (route.name === 'profile' && state.profileHeading !== '我的') {
        issues.push(`unexpected profile heading: ${state.profileHeading}`)
      }

      if (issues.length) failures.push(`${route.name}: ${issues.join('; ')}`)
      else console.log(`[smoke] ${route.name}: OK -> ${screenshotPath}`)
    }

    if (requireCloudRoutes) {
      const latest = (kind) => cloudContractResponses.findLast((response) => response.kind === kind)
      const routeResponse = latest('routes')
      const mediaResponse = latest('media')
      const mediaImageResponses = cloudContractResponses.filter((response) => response.kind === 'media-image')
      let routeCount = -1
      let coverMediaCount = -1
      let signedMediaCount = -1
      let privateRawMediaStatus = -1
      if (!routeResponse || routeResponse.status !== 200) {
        failures.push(`routes_discovery_v1 browser response missing or non-200: ${routeResponse?.status ?? 'missing'}`)
      } else {
        try {
          const responseBody = await routeResponse.bodyPromise
          if (!responseBody) throw new Error('response body was not captured before navigation')
          if (responseBody.captureError) throw new Error(responseBody.captureError)
          const raw = responseBody.base64Encoded
            ? Buffer.from(responseBody.body, 'base64').toString('utf8')
            : responseBody.body
          const payload = JSON.parse(raw)
          routeCount = Array.isArray(payload) ? payload.length : -1
          if (routeCount < 1) failures.push(`routes_discovery_v1 returned ${routeCount} rows in the browser`)
          coverMediaCount = Array.isArray(payload)
            ? payload.filter((route) => typeof route?.cover_media_id === 'string' && route.cover_media_id.length > 0).length
            : -1
        } catch (error) {
          failures.push(`routes_discovery_v1 response could not be inspected: ${String(error)}`)
        }
      }
      if (coverMediaCount === 0) {
        signedMediaCount = 0
        console.log('[smoke] cloud routes: no cover_media_id declared; netrin-media request correctly omitted')
      } else if (!mediaResponse || mediaResponse.status !== 200) {
        failures.push(`netrin-media browser response missing or non-200 for ${coverMediaCount} declared cover(s): ${mediaResponse?.status ?? 'missing'}`)
      } else {
        try {
          const responseBody = await mediaResponse.bodyPromise
          if (!responseBody) throw new Error('response body was not captured before navigation')
          if (responseBody.captureError) throw new Error(responseBody.captureError)
          const raw = responseBody.base64Encoded
            ? Buffer.from(responseBody.body, 'base64').toString('utf8')
            : responseBody.body
          const payload = JSON.parse(raw)
          signedMediaCount = Array.isArray(payload?.items) ? payload.items.length : -1
          if (signedMediaCount < 1) failures.push(`netrin-media returned ${signedMediaCount} signed items in the browser`)
          const signedUrl = payload?.items?.find((item) => typeof item?.url === 'string')?.url
          if (signedMediaCount > 0 && !signedUrl) {
            failures.push('netrin-media returned items without a signed URL')
          } else if (signedUrl) {
            const rawMediaUrl = new URL(signedUrl)
            rawMediaUrl.pathname = rawMediaUrl.pathname.replace('/object/sign/', '/object/public/')
            rawMediaUrl.search = ''
            const rawResponse = await fetch(rawMediaUrl, { redirect: 'manual' })
            privateRawMediaStatus = rawResponse.status
            if (rawResponse.status >= 200 && rawResponse.status < 400) {
              failures.push(`private route-media raw URL was readable with status ${rawResponse.status}`)
            }
          }
        } catch (error) {
          failures.push(`netrin-media response could not be inspected: ${String(error)}`)
        }
      }
      if (routeCount > 0 && signedMediaCount > 0) {
        const failedMediaImages = mediaImageResponses.filter((response) => response.status !== 200 || !response.publicOrigin)
        if (mediaImageResponses.length < 1 || failedMediaImages.length > 0) {
          failures.push(`signed route images were not publicly readable: ${mediaImageResponses.length} responses, ${failedMediaImages.length} failed`)
        } else {
          console.log(`[smoke] cloud routes: ${routeCount} public routes, ${signedMediaCount} signed media items, ${mediaImageResponses.length} rendered images; private raw status ${privateRawMediaStatus}`)
        }
      }
    }

    const profileLoaded = cdp.waitFor('Page.loadEventFired')
    await cdp.send('Page.navigate', { url: `${baseUrl}profile` })
    await profileLoaded
    await delay(500)

    const openedLanguage = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.innerText.includes('语言'))
        button?.click()
        return Boolean(button)
      })()`
    })
    await delay(300)
    const selectedEnglish = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.innerText.trim() === 'English')
        button?.click()
        return Boolean(button)
      })()`
    })
    await delay(500)
    const englishMetadata = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({
        lang: document.documentElement.lang,
        title: document.title,
        manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? '',
        bodyText: document.body.innerText
      })`
    })
    const returnedToMenu = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.innerText.trim() === 'Back')
        button?.click()
        return Boolean(button)
      })()`
    })
    await delay(300)
    const englishMenu = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({
        bodyText: document.body.innerText,
        profileHeading: document.querySelector('main h1')?.textContent?.trim() ?? ''
      })`
    })
    if (!openedLanguage.result.value || !selectedEnglish.result.value) {
      failures.push('language chooser could not be operated in the browser')
    } else if (
      englishMetadata.result.value.lang !== 'en' ||
      !englishMetadata.result.value.title.includes('Netrin') ||
      !englishMetadata.result.value.manifestHref.includes('manifest.en.webmanifest') ||
      !returnedToMenu.result.value ||
      englishMenu.result.value.profileHeading !== 'My'
    ) {
      failures.push(
        `English metadata did not synchronize: ${JSON.stringify({
          ...englishMetadata.result.value,
          profileHeading: englishMenu.result.value.profileHeading
        })}`
      )
    } else {
      console.log('[smoke] language switch: OK -> html lang, title and manifest are English')
    }

    const openedAppearance = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.innerText.trim() === 'Appearance')
        button?.click()
        return Boolean(button)
      })()`
    })
    await delay(500)
    const appearanceState = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const headings = [...document.querySelectorAll('.profile-settings-group h2')]
        const mapStyle = headings.find((item) => item.innerText.trim() === 'Map style')
        const appearanceSet = headings.find((item) => item.innerText.trim() === 'Appearance set')
        const text = document.body.innerText
        const mapStyleButtons = [...(mapStyle?.parentElement?.querySelectorAll('.profile-option-grid .nbtn') ?? [])]
        return {
          bodyScrollWidth: document.body.scrollWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          mapStyleTop: mapStyle?.getBoundingClientRect().top ?? -1,
          appearanceSetTop: appearanceSet?.getBoundingClientRect().top ?? -1,
          mapStyleButtonCount: mapStyleButtons.length,
          removedMapStylesVisible: ['Distant Mountain', 'Graffiti', 'Indigo Blue', 'Wine']
            .some((label) => mapStyleButtons.some((button) => button.innerText.trim() === label)),
          hasOnlySelectors: !document.querySelector('.appearance-dropzone, .appearance-preview-shadow, .appearance-audit') &&
            !text.includes('Submit selected skin') && !text.includes('Approved appearance sets'),
          text
        }
      })()`
    })
    const appearanceScreenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    })
    const appearanceScreenshotPath = resolve(artifactDir, 'appearance-settings.png')
    await writeFile(appearanceScreenshotPath, Buffer.from(appearanceScreenshot.data, 'base64'))
    if (!openedAppearance.result.value) {
      failures.push('Appearance settings could not be opened from Profile')
    } else if (
      appearanceState.result.value.bodyScrollWidth > 390 ||
      appearanceState.result.value.documentScrollWidth > 390 ||
      appearanceState.result.value.mapStyleTop < 0 ||
      appearanceState.result.value.appearanceSetTop <= appearanceState.result.value.mapStyleTop ||
      appearanceState.result.value.mapStyleButtonCount !== 7 ||
      appearanceState.result.value.removedMapStylesVisible ||
      !appearanceState.result.value.hasOnlySelectors
    ) {
      failures.push(`Appearance settings contract failed: ${JSON.stringify(appearanceState.result.value)}`)
    } else {
      console.log(`[smoke] appearance settings: map style first, appearance set second -> ${appearanceScreenshotPath}`)
    }

    const openedStatement = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const back = [...document.querySelectorAll('button')].find((item) => item.innerText.trim() === 'Back')
        back?.click()
        return Boolean(back)
      })()`
    })
    await delay(250)
    const selectedStatement = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.innerText.trim() === 'Statement')
        button?.click()
        return Boolean(button)
      })()`
    })
    await delay(300)
    const statementMenu = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => ({
        title: document.querySelector('.screen-heading h1')?.innerText.trim() ?? '',
        subtitleCount: document.querySelectorAll('.screen-heading > p').length,
        buttons: [...document.querySelectorAll('[data-appearance-slot="statement-menu"] button')]
          .map((item) => item.innerText.trim()),
        hasDetail: Boolean(document.querySelector('[data-appearance-slot="statement-detail"]')),
        hasReadmeLabel: document.body.innerText.includes('README')
      }))()`
    })
    const openedProjectStatement = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const button = [...document.querySelectorAll('[data-appearance-slot="statement-menu"] button')]
          .find((item) => item.innerText.trim() === 'Project statement')
        button?.click()
        return Boolean(button)
      })()`
    })
    await delay(300)
    const statementDetail = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => ({
        title: document.querySelector('.screen-heading h1')?.innerText.trim() ?? '',
        body: document.querySelector('[data-appearance-slot="statement-detail"]')?.innerText.trim() ?? '',
        hasMenu: Boolean(document.querySelector('[data-appearance-slot="statement-menu"]')),
        subtitleCount: document.querySelectorAll('.screen-heading > p').length
      }))()`
    })
    const returnedToStatementMenu = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const back = [...document.querySelectorAll('button')].find((item) => item.innerText.trim() === 'Back')
        back?.click()
        return Boolean(back)
      })()`
    })
    await delay(250)
    const statementReturnState = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => ({
        title: document.querySelector('.screen-heading h1')?.innerText.trim() ?? '',
        hasMenu: Boolean(document.querySelector('[data-appearance-slot="statement-menu"]')),
        hasDetail: Boolean(document.querySelector('[data-appearance-slot="statement-detail"]'))
      }))()`
    })
    const expectedStatementItems = [
      'Project statement',
      'Map and location sources',
      'Route and content sources',
      'Appearance authoring and submission',
      'Privacy and accounts',
      'Rules and updates'
    ]
    if (
      !openedStatement.result.value ||
      !selectedStatement.result.value ||
      statementMenu.result.value.title !== 'Statement' ||
      statementMenu.result.value.subtitleCount !== 0 ||
      statementMenu.result.value.hasDetail ||
      statementMenu.result.value.hasReadmeLabel ||
      statementMenu.result.value.buttons.length !== expectedStatementItems.length ||
      !expectedStatementItems.every((heading) => statementMenu.result.value.buttons.includes(heading)) ||
      !openedProjectStatement.result.value ||
      statementDetail.result.value.title !== 'Project statement' ||
      statementDetail.result.value.subtitleCount !== 0 ||
      statementDetail.result.value.hasMenu ||
      !statementDetail.result.value.body.includes('Netrin is a nationwide') ||
      !returnedToStatementMenu.result.value ||
      statementReturnState.result.value.title !== 'Statement' ||
      !statementReturnState.result.value.hasMenu ||
      statementReturnState.result.value.hasDetail
    ) {
      failures.push(`Profile statement secondary navigation failed: ${JSON.stringify({
        menu: statementMenu.result.value,
        detail: statementDetail.result.value,
        returned: statementReturnState.result.value
      })}`)
    } else {
      console.log('[smoke] profile statement: secondary menu, single detail, clean headers, and nested Back behavior OK')
    }

    // --- W2-E fixtures: local IndexedDB only (no production test hooks) ---
    // Campus path sample near public/data/campus-paths.json first segment.
    const smokeLng = 119.696217
    const smokeLat = 30.291061
    const smokeRouteId = 'smoke-offline-route-w2e'
    const smokeDraftId = 'draft-smoke-field-w2e'
    const smokeGeometry = {
      type: 'LineString',
      coordinates: [
        [smokeLng, smokeLat],
        [119.695549, 30.28957],
        [119.694551, 30.287383]
      ]
    }
    const smokeStops = [
      {
        id: 'smoke-stop-a',
        order: 1,
        location: [smokeLng, smokeLat],
        title: { 'zh-CN': '烟雾起点', en: 'Smoke start' },
        description: { 'zh-CN': '', en: '' },
        media: []
      },
      {
        id: 'smoke-stop-b',
        order: 2,
        location: [119.694551, 30.287383],
        title: { 'zh-CN': '烟雾终点', en: 'Smoke end' },
        description: { 'zh-CN': '', en: '' },
        media: []
      }
    ]
    const smokeDownload = {
      id: smokeRouteId,
      title: { 'zh-CN': '烟雾离线包路线', en: 'Smoke offline package route' },
      description: { 'zh-CN': '本地 fixture', en: 'Local fixture' },
      author: 'smoke',
      downloads: 0,
      travelMode: 'walking',
      geometry: smokeGeometry,
      geometrySource: 'field-recorded',
      distanceM: 420,
      durationS: 360,
      stops: smokeStops,
      downloadedAt: new Date().toISOString(),
      offlinePackage: {
        version: 1,
        packagedAt: new Date().toISOString(),
        mediaSelection: { selectedMediaIds: [] },
        geometryTextBytes: 2048,
        knownImageBytes: 0,
        unknownImageCount: 0
      }
    }
    const smokeDraft = {
      version: 4,
      id: smokeDraftId,
      authoringMode: 'field',
      title: '烟雾现场草稿',
      note: '',
      points: [
        {
          id: 'smoke-point-1',
          index: 1,
          raw: [smokeLng + 0.00012, smokeLat + 0.00008],
          final: [smokeLng, smokeLat],
          accuracy: 8,
          snapped: true,
          text: '已吸附点',
          media: []
        }
      ],
      snapToRoads: true,
      travelMode: 'walking',
      geometryStatus: 'missing',
      syncState: 'local',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    async function idbPut(dbName, storeName, key, value) {
      const result = await cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `(() => new Promise((resolve) => {
          const open = indexedDB.open(${JSON.stringify(dbName)});
          open.onerror = () => resolve({ ok: false, error: String(open.error || 'open-failed') });
          open.onupgradeneeded = () => {
            const db = open.result;
            if (![...db.objectStoreNames].includes(${JSON.stringify(storeName)})) {
              db.createObjectStore(${JSON.stringify(storeName)});
            }
          };
          open.onsuccess = () => {
            try {
              const db = open.result;
              if (![...db.objectStoreNames].includes(${JSON.stringify(storeName)})) {
                resolve({ ok: false, error: 'missing-store:' + [...db.objectStoreNames].join(',') });
                db.close();
                return;
              }
              const tx = db.transaction(${JSON.stringify(storeName)}, 'readwrite');
              tx.objectStore(${JSON.stringify(storeName)}).put(${JSON.stringify(value)}, ${JSON.stringify(key)});
              tx.oncomplete = () => { db.close(); resolve({ ok: true }); };
              tx.onerror = () => { db.close(); resolve({ ok: false, error: String(tx.error || 'tx-failed') }); };
            } catch (error) {
              resolve({ ok: false, error: String(error) });
            }
          };
        }))()`
      })
      return result.result.value
    }

    // Ensure default localforage DB exists by loading the app origin first.
    await cdp.send('Page.navigate', { url: baseUrl })
    await delay(1200)

    const downloadSeed = await idbPut('localforage', 'keyvaluepairs', 'netrin.downloaded.v3', [smokeDownload])
    const activeSeed = await idbPut('localforage', 'keyvaluepairs', 'netrin.activeRouteSelection', smokeRouteId)
    const draftSeed = await idbPut('netrin', 'drafts', 'routeDrafts', [smokeDraft])
    if (!downloadSeed?.ok || !activeSeed?.ok || !draftSeed?.ok) {
      failures.push(`W2-E IndexedDB fixture seed failed: ${JSON.stringify({ downloadSeed, activeSeed, draftSeed })}`)
    } else {
      // Hard reload so NetrinState hydrates fixtures.
      const reloaded = cdp.waitFor('Page.loadEventFired')
      await cdp.send('Page.navigate', { url: baseUrl })
      await reloaded
      await delay(1500)

      // Discover: route selection is independent from opening the route detail.
      routeErrors = []
      const discoverLoaded = cdp.waitFor('Page.loadEventFired')
      await cdp.send('Page.navigate', { url: `${baseUrl}discover` })
      await discoverLoaded
      await delay(1200)
      const discoverSelectionState = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const card = document.querySelector('[data-route-id="${smokeRouteId}"]')
          const selectButton = card?.querySelector('.nroute__foot button')
          const initialLabel = selectButton?.innerText.trim() ?? ''
          selectButton?.click()
          return {
            found: Boolean(card && selectButton),
            initialLabel,
            urlAfterSelection: location.pathname
          }
        })()`
      })
      await delay(300)
      const discoverAfterToggle = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const card = document.querySelector('[data-route-id="${smokeRouteId}"]')
          const selectButton = card?.querySelector('.nroute__foot button')
          const toggledLabel = selectButton?.innerText.trim() ?? ''
          const urlBeforeOpen = location.pathname
          selectButton?.click()
          return {
            toggledLabel,
            urlBeforeOpen
          }
        })()`
      })
      await delay(300)
      await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          document.querySelector('[data-route-id="${smokeRouteId}"] .nroute__open')?.click()
          return true
        })()`
      })
      await delay(700)
      const discoverAfterOpen = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `location.pathname`
      })
      if (
        !discoverSelectionState.result.value.found ||
        !/取消选择|Cancel selection/.test(discoverSelectionState.result.value.initialLabel) ||
        !/选择路线|Select route/.test(discoverAfterToggle.result.value.toggledLabel) ||
        !discoverSelectionState.result.value.urlAfterSelection.endsWith('/discover') ||
        !discoverAfterToggle.result.value.urlBeforeOpen.endsWith('/discover') ||
        !discoverAfterOpen.result.value.endsWith(`/route/${smokeRouteId}`) ||
        routeErrors.length
      ) {
        failures.push(`W2-E discover selection/open behavior failed: ${JSON.stringify({
          initial: discoverSelectionState.result.value,
          toggled: discoverAfterToggle.result.value,
          openPath: discoverAfterOpen.result.value,
          routeErrors
        })}`)
      } else {
        console.log('[smoke] W2-E discover: select/cancel stays in place and card body opens detail')
      }

      // Route detail: four equal tiles, readable highlights, and no package diagnostics.
      routeErrors = []
      await delay(1200)
      const routeDetailState = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const text = document.body.innerText
          const frame = document.querySelector('.app-frame')?.getBoundingClientRect()
          const stats = [...document.querySelectorAll('.route-detail__stats > span, .route-detail__stats > button')]
          const rects = stats.map((item) => {
            const rect = item.getBoundingClientRect()
            return { width: rect.width, height: rect.height }
          })
          const description = document.querySelector('.route-detail__highlight small')
          const descriptionStyle = description ? getComputedStyle(description) : null
          return {
            statsCount: stats.length,
            statLabels: stats.map((item) => item.innerText.trim()),
            equalWidths: rects.length === 4 && rects.every((rect) => Math.abs(rect.width - rects[0].width) < 1),
            equalHeights: rects.length === 4 && rects.every((rect) => Math.abs(rect.height - rects[0].height) < 1),
            shareIsFourth: stats[3]?.tagName === 'BUTTON' && /分享|Share/.test(stats[3]?.innerText ?? ''),
            hasRemovedPackageCopy: [
              '离线路线包',
              'Offline route package',
              '高德底图',
              'AMap basemap',
              '几何与文字',
              'Geometry and text',
              '作者授权图片',
              'Author-authorized photos',
              '本机图片预算',
              'On-device photo budget',
              '作者未授权图片离线缓存'
            ].some((copy) => text.includes(copy)),
            descriptionVisible: Boolean(description && descriptionStyle && descriptionStyle.display !== 'none' && descriptionStyle.visibility !== 'hidden'),
            descriptionColor: descriptionStyle?.color ?? '',
            bodyScrollWidth: document.body.scrollWidth,
            frameRight: frame?.right ?? -1,
            overflow: Boolean(frame && frame.right > 390.5)
          }
        })()`
      })
      const routeDetailShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      await writeFile(resolve(artifactDir, 'w2e-route-detail.png'), Buffer.from(routeDetailShot.data, 'base64'))
      if (
        routeDetailState.result.value.statsCount !== 4 ||
        !routeDetailState.result.value.equalWidths ||
        !routeDetailState.result.value.equalHeights ||
        !routeDetailState.result.value.shareIsFourth ||
        routeDetailState.result.value.hasRemovedPackageCopy ||
        !routeDetailState.result.value.descriptionVisible ||
        routeDetailState.result.value.descriptionColor === 'rgb(35, 39, 44)' ||
        routeDetailState.result.value.overflow ||
        routeErrors.length
      ) {
        failures.push(`W2-E route detail presentation failed: ${JSON.stringify({
          state: routeDetailState.result.value,
          routeErrors
        })}`)
      } else {
        console.log('[smoke] W2-E route detail: four equal tiles, readable highlights, and simplified offline actions')
      }

      // Profile → offline drafts: R4 keeps geometry/text only and exposes no photo-cache controls.
      routeErrors = []
      const profileReload = cdp.waitFor('Page.loadEventFired')
      await cdp.send('Page.navigate', { url: `${baseUrl}profile` })
      await profileReload
      await delay(900)
      const profileMenuCopy = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `document.body.innerText`
      })
      if (
        profileMenuCopy.result.value.includes('登录后可投稿并查看审核进度') ||
        profileMenuCopy.result.value.includes('Sign in to submit routes and track review progress')
      ) {
        failures.push('W2-E profile still shows the removed guest account hint')
      }
      const openedOffline = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const button = [...document.querySelectorAll('button')]
            .find((item) => {
              const text = item.innerText.trim()
              return text === 'Offline drafts' || text === '离线草稿' || text.includes('Offline') || text.includes('离线')
            })
          button?.click()
          return Boolean(button)
        })()`
      })
      await delay(500)
      const clearMediaState = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const text = document.body.innerText
          const clearBtn = [...document.querySelectorAll('button')]
            .find((item) => item.innerText.includes('清理缓存') || item.innerText.includes('Clear cache'))
          return {
            hasOfflineMediaLabel: text.includes('离线图片缓存') || text.includes('Offline photo cache'),
            hasClearEntry: Boolean(clearBtn),
            clearDisabled: clearBtn ? clearBtn.disabled : null,
            bodyScrollWidth: document.body.scrollWidth
          }
        })()`
      })
      if (
        !openedOffline.result.value ||
        clearMediaState.result.value.hasOfflineMediaLabel ||
        clearMediaState.result.value.hasClearEntry ||
        clearMediaState.result.value.bodyScrollWidth > 390 ||
        routeErrors.length
      ) {
        failures.push(`W2-E profile geometry-text-only offline contract failed: ${JSON.stringify({
          openedOffline: openedOffline.result.value,
          state: clearMediaState.result.value,
          routeErrors
        })}`)
      } else {
        console.log('[smoke] W2-E profile: no offline photo-cache controls')
      }

      // Field draft: open editor, use original GPS, save.
      routeErrors = []
      const createLoaded = cdp.waitFor('Page.loadEventFired')
      await cdp.send('Page.navigate', { url: `${baseUrl}create/${smokeDraftId}` })
      await createLoaded
      await delay(1600)
      const createMetadataState = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const meta = document.querySelector('.record-meta')
          const fields = [...(meta?.querySelectorAll('.nfield') || [])]
          const labels = fields.map((field) => field.querySelector('.nfield__label')?.textContent?.trim() || '')
          const noteField = fields.find((field) => /现场备注|Point note/.test(field.querySelector('.nfield__label')?.textContent || ''))
          const note = noteField?.querySelector('textarea')
          return {
            labels,
            noteHeight: note ? note.getBoundingClientRect().height : 0,
            hasCityFields: labels.some((label) => /城市名称|城市行政区码|City name|City adcode/.test(label)),
            hasOfflineSwitch: /允许离线保存图片|Allow offline photos/.test(meta?.textContent || ''),
            mapReady: !document.querySelector('.amap-netrin-map__overlay'),
            hasSquareStop: Boolean(document.querySelector('.netmap-stop__badge')),
            overflow: document.documentElement.scrollWidth > window.innerWidth
          }
        })()`
      })
      if (
        Math.abs(createMetadataState.result.value.noteHeight - 68) > 0.6 ||
        createMetadataState.result.value.hasCityFields ||
        createMetadataState.result.value.hasOfflineSwitch ||
        (createMetadataState.result.value.mapReady && !createMetadataState.result.value.hasSquareStop) ||
        createMetadataState.result.value.overflow
      ) {
        failures.push(`Create shared metadata simplification failed: ${JSON.stringify(createMetadataState.result.value)}`)
      } else {
        console.log('[smoke] create metadata: 68px note, automatic city, no offline-photo switch; square stops checked when AMap is ready')
      }
      const openedEdit = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const edit = document.querySelector('button[aria-label*="编辑关键点"], button[aria-label*="Edit point"]')
            || [...document.querySelectorAll('button')].find((item) => /编辑关键点|Edit point/.test(item.getAttribute('aria-label') || ''))
          edit?.click()
          return Boolean(edit)
        })()`
      })
      await delay(500)
      const usedRaw = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const button = document.querySelector('[data-testid="use-raw-gps"]')
          button?.click()
          return {
            present: Boolean(button),
            text: button?.innerText.trim() || '',
            after: document.body.innerText.includes('保留原始位置') || document.body.innerText.includes('Using raw location') || document.body.innerText.includes('原始')
          }
        })()`
      })
      await delay(300)
      const savedPoint = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const save = [...document.querySelectorAll('button')]
            .find((item) => item.innerText.includes('保存关键点') || item.innerText.includes('Save key point'))
          save?.click()
          return Boolean(save)
        })()`
      })
      await delay(700)
      const afterSave = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => ({
          composerGone: !document.querySelector('[data-testid="use-raw-gps"]'),
          hasPoint: document.body.innerText.includes('烟雾') || document.body.innerText.includes('已吸附') || document.body.innerText.includes('关键点'),
          bodyScrollWidth: document.body.scrollWidth,
          overflow: document.body.scrollWidth > 390
        }))()`
      })
      const createShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      await writeFile(resolve(artifactDir, 'w2e-use-raw-gps.png'), Buffer.from(createShot.data, 'base64'))
      if (
        !openedEdit.result.value ||
        !usedRaw.result.value.present ||
        !savedPoint.result.value ||
        afterSave.result.value.overflow ||
        routeErrors.length
      ) {
        failures.push(`W2-E field raw-GPS correction failed: ${JSON.stringify({
          openedEdit: openedEdit.result.value,
          usedRaw: usedRaw.result.value,
          savedPoint: savedPoint.result.value,
          afterSave: afterSave.result.value,
          routeErrors
        })}`)
      } else {
        console.log('[smoke] W2-E field: use original GPS + save OK')
      }

      // Guidance false-positive: seed near stop A → start guide → leave atStop via Next →
      // push 3+ far CDP/geolocation fixes while following the stored leg → hard assert UI.
      routeErrors = []
      await cdp.send('Browser.grantPermissions', {
        origin: new URL(baseUrl).origin,
        permissions: ['geolocation']
      }).catch(() => {})

      const homeLoaded = cdp.waitFor('Page.loadEventFired')
      await cdp.send('Page.navigate', { url: baseUrl })
      await homeLoaded
      await delay(1500)

      // Smoke-only page geolocation bridge (not an app production hook): ensure watchPosition
      // receives successive fixes under headless Chromium where Emulation alone can be sticky.
      await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const listeners = new Set()
          let current = { latitude: ${smokeLat}, longitude: ${smokeLng}, accuracy: 8 }
          const makePos = () => ({
            coords: {
              latitude: current.latitude,
              longitude: current.longitude,
              accuracy: current.accuracy,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null
            },
            timestamp: Date.now()
          })
          navigator.geolocation.getCurrentPosition = (success, error) => {
            try { success(makePos()) } catch (err) { error?.(err) }
          }
          navigator.geolocation.watchPosition = (success) => {
            listeners.add(success)
            try { success(makePos()) } catch {}
            return listeners.size
          }
          navigator.geolocation.clearWatch = () => {}
          window.__netrinSmokePushGeo = (latitude, longitude, accuracy = 8) => {
            current = { latitude, longitude, accuracy }
            const pos = makePos()
            listeners.forEach((fn) => { try { fn(pos) } catch {} })
            return listeners.size
          }
          return true
        })()`
      })
      await cdp.send('Emulation.setGeolocationOverride', {
        latitude: smokeLat,
        longitude: smokeLng,
        accuracy: 8
      })
      await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `window.__netrinSmokePushGeo(${smokeLat}, ${smokeLng}, 8)`
      })
      await delay(400)

      const beganGuide = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const button = [...document.querySelectorAll('button')]
            .find((item) => item.innerText.includes('开始导览') || item.innerText.includes('Start guide'))
          button?.click()
          return Boolean(button)
        })()`
      })
      if (!beganGuide.result.value) {
        failures.push('W2-E guide: Start guide button not found')
      }
      await delay(1800)

      // atStop hides the next control until the sheet is expanded (show all key points).
      const expandedSheet = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const expand = [...document.querySelectorAll('button')].find((item) => {
            const label = (item.getAttribute('aria-label') || item.innerText || '').trim()
            return (
              label.includes('Show all key points') ||
              label.includes('展开全部关键点') ||
              label.includes('Hide all key points') ||
              label.includes('收起全部关键点')
            )
          })
          // Only click when collapsed (Show…); if already Hide… leave expanded.
          if (expand) {
            const label = (expand.getAttribute('aria-label') || expand.innerText || '').trim()
            if (label.includes('Show') || label.includes('展开')) expand.click()
          }
          return {
            found: Boolean(expand),
            label: expand ? (expand.getAttribute('aria-label') || expand.innerText || '').trim() : ''
          }
        })()`
      })
      await delay(600)

      // Near stop A lands in atStop; advance to following the next leg.
      const advancedFromStop = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const next = [...document.querySelectorAll('button')]
            .find((item) => {
              const text = item.innerText.trim()
              return (
                text.includes('Next key point') ||
                text.includes('前往下一个关键点') ||
                text.includes('Finish guide') ||
                text.includes('完成导览')
              )
            })
          next?.click()
          return {
            clicked: Boolean(next),
            label: next?.innerText.trim() || '',
            navigating: Boolean(document.querySelector('.home--navigating')),
            expanded: ${JSON.stringify(expandedSheet.result.value)},
            body: document.body.innerText.slice(0, 500)
          }
        })()`
      })
      if (!advancedFromStop.result.value.clicked) {
        failures.push(`W2-E guide: could not leave atStop via next key point: ${JSON.stringify(advancedFromStop.result.value)}`)
      }
      await delay(1200)

      // Wait until path planning is ready or stored geometry is active (no loading spinner text).
      const planReadyDeadline = Date.now() + 8_000
      let planReady = false
      while (Date.now() < planReadyDeadline) {
        const planState = await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => {
            const text = document.body.innerText
            const loading = text.includes('规划中') || text.includes('Planning') || text.includes('route planning')
            const error = text.includes('路线暂不可用') || text.includes('AMap route unavailable')
            return { loading, error, navigating: Boolean(document.querySelector('.home--navigating')) }
          })()`
        })
        if (planState.result.value.navigating && !planState.result.value.loading) {
          planReady = true
          break
        }
        await delay(250)
      }
      if (!planReady) {
        failures.push(`W2-E guide: navigation plan never became ready after next-stop: ${JSON.stringify(advancedFromStop.result.value)}`)
      }

      // ~5 km north-east of the short smoke leg — well beyond OFF_ROUTE_THRESHOLD.
      const farLat = smokeLat + 0.05
      const farLng = smokeLng + 0.05
      const farFixes = [
        { latitude: farLat, longitude: farLng, accuracy: 8 },
        { latitude: farLat + 0.0003, longitude: farLng + 0.0003, accuracy: 8 },
        { latitude: farLat + 0.0006, longitude: farLng + 0.0006, accuracy: 8 },
        { latitude: farLat + 0.0009, longitude: farLng + 0.0009, accuracy: 8 },
        { latitude: farLat + 0.0012, longitude: farLng + 0.0012, accuracy: 8 }
      ]
      for (const fix of farFixes) {
        await cdp.send('Emulation.setGeolocationOverride', fix)
        await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `window.__netrinSmokePushGeo(${fix.latitude}, ${fix.longitude}, ${fix.accuracy})`
        })
        await delay(700)
      }

      const offRouteDeadline = Date.now() + 10_000
      let offRouteUi = { buttonPresent: false, hasLabel: false, buttonText: '' }
      while (Date.now() < offRouteDeadline) {
        const probe = await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => {
            const button = document.querySelector('[data-testid="off-route-false-positive"]')
            const text = document.body.innerText
            return {
              buttonPresent: Boolean(button),
              hasLabel: text.includes('已偏离路线') || text.includes('Off route') || text.includes('You are off the route'),
              buttonText: button?.innerText.trim() || '',
              body: text.slice(0, 600)
            }
          })()`
        })
        offRouteUi = probe.result.value
        if (offRouteUi.buttonPresent) break
        await delay(300)
      }

      if (!offRouteUi.buttonPresent) {
        const details = JSON.stringify({
          offRouteUi,
          beganGuide: beganGuide.result.value,
          advancedFromStop: advancedFromStop.result.value
        })
        if (skipOffRouteUiAssert) {
          console.log(`[smoke] W2-E guide: synthetic off-route UI assertion skipped for live deployment smoke -> ${details}`)
        } else {
          failures.push(`W2-E guide: off-route false-positive button never appeared: ${details}`)
        }
      } else {
        await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => { document.querySelector('[data-testid="off-route-false-positive"]')?.click(); return true })()`
        })
        await delay(800)
        const recovered = await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => ({
            buttonGone: !document.querySelector('[data-testid="off-route-false-positive"]'),
            stillOffRoute:
              document.body.innerText.includes('已偏离路线') ||
              document.body.innerText.includes('You are off the route') ||
              document.body.innerText.includes('路线已偏离'),
            bodyScrollWidth: document.body.scrollWidth,
            documentScrollWidth: document.documentElement.scrollWidth
          }))()`
        })
        if (
          !recovered.result.value.buttonGone ||
          recovered.result.value.stillOffRoute ||
          recovered.result.value.bodyScrollWidth > 390 ||
          recovered.result.value.documentScrollWidth > 390
        ) {
          failures.push(`W2-E guide: false-positive did not restore following cleanly: ${JSON.stringify(recovered.result.value)}`)
        } else {
          console.log('[smoke] W2-E guide: false-positive restores following')
        }
      }

      const guideShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      await writeFile(resolve(artifactDir, 'w2e-off-route-false-positive.png'), Buffer.from(guideShot.data, 'base64'))
      if (routeErrors.length) {
        failures.push(`W2-E guide runtime errors: ${routeErrors.join(' | ')}`)
      }
    }

    // Restore English before desktop studio checks (earlier profile flow leaves English).
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    })
    const restoreLangLoaded = cdp.waitFor('Page.loadEventFired')
    await cdp.send('Page.navigate', { url: `${baseUrl}profile` })
    await restoreLangLoaded
    await delay(600)
    await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const language = [...document.querySelectorAll('button')]
          .find((item) => item.innerText.includes('Language') || item.innerText.includes('语言'))
        language?.click()
        return Boolean(language)
      })()`
    })
    await delay(250)
    await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const english = [...document.querySelectorAll('button')]
          .find((item) => item.innerText.trim() === 'English')
        english?.click()
        return Boolean(english)
      })()`
    })
    await delay(400)

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    })
    const studioLoaded = cdp.waitFor('Page.loadEventFired')
    await cdp.send('Page.navigate', { url: `${baseUrl}appearance-studio` })
    await studioLoaded
    await delay(900)
    const studioState = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const appFrame = document.querySelector('.app-frame')
        const appContent = document.querySelector('.app-content--appearance-studio')
        const workspace = document.querySelector('.appearance-studio-workspace')
        const host = document.querySelector('.appearance-preview-shadow')
        const previewFrame = host?.shadowRoot?.querySelector('.app-frame')
        const attribution = host?.shadowRoot?.querySelector('.amap-copyright')
        const attributionStyle = attribution ? getComputedStyle(attribution) : null
        const columns = workspace ? [...workspace.children].map((column) => column.getBoundingClientRect()) : []
        const requiredHooks = [
          'app-shell', 'top-bar', 'bottom-navigation', 'button', 'icon-button', 'text-field', 'switch',
          'route-card', 'route-point-card', 'media-gallery', 'map-frame', 'map-controls', 'recorder-panel',
          'route-plan-confirmation', 'navigation-instruction', 'sheet', 'dialog', 'toast', 'loading-state', 'empty-state', 'error-state'
        ]
        return {
          appFrameWidth: appFrame?.getBoundingClientRect().width ?? 0,
          workspaceScrollable: Boolean(appContent && appContent.scrollHeight > appContent.clientHeight),
          workspaceDisplay: workspace ? getComputedStyle(workspace).display : '',
          bottomNavVisible: Boolean(document.querySelector('.nnav')),
          previewWidth: previewFrame?.getBoundingClientRect().width ?? 0,
          previewScreenCount: host?.shadowRoot?.querySelectorAll('.preview-screen-picker button').length ?? 0,
          previewHooksComplete: requiredHooks.every((hook) => host?.shadowRoot?.querySelector('[data-appearance-hook="' + hook + '"]')),
          brandFixtureCount: host?.shadowRoot?.querySelectorAll('[data-brand-slot-fixture]').length ?? 0,
          attributionVisible: Boolean(attribution && attributionStyle && attributionStyle.display !== 'none' && attributionStyle.visibility !== 'hidden'),
          pageHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth,
          columnOverlap: columns.some((left, index) => columns.slice(index + 1).some((right) => (
            Math.min(left.right, right.right) - Math.max(left.left, right.left) > 0.5 &&
            Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 0.5
          ))),
          title: document.title,
          text: document.body.innerText
        }
      })()`
    })
    const studioScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const studioScreenshotPath = resolve(artifactDir, 'appearance-studio-desktop.png')
    await writeFile(studioScreenshotPath, Buffer.from(studioScreenshot.data, 'base64'))
    if (
      studioState.result.value.appFrameWidth < 1000 ||
      studioState.result.value.appFrameWidth > 1280 ||
      studioState.result.value.workspaceDisplay !== 'grid' ||
      !studioState.result.value.workspaceScrollable ||
      studioState.result.value.bottomNavVisible ||
      studioState.result.value.previewWidth !== 390 ||
      studioState.result.value.previewScreenCount !== 10 ||
      !studioState.result.value.previewHooksComplete ||
      studioState.result.value.brandFixtureCount !== 4 ||
      !studioState.result.value.attributionVisible ||
      studioState.result.value.pageHorizontalOverflow ||
      studioState.result.value.columnOverlap ||
      !studioState.result.value.title.includes('Appearance Studio') ||
      !studioState.result.value.text.includes('Author workflow')
    ) {
      failures.push(`Appearance Studio desktop contract failed: ${JSON.stringify(studioState.result.value)}`)
    } else {
      console.log(`[smoke] appearance studio desktop: OK -> ${studioScreenshotPath}`)
    }

    const openedGuide = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.innerText.trim() === 'Developer guide')
        button?.click()
        return Boolean(button)
      })()`
    })
    await delay(500)
    const guideState = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const guide = document.querySelector('.appearance-guide')
        const text = guide?.innerText ?? ''
        const downloads = [...(guide?.querySelectorAll('a[download]') ?? [])]
        return {
          href: location.href,
          visible: Boolean(guide),
          bottomNavVisible: Boolean(document.querySelector('.nnav')),
          hasSections: ['Quick start', 'Package structure', 'Appearance Manifest', 'Three-layer tokens', 'CSS hooks', 'Resource and safety limits', 'Packaging, validation, and route review', 'submission and review', 'Contract downloads']
            .every((heading) => text.includes(heading)),
          downloadCount: downloads.length,
          hasHistoricalExample: downloads.some((link) => link.getAttribute('download')?.endsWith('.netrin-appearance')),
          hasOldFlow: text.includes('Appearance Lab')
        }
      })()`
    })
    if (
      !openedGuide.result.value ||
      !guideState.result.value.visible ||
      !guideState.result.value.href.includes('tab=guide') ||
      guideState.result.value.bottomNavVisible ||
      !guideState.result.value.hasSections ||
      guideState.result.value.downloadCount < 4 ||
      guideState.result.value.hasHistoricalExample ||
      guideState.result.value.hasOldFlow
    ) {
      failures.push(`public appearance guide failed: ${JSON.stringify(guideState.result.value)}`)
    } else {
      console.log('[smoke] appearance guide: guest-readable, URL-synced, complete, and downloadable')
    }

    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.innerText.trim() === 'Workbench')
        button?.click()
      })()`
    })
    await delay(500)

    const appearanceTestFile = process.env.NETRIN_APPEARANCE_TEST_FILE
    if (appearanceTestFile) {
      const resolvedAppearanceFile = resolve(appearanceTestFile)
      if (!existsSync(resolvedAppearanceFile)) {
        failures.push(`appearance test file is missing: ${resolvedAppearanceFile}`)
      } else {
        await delay(1_000)
        appearanceNetworkRequests.length = 0
        checkingAppearanceNetwork = true
        const dom = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
        const fileInput = await cdp.send('DOM.querySelector', {
          nodeId: dom.root.nodeId,
          selector: '.appearance-dropzone input[type="file"]'
        })
        if (!fileInput.nodeId) {
          failures.push('appearance file input was not found')
        } else {
          await cdp.send('DOM.setFileInputFiles', {
            nodeId: fileInput.nodeId,
            files: [resolvedAppearanceFile]
          })
          await delay(800)
          const activated = await cdp.send('Runtime.evaluate', {
            returnByValue: true,
            expression: `(() => {
              const packages = [...document.querySelectorAll('.appearance-package')]
              const target = packages.find((item) => !item.innerText.includes('Field Guide'))
              const activate = target ? [...target.querySelectorAll('button')]
                .find((button) => button.innerText.trim() === 'Activate') : null
              activate?.click()
              return {
                imported: Boolean(target),
                targetId: target?.getAttribute('data-appearance-package-id') ?? '',
                auditPassed: document.body.innerText.includes('Machine checks passed'),
                clickedActivate: Boolean(activate)
              }
            })()`
          })
          await delay(500)
          const activeState = await cdp.send('Runtime.evaluate', {
            returnByValue: true,
            expression: `(() => {
              const frame = document.querySelector('.app-frame')
              return {
                id: frame?.getAttribute('data-appearance') ?? '',
                surface: frame ? getComputedStyle(frame).getPropertyValue('--surface-app').trim() : ''
              }
            })()`
          })
          checkingAppearanceNetwork = false
          const loaded = cdp.waitFor('Page.loadEventFired')
          await cdp.send('Page.navigate', { url: `${baseUrl}profile` })
          await loaded
          await delay(500)
          const persisted = await cdp.send('Runtime.evaluate', {
            returnByValue: true,
            expression: `document.querySelector('.app-frame')?.getAttribute('data-appearance') ?? ''`
          })
          if (
            !activated.result.value.imported ||
            !activated.result.value.auditPassed ||
            !activated.result.value.clickedActivate ||
            !activated.result.value.targetId ||
            activeState.result.value.id !== activated.result.value.targetId ||
            !activeState.result.value.surface ||
            persisted.result.value !== activated.result.value.targetId ||
            appearanceNetworkRequests.length > 0
          ) {
            failures.push(`appearance import/activate/persist failed: ${JSON.stringify({
              actions: activated.result.value,
              active: activeState.result.value,
              persisted: persisted.result.value,
              networkRequests: appearanceNetworkRequests
            })}`)
          } else {
            console.log('[smoke] appearance package: import, audit, activate, persist and network isolation OK')
            await cdp.send('Emulation.setDeviceMetricsOverride', {
              width: 390,
              height: 844,
              deviceScaleFactor: 1,
              mobile: true
            })
            const reviewedScreens = new Set()
            const reviewRoutes = routes.filter((route) => {
              const screen = appearanceScreenByPath[route.path.split('?')[0]]
              if (!screen || reviewedScreens.has(screen)) return false
              reviewedScreens.add(screen)
              return true
            })
            for (const locale of ['zh-CN', 'en']) {
              for (const route of reviewRoutes) {
                await cdp.send('Runtime.evaluate', { expression: `localStorage.setItem('netrin.language', ${JSON.stringify(locale)})` })
                const loaded = cdp.waitFor('Page.loadEventFired')
                await cdp.send('Page.navigate', { url: `${baseUrl}${route.path}` })
                await loaded
                await delay(500)
                const expectedScreen = appearanceScreenByPath[route.path.split('?')[0]]
                await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
                for (let tabIndex = 0; tabIndex < 8; tabIndex += 1) {
                  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
                  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' })
                  const focusProbe = await cdp.send('Runtime.evaluate', {
                    returnByValue: true,
                    expression: `(() => {
                      const item = document.activeElement
                      if (!item || item === document.body || item.closest('.amap-container, [class*="amap-"]')) return false
                      const style = getComputedStyle(item)
                      return style.outlineStyle !== 'none' || style.boxShadow !== 'none'
                    })()`
                  })
                  if (focusProbe.result.value) break
                }
                const themed = await cdp.send('Runtime.evaluate', {
                  returnByValue: true,
                  expression: `(() => {
                    const frame = document.querySelector('.app-frame')
                    const control = document.activeElement
                    const targets = [...document.querySelectorAll('button, a, input, [role="button"], [role="switch"]')]
                      .filter((item) => {
                        const rect = item.getBoundingClientRect()
                        const providerOwned = item.closest('.amap-container, [class*="amap-"]')
                        return !providerOwned && rect.width > 0 && rect.height > 0
                      })
                    const effectiveTarget = (item) => {
                      if (item.matches('input[type="checkbox"], input[type="radio"]')) {
                        const label = item.closest('label')
                        if (label) return label
                      }
                      return item
                    }
                    const undersized = targets.filter((item) => {
                      const rect = effectiveTarget(item).getBoundingClientRect()
                      return rect.width < 44 || rect.height < 44
                    })
                    const attribution = document.querySelector('.amap-copyright, .amap-logo')
                    const attributionStyle = attribution ? getComputedStyle(attribution) : null
                    return {
                      appearance: frame?.getAttribute('data-appearance') ?? '',
                      screen: document.querySelector('[data-appearance-hook="screen-content"]')?.getAttribute('data-appearance-screen') ?? '',
                      overflow: document.documentElement.scrollWidth > 390.5,
                      undersizedTargets: undersized.length,
                      undersizedDetails: undersized.slice(0, 12).map((item) => { const target = effectiveTarget(item); const rect = target.getBoundingClientRect(); return { tag: item.tagName, targetTag: target.tagName, className: item.className, text: target.textContent?.trim().slice(0, 32), width: Math.round(rect.width), height: Math.round(rect.height) } }),
                      focusVisible: Boolean(control && (getComputedStyle(control).outlineStyle !== 'none' || getComputedStyle(control).boxShadow !== 'none')),
                      runningAnimations: document.getAnimations().filter((item) => item.playState === 'running').length,
                      attributionVisible: !attribution || Boolean(attributionStyle && attributionStyle.display !== 'none' && attributionStyle.visibility !== 'hidden')
                    }
                  })()`
                })
                const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
                await writeFile(resolve(artifactDir, `appearance-${locale}-${expectedScreen}.png`), Buffer.from(screenshot.data, 'base64'))
                if (
                  themed.result.value.appearance !== activated.result.value.targetId ||
                  themed.result.value.screen !== expectedScreen || themed.result.value.overflow ||
                  themed.result.value.undersizedTargets || !themed.result.value.focusVisible ||
                  themed.result.value.runningAnimations || !themed.result.value.attributionVisible
                ) failures.push(`appearance route review failed for ${locale}/${route.name}: ${JSON.stringify(themed.result.value)}`)
              }
            }
            await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
            console.log(`[smoke] appearance package: captured ${reviewRoutes.length * 2} bilingual themed route states`)
          }
        }
      }
    }

    const [zhManifestResponse, enManifestResponse] = await Promise.all([
      fetch(`${baseUrl}manifest.zh-CN.webmanifest`),
      fetch(`${baseUrl}manifest.en.webmanifest`)
    ])
    if (!zhManifestResponse.ok || !enManifestResponse.ok) {
      failures.push('localized Web App Manifests are not both reachable')
    } else {
      const [zhManifest, enManifest] = await Promise.all([
        zhManifestResponse.json(),
        enManifestResponse.json()
      ])
      if (zhManifest.name !== '移步换景') failures.push('zh-CN manifest name is incorrect')
      if (enManifest.name !== 'Netrin') failures.push('English manifest name is incorrect')
    }

    if (failures.length) throw new Error(`Browser smoke failures:\n- ${failures.join('\n- ')}`)
    console.log(`[smoke] PASS: ${routes.length} routes at 390x844; localized manifests reachable.`)
  } catch (error) {
    const logs = [...previewLog, ...browserLog].join('').trim()
    if (logs) console.error(logs.slice(-4_000))
    throw error
  } finally {
    process.removeListener('SIGINT', onSigint)
    process.removeListener('SIGTERM', onSigterm)
    await cleanup()
  }
}

await main()
