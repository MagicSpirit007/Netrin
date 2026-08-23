import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
if (!existsSync(dist)) throw new Error('dist/ is missing; run npm run build first')

const files = []
const walk = (directory) => {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name)
    if (statSync(path).isDirectory()) walk(path)
    else files.push(path)
  }
}
walk(dist)

const failures = []
if (files.some((path) => path.endsWith('.map'))) failures.push('source map found in production build')
const text = files
  .filter((path) => /\.(?:js|css|html|json|txt|svg|webmanifest)$/i.test(path))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) failures.push('private key material found')
for (const marker of [
  ['record_route_quality_v1', 'R4 telemetry RPC record_route_quality_v1'],
  ['admin_route_quality_summary_v1', 'R4 admin quality summary RPC admin_route_quality_summary_v1'],
  ['openrouter', 'R5 removed OpenRouter provider'],
  ['fetchPublicUrl', 'R5 removed URL input capability'],
  ['imagePartIds', 'R5 removed vision input capability']
]) {
  const [needle, label] = marker
  if (text.toLowerCase().includes(needle.toLowerCase())) failures.push(`forbidden release marker in production build: ${label}`)
}

if (!text.includes('/v1/ai-route/providers')) {
  failures.push('AI route provider endpoint is missing from the production build')
}
if (text.includes('AI 路线服务尚未配置') || text.includes('The AI route service is not configured')) {
  failures.push('legacy compile-time AI unconfigured state found in production build')
}
for (const marker of ['/__netrin/appearance-dev/', 'NETRIN_APPEARANCE_DEV_SOURCE']) {
  if (text.includes(marker)) failures.push(`appearance:dev marker found in production build: ${marker}`)
}

for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    if (payload?.role === 'service_role') failures.push('Supabase service_role JWT found')
  } catch {
    // Non-JWT text that merely resembles a token is ignored.
  }
}

const localEnv = resolve(root, '.env.local')
if (existsSync(localEnv)) {
  const values = new Map(readFileSync(localEnv, 'utf8').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : []
  }))
  const devJscode = values.get('VITE_AMAP_SECURITY_JSCODE')
  if (devJscode && devJscode.length >= 8 && text.includes(devJscode)) {
    failures.push('development AMap security jscode found')
  }
}

/**
 * PWA gate: inspect only generated service-worker / workbox files.
 * App chunks legitimately mention AMap hostnames for the JS API loader —
 * those must not trip this check.
 */
const serviceWorkerFiles = files.filter((path) => {
  const name = basename(path).toLowerCase()
  return (
    name.includes('service-worker') ||
    name.includes('serviceworker') ||
    name === 'sw.js' ||
    name.startsWith('workbox-') ||
    /^workbox.*\.js$/i.test(name)
  )
})

// PWA is the primary product: a build without SW/workbox artifacts must fail.
if (serviceWorkerFiles.length === 0) {
  failures.push('no service-worker/workbox files found in dist; PWA offline shell is missing')
}

const swText = serviceWorkerFiles.map((path) => readFileSync(path, 'utf8')).join('\n')

/** Host patterns that would indicate offline basemap/tile caching (forbidden). */
const amapExternalCachePatterns = [
  /webapi\.amap\.com/i,
  /restapi\.amap\.com/i,
  /vdata\.amap\.com/i,
  /wprd\d*\.is\.autonavi\.com/i,
  /webrd\d*\.is\.autonavi\.com/i,
  /map\.amap\.com/i,
  /amap\.com\/(?:v\d\/)?(?:tile|maps|maptiles)/i,
  /autonavi\.com/i
]

for (const pattern of amapExternalCachePatterns) {
  if (swText && pattern.test(swText)) {
    failures.push(
      `service worker / workbox must not cache AMap external resources (${pattern})`
    )
  }
}

// Runtime caching entries that target AMap/autonavi URLs are also forbidden.
if (swText && /runtimeCaching[\s\S]{0,400}(?:amap|autonavi)/i.test(swText)) {
  failures.push('service worker runtimeCaching must not target AMap / autonavi hosts')
}

if (failures.length) {
  for (const failure of [...new Set(failures)]) console.error(`ERROR: ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    `Production build secret scan passed (${files.length} files; checked ${serviceWorkerFiles.length} service-worker/workbox file(s) for AMap cache rules).`
  )
}
