import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const json = (path) => JSON.parse(read(path))
const failures = []
const warnings = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}

const sameExactList = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  expected.every((value, index) => actual[index] === value)

const requireExactList = (actual, expected, label) => {
  if (!Array.isArray(actual)) {
    check(false, `${label} must be an array; expected [${expected.join(', ')}]`)
    return
  }
  check(
    sameExactList(actual, expected),
    `${label} must be exactly [${expected.join(', ')}] (got ${JSON.stringify(actual)})`
  )
}

const COMMUNITY_ROUTE_FIELDS = [
  'title',
  'description',
  'author',
  'city',
  'travelMode',
  'geometry',
  'geometrySource',
  'distanceMeters',
  'durationSeconds',
  'difficulty',
  'isLoop',
  'tags',
  'coverMedia',
  'moderationStatus',
  'createdAt',
  'highlights'
]
const ROUTE_HIGHLIGHT_FIELDS = [
  'highlightTitle',
  'description',
  'location',
  'media',
  'category',
  'order'
]
const NEARBY_TRAIL_CAPABILITIES = [
  'route.rank.nearby',
  'route.rank.city',
  'route.rank.mode',
  'route.rank.theme'
]
const ROUTE_IMPORT_CAPABILITIES = [
  'route.import-json',
  'route.import-link',
  'route.import-gpx',
  'route.import-geojson'
]
const AI_ROUTE_CAPABILITIES = [
  'route.ai.extract',
  'route.ai.ingest-file',
  'route.ai.resolve-poi',
  'route.ai.order',
  'route.ai.review'
]

const manifest = json('neuron.manifest.json')
const packageJson = json('package.json')
const registry = json('plugins/cell-plugins.json')
const routesSource = read('src/routes.tsx')
const appSource = read('src/App.tsx')
check(!appSource.includes('QualityMetricsRuntime'), 'retired quality telemetry must not be mounted in App.tsx')
check(!appSource.includes('/creator/'), 'retired creator profiles must not be registered in App.tsx')
check(!appSource.includes('/notifications'), 'retired notifications must not be registered in App.tsx')

check(manifest.id === packageJson.name, 'package.json name must match neuron.manifest.json id')
check(manifest.platform?.primarySurface === 'mobile-web', 'primarySurface must remain mobile-web')
check(Array.isArray(manifest.navigation?.items) && manifest.navigation.items.length === 4, 'four manifest tabs are required')
check(new Set(manifest.navigation.items).size === manifest.navigation.items.length, 'navigation ids must be unique')
for (const id of manifest.navigation.items) {
  check(new RegExp(`\\b${id}\\s*:`).test(routesSource), `manifest navigation id has no screen: ${id}`)
}

const contentTypes = Array.isArray(manifest.contentTypes) ? manifest.contentTypes : []
const contentIds = contentTypes.map((item) => item.id)
check(new Set(contentIds).size === contentIds.length, 'content type ids must be unique')
check(!contentIds.includes('field-note'), 'removed field-note type must not return to the runtime manifest')
for (const legacy of ['trail-route', 'trail-stop', 'species-card']) {
  check(!contentIds.includes(legacy), `legacy content type must not remain: ${legacy}`)
}
const requiredContent = ['community-route', 'route-highlight']
check(
  contentIds.length === requiredContent.length && requiredContent.every((id) => contentIds.includes(id)),
  `content types must be exactly ${requiredContent.join(', ')}`
)
check(manifest.home?.primaryCard === 'route-card', 'home.primaryCard must be route-card')

const communityRoute = contentTypes.find((item) => item.id === 'community-route')
if (!communityRoute) {
  check(false, 'missing content type record: community-route')
} else {
  requireExactList(communityRoute.fields, COMMUNITY_ROUTE_FIELDS, 'community-route.fields')
}

const routeHighlight = contentTypes.find((item) => item.id === 'route-highlight')
if (!routeHighlight) {
  check(false, 'missing content type record: route-highlight')
} else {
  requireExactList(routeHighlight.fields, ROUTE_HIGHLIGHT_FIELDS, 'route-highlight.fields')
}

check(registry.cellId === manifest.id, 'cell plugin registry must target the manifest id')
const plugins = Array.isArray(registry.plugins) ? registry.plugins : []
const pluginIds = new Set(plugins.map((plugin) => plugin.id))
check(pluginIds.size === plugins.length, 'cell plugin ids must be unique')
for (const [slot, pluginId] of Object.entries(manifest.plugins ?? {})) {
  check(pluginIds.has(pluginId), `manifest plugin ${slot} is not declared locally: ${pluginId}`)
}
check(existsSync(resolve(root, 'themes', manifest.plugins.theme, 'appearance.manifest.json')), 'theme appearance manifest is missing')
check(existsSync(resolve(root, 'themes', manifest.plugins.theme, 'tokens.json')), 'theme tokens are missing')

const requirePluginCapabilities = (pluginId, expected) => {
  const plugin = plugins.find((entry) => entry.id === pluginId)
  if (!plugin) {
    check(false, `missing plugin record: ${pluginId}`)
    return
  }
  requireExactList(plugin.capabilities, expected, `${pluginId}.capabilities`)
}

requirePluginCapabilities('nearby-trail-synapse', NEARBY_TRAIL_CAPABILITIES)
requirePluginCapabilities('route-import-dendrite', ROUTE_IMPORT_CAPABILITIES)
requirePluginCapabilities('ai-route-cortex', AI_ROUTE_CAPABILITIES)
check(manifest.plugins?.ai === 'ai-route-cortex', 'manifest.plugins.ai must select ai-route-cortex')

const envExample = read('.env.local.example')
check(!/SERVICE_ROLE/i.test(envExample), '.env.local.example must never mention a frontend service-role variable')
check(/VITE_SUPABASE_URL=/.test(envExample), '.env.local.example must document VITE_SUPABASE_URL')
check(/VITE_SUPABASE_ANON_KEY=/.test(envExample), '.env.local.example must document the public Supabase key')
check(/VITE_AI_ROUTE_API_BASE=/.test(envExample), '.env.local.example must document VITE_AI_ROUTE_API_BASE')
check(!/VITE_.*(?:AI|MODEL).*KEY=/i.test(envExample), 'frontend env example must never declare a model API key')

const localEnvPath = resolve(root, '.env.local')
if (existsSync(localEnvPath)) {
  const keys = readFileSync(localEnvPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1])
    .filter(Boolean)
  const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))]
  if (duplicates.length) warnings.push(`duplicate private env keys: ${duplicates.join(', ')}`)
}

for (const warning of warnings) console.warn(`WARN: ${warning}`)
if (failures.length) {
  for (const failure of failures) console.error(`ERROR: ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Cell contract validation passed (${warnings.length} warning${warnings.length === 1 ? '' : 's'}).`)
}
