import localforage from 'localforage'
import { compressImage } from '../lib/image'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { loadMediaBlob } from './drafts'
import { normalizeOfflinePackageMeta } from './offlinePackage'
import type {
  CommunityRouteDetail,
  Coordinate,
  DiscoveryCursor,
  DiscoveryQuery,
  DownloadedRoute,
  DownloadedStop,
  GeometrySource,
  LocalizedText,
  OwnedRouteSubmission,
  RouteDifficulty,
  RouteDraft,
  RoutePointMedia,
  RoutePublicV2PointRow,
  RouteSummary,
  SubmitRouteV4Meta,
  TravelMode,
  Wgs84LineString
} from './types'
import {
  MAX_POINT_MEDIA,
  MAX_ROUTE_MEDIA_BYTES,
  readHighlightFields,
  resolveHighlightTitle
} from './types'

const EMPTY_TEXT: LocalizedText = { 'zh-CN': '', en: '' }
export const DOWNLOADS_KEY = 'netrin.downloaded.v3'
export const DOWNLOADS_KEY_V2 = 'netrin.downloaded.v2'
export const DOWNLOADS_KEY_V1 = 'netrin.downloaded'
const PUBLISH_ATTEMPTS_STORAGE_ID = 'netrin.routePublishAttempts.v2'
const DISCOVERY_PAGE_SIZE = 20

const GEOMETRY_SOURCES = new Set<GeometrySource>([
  'amap-planned',
  'field-recorded',
  'gpx-import',
  'geojson-import',
  'legacy-point-chain'
])

const TRAVEL_MODES = new Set<TravelMode>(['walking', 'cycling'])
const DIFFICULTIES = new Set<RouteDifficulty>(['easy', 'moderate', 'hard'])

type PublishAttempt = {
  draftId: string
  routeId: string
  pointIds: Record<string, string>
  mediaIds: Record<string, string>
  uploadedPaths: string[]
  /** True when the RPC may have committed but its response was not received. */
  ambiguousCommit: boolean
  /** True only while unreferenced paths remain to be cleaned after a known commit. */
  committedRoute?: boolean
  updatedAt: string
}

type LegacyDownloadedStop = {
  id?: string
  location?: Coordinate
  title?: LocalizedText | unknown
  description?: LocalizedText | unknown
  highlightTitle?: string
  speciesName?: string
  category?: string
  media?: Array<Partial<RoutePointMedia> & { id?: string; order?: number }>
  order?: number
  photoUrl?: string
}

type LegacyDownloadedRoute = {
  id?: string
  remoteRouteId?: string
  title?: unknown
  description?: unknown
  author?: unknown
  stops?: LegacyDownloadedStop[]
  downloadedAt?: string
  localEditedAt?: string
  isLocalEdited?: boolean
  remoteUpdatedAt?: string
  travelMode?: unknown
  geometry?: unknown
  geometrySource?: unknown
  cityAdcode?: unknown
  cityName?: unknown
  distanceM?: unknown
  durationS?: unknown
  metricsUpdatedAt?: unknown
  isLoop?: unknown
  coverMediaId?: unknown
  offlinePackage?: unknown
  season?: unknown
  difficulty?: unknown
  distance?: unknown
  duration?: unknown
  tags?: unknown
  waypoints?: unknown
  segments?: unknown
}

function keyPointTitle(index: number, title?: string | null): LocalizedText {
  const value = title?.trim() || `关键点 ${index + 1}`
  return { 'zh-CN': value, en: title?.trim() || `Key point ${index + 1}` }
}

function isLocalizedText(value: unknown): value is LocalizedText {
  if (!value || typeof value !== 'object') return false
  const text = value as Partial<LocalizedText>
  return typeof text['zh-CN'] === 'string' && typeof text.en === 'string'
}

function isFiniteCoordinate(lng: unknown, lat: unknown): lng is number {
  return (
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180 &&
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90
  )
}

function optionalNonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

function normalizeRemoteMedia(value: RoutePublicV2PointRow['media']): RoutePointMedia[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item, index): RoutePointMedia[] => {
      if (!item || typeof item.id !== 'string') return []
      const mimeType =
        item.mimeType === 'image/jpeg' ||
        item.mimeType === 'image/png' ||
        item.mimeType === 'image/webp'
          ? item.mimeType
          : undefined
      const order =
        typeof item.order === 'number' && Number.isFinite(item.order) && item.order > 0
          ? item.order
          : index + 1
      const sizeBytes = optionalNonNegativeInt(item.sizeBytes)
      return [{
        id: item.id,
        order,
        storagePath: typeof item.storagePath === 'string' ? item.storagePath : undefined,
        url: typeof item.url === 'string' ? item.url : undefined,
        mimeType,
        width: typeof item.width === 'number' ? item.width : undefined,
        height: typeof item.height === 'number' ? item.height : undefined,
        ...(sizeBytes !== undefined ? { sizeBytes } : {})
      }]
    })
    .slice(0, MAX_POINT_MEDIA)
}

function normalizePublicPoint(
  point: RoutePublicV2PointRow,
  routeId: string,
  index: number
): DownloadedStop | undefined {
  if (!isFiniteCoordinate(point.lng, point.lat)) return undefined
  const media = normalizeRemoteMedia(point.media)
  const fields = readHighlightFields({
    highlightTitle: point.highlightTitle,
    speciesName: point.speciesName,
    title: point.title,
    category: point.category
  })
  const displayTitle = fields.highlightTitle ?? point.title
  const order =
    typeof point.order === 'number' && Number.isFinite(point.order) && point.order > 0
      ? point.order
      : index + 1
  return {
    id: typeof point.id === 'string' ? point.id : `${routeId}-point-${index + 1}`,
    location: [point.lng, point.lat] as Coordinate,
    title: keyPointTitle(index, displayTitle),
    description: {
      'zh-CN': typeof point.text === 'string' ? point.text : '',
      en: typeof point.text === 'string' ? point.text : ''
    },
    ...fields,
    media,
    photoUrl: media[0]?.url,
    order
  }
}

/** Route publication requires a confirmed permanent account; never creates anonymous users. */
export async function ensurePermanentSession(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  if (!supabase) return { ok: false, error: 'unconfigured' }
  try {
    const { data } = await supabase.auth.getSession()
    const user = data.session?.user
    if (user?.id && user.is_anonymous !== true && user.phone && user.phone_confirmed_at) {
      return { ok: true, userId: user.id }
    }
    return { ok: false, error: 'permanent account required' }
  } catch {
    return { ok: false, error: 'network' }
  }
}

type SignedRouteMedia = {
  mediaId: string
  url: string
  expiresAt: string
  sizeBytes?: number
}

type DiscoveryWireRow = {
  id?: unknown
  author?: unknown
  title?: unknown
  description?: unknown
  downloads?: unknown
  created_at?: unknown
  updated_at?: unknown
  travel_mode?: unknown
  city_adcode?: unknown
  city_name?: unknown
  distance_m?: unknown
  duration_s?: unknown
  metrics_updated_at?: unknown
  difficulty?: unknown
  is_loop?: unknown
  tags?: unknown
  cover_media_id?: unknown
  bbox?: unknown
  point_count?: unknown
  recommendation_reason?: unknown
}

function normalizeBounds(value: unknown): RouteSummary['bounds'] {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const values = [raw.minLng, raw.minLat, raw.maxLng, raw.maxLat]
  if (!values.every((item) => typeof item === 'number' && Number.isFinite(item))) return undefined
  const [minLng, minLat, maxLng, maxLat] = values as number[]
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng > maxLng || minLat > maxLat) {
    return undefined
  }
  return { minLng, minLat, maxLng, maxLat }
}

export function normalizeRouteSummary(value: unknown): RouteSummary | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as DiscoveryWireRow
  if (
    typeof row.id !== 'string' ||
    typeof row.created_at !== 'string' ||
    !isLocalizedText(row.title) ||
    (row.travel_mode !== 'walking' && row.travel_mode !== 'cycling')
  ) return undefined
  return {
    id: row.id,
    author: typeof row.author === 'string' ? row.author : '',
    title: row.title,
    description: isLocalizedText(row.description) ? row.description : { ...EMPTY_TEXT },
    downloads: optionalFiniteNumber(row.downloads) ?? 0,
    createdAt: row.created_at,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : undefined,
    travelMode: row.travel_mode,
    cityAdcode: typeof row.city_adcode === 'string' ? row.city_adcode : undefined,
    cityName: typeof row.city_name === 'string' ? row.city_name : undefined,
    distanceM: optionalFiniteNumber(row.distance_m),
    durationS: optionalFiniteNumber(row.duration_s),
    metricsUpdatedAt: typeof row.metrics_updated_at === 'string' ? row.metrics_updated_at : undefined,
    difficulty: row.difficulty === null || DIFFICULTIES.has(row.difficulty as RouteDifficulty)
      ? row.difficulty as RouteDifficulty | null
      : undefined,
    isLoop: typeof row.is_loop === 'boolean' ? row.is_loop : undefined,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 10) : [],
    coverMediaId: typeof row.cover_media_id === 'string' ? row.cover_media_id : undefined,
    bounds: normalizeBounds(row.bbox),
    pointCount: Math.round(optionalFiniteNumber(row.point_count) ?? 0),
    recommendationReason: ['nearby', 'city', 'new', 'popular'].includes(String(row.recommendation_reason))
      ? row.recommendation_reason as RouteSummary['recommendationReason']
      : undefined
  }
}

export function buildDiscoveryRpcArgs(query: DiscoveryQuery = {}) {
  const bounds = query.bounds
  return {
    p_cursor_created_at: query.cursor?.createdAt ?? null,
    p_cursor_id: query.cursor?.id ?? null,
    p_limit: Math.max(1, Math.min(50, Math.round(query.limit ?? DISCOVERY_PAGE_SIZE))),
    p_city_adcode: query.cityAdcode ?? null,
    p_travel_mode: query.travelMode ?? null,
    p_min_distance_m: query.minDistanceM ?? null,
    p_max_distance_m: query.maxDistanceM ?? null,
    p_min_duration_s: query.minDurationS ?? null,
    p_max_duration_s: query.maxDurationS ?? null,
    p_difficulty: query.difficulty ?? null,
    p_tags: query.tags?.length ? query.tags.slice(0, 10) : null,
    p_min_lng: bounds?.minLng ?? null,
    p_min_lat: bounds?.minLat ?? null,
    p_max_lng: bounds?.maxLng ?? null,
    p_max_lat: bounds?.maxLat ?? null
  }
}

export type DiscoveryFetchResult =
  | { ok: true; routes: RouteSummary[]; nextCursor?: DiscoveryCursor }
  | { ok: false; error: 'unconfigured' | 'network' | 'invalid' }

async function signMediaIds(mediaIds: string[]): Promise<Map<string, string>> {
  if (!supabase || mediaIds.length === 0) return new Map()
  try {
    const responses = []
    for (let index = 0; index < Math.min(mediaIds.length, 1000); index += 200) {
      responses.push(await supabase.functions.invoke('netrin-media', {
        body: { mediaIds: mediaIds.slice(index, index + 200) }
      }))
    }
    return new Map(responses.flatMap(({ data, error }) =>
      !error && Array.isArray(data?.items) ? data.items as SignedRouteMedia[] : []
    ).filter((item) => typeof item.mediaId === 'string' && typeof item.url === 'string')
      .map((item) => [item.mediaId, item.url]))
  } catch {
    return new Map()
  }
}

export async function hydrateRouteSummaryCovers(routes: RouteSummary[]): Promise<RouteSummary[]> {
  const covers = await signMediaIds(routes.flatMap((route) => route.coverMediaId ? [route.coverMediaId] : []))
  return routes.map((route) => ({ ...route, coverUrl: route.coverMediaId ? covers.get(route.coverMediaId) : undefined }))
}

export async function fetchDiscoveryRoutes(query: DiscoveryQuery = {}): Promise<DiscoveryFetchResult> {
  if (!supabase) return { ok: false, error: 'unconfigured' }
  try {
    const args = buildDiscoveryRpcArgs(query)
    const { data, error } = await supabase.rpc('routes_discovery_v1', args)
    if (error) return { ok: false, error: 'network' }
    if (!Array.isArray(data)) return { ok: false, error: 'invalid' }
    const routes = data.flatMap((row): RouteSummary[] => {
      const normalized = normalizeRouteSummary(row)
      return normalized ? [normalized] : []
    })
    if (routes.length !== data.length) return { ok: false, error: 'invalid' }
    const hydrated = await hydrateRouteSummaryCovers(routes)
    const last = hydrated[hydrated.length - 1]
    return {
      ok: true,
      routes: hydrated,
      nextCursor: last && hydrated.length === args.p_limit
        ? { createdAt: last.createdAt, id: last.id }
        : undefined
    }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export function rankPopularRoutes(routes: RouteSummary[], limit = DISCOVERY_PAGE_SIZE): RouteSummary[] {
  return [...routes]
    .sort((left, right) => {
      const downloadOrder = right.downloads - left.downloads
      if (downloadOrder !== 0) return downloadOrder
      const rightTime = Date.parse(right.updatedAt ?? right.createdAt)
      const leftTime = Date.parse(left.updatedAt ?? left.createdAt)
      return rightTime - leftTime || left.id.localeCompare(right.id)
    })
    .slice(0, Math.max(1, Math.min(50, Math.round(limit))))
    .map((route) => ({ ...route, recommendationReason: 'popular' }))
}

export async function fetchRecommendedRoutes(input: {
  basis: 'nearby' | 'city' | 'new' | 'popular'
  cityAdcode?: string
  location?: Coordinate
  limit?: number
}): Promise<DiscoveryFetchResult> {
  if (!supabase) return { ok: false, error: 'unconfigured' }
  const limit = Math.max(1, Math.min(50, Math.round(input.limit ?? DISCOVERY_PAGE_SIZE)))
  if (input.basis === 'popular') {
    const discovered = await fetchDiscoveryRoutes({ limit: 50, cityAdcode: input.cityAdcode })
    if (!discovered.ok) return discovered
    return { ok: true, routes: rankPopularRoutes(discovered.routes, limit) }
  }
  try {
    const { data, error } = await supabase.rpc('routes_recommended_v1', {
      p_basis: input.basis,
      p_city_adcode: input.cityAdcode ?? null,
      // Nearby recommendations deliberately round the device location (~1 km).
      p_lng: input.location ? Number(input.location[0].toFixed(2)) : null,
      p_lat: input.location ? Number(input.location[1].toFixed(2)) : null,
      p_limit: limit
    })
    if (error || !Array.isArray(data)) return { ok: false, error: error ? 'network' : 'invalid' }
    const routes = data.flatMap((row): RouteSummary[] => {
      const normalized = normalizeRouteSummary(row)
      return normalized ? [normalized] : []
    })
    if (routes.length !== data.length) return { ok: false, error: 'invalid' }
    return { ok: true, routes: await hydrateRouteSummaryCovers(routes) }
  } catch { return { ok: false, error: 'network' } }
}

async function hydrateRouteMediaUrls<T extends { stops: DownloadedStop[] }>(routes: T[]): Promise<T[]> {
  if (!supabase) return routes
  const mediaIds = [...new Set(routes.flatMap((route) => route.stops)
    .flatMap((stop) => stop.media)
    .map((media) => media.id)
    .filter(Boolean))]
  if (mediaIds.length === 0) return routes

  try {
    const batches = []
    for (let index = 0; index < Math.min(mediaIds.length, 1000); index += 200) {
      batches.push(supabase.functions.invoke('netrin-media', {
        body: { mediaIds: mediaIds.slice(index, index + 200) }
      }))
    }
    const responses = await Promise.all(batches)
    const signedItems = responses.flatMap(({ data, error }) =>
      !error && Array.isArray(data?.items) ? data.items as SignedRouteMedia[] : []
    )
    const urls = new Map<string, string>()
    const sizes = new Map<string, number>()
    for (const item of signedItems) {
      if (typeof item.mediaId !== 'string') continue
      if (typeof item.url === 'string') urls.set(item.mediaId, item.url)
      const sizeBytes = optionalNonNegativeInt(item.sizeBytes)
      if (sizeBytes !== undefined) sizes.set(item.mediaId, sizeBytes)
    }
    return routes.map((route) => ({
      ...route,
      stops: route.stops.map((stop) => {
        const media = stop.media.map((item) => {
          const url = urls.get(item.id)
          const sizeBytes = sizes.get(item.id) ?? item.sizeBytes
          return {
            ...item,
            ...(url ? { url } : { url: item.url }),
            ...(sizeBytes !== undefined ? { sizeBytes } : {})
          }
        })
        return { ...stop, media, photoUrl: media[0]?.url }
      })
    }))
  } catch {
    return routes
  }
}

type RouteDetailWire = {
  id?: unknown
  author?: unknown
  title?: unknown
  description?: unknown
  downloads?: unknown
  created_at?: unknown
  updated_at?: unknown
  travelMode?: unknown
  cityAdcode?: unknown
  cityName?: unknown
  geometrySource?: unknown
  distanceM?: unknown
  durationS?: unknown
  metricsUpdatedAt?: unknown
  difficulty?: unknown
  isLoop?: unknown
  tags?: unknown
  coverMediaId?: unknown
  geometry?: unknown
  highlights?: unknown
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function normalizeCommunityRouteDetail(value: unknown): CommunityRouteDetail | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as RouteDetailWire
  if (
    typeof row.id !== 'string' ||
    !isLocalizedText(row.title) ||
    !isWgs84LineString(row.geometry) ||
    (row.travelMode !== 'walking' && row.travelMode !== 'cycling') ||
    typeof row.geometrySource !== 'string' ||
    !GEOMETRY_SOURCES.has(row.geometrySource as GeometrySource) ||
    !Array.isArray(row.highlights)
  ) return undefined

  const stops = row.highlights.flatMap((point, index): DownloadedStop[] => {
    if (!point || typeof point !== 'object') return []
    const normalized = normalizePublicPoint(point as RoutePublicV2PointRow, row.id as string, index)
    return normalized ? [normalized] : []
  }).sort((a, b) => a.order - b.order)
  if (stops.length < 2) return undefined

  const difficulty = row.difficulty === null || DIFFICULTIES.has(row.difficulty as RouteDifficulty)
    ? row.difficulty as RouteDifficulty | null
    : undefined
  const tags = Array.isArray(row.tags)
    ? row.tags.filter((tag): tag is string => typeof tag === 'string')
    : []
  return {
    id: row.id,
    title: row.title,
    description: isLocalizedText(row.description) ? row.description : { ...EMPTY_TEXT },
    author: typeof row.author === 'string' ? row.author : '',
    downloads: optionalFiniteNumber(row.downloads) ?? 0,
    createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : undefined,
    travelMode: row.travelMode,
    geometry: row.geometry,
    geometrySource: row.geometrySource as GeometrySource,
    cityAdcode: typeof row.cityAdcode === 'string' ? row.cityAdcode : undefined,
    cityName: typeof row.cityName === 'string' ? row.cityName : undefined,
    distanceM: optionalFiniteNumber(row.distanceM),
    durationS: optionalFiniteNumber(row.durationS),
    metricsUpdatedAt: typeof row.metricsUpdatedAt === 'string' ? row.metricsUpdatedAt : undefined,
    difficulty,
    isLoop: typeof row.isLoop === 'boolean' ? row.isLoop : undefined,
    tags,
    coverMediaId: typeof row.coverMediaId === 'string' ? row.coverMediaId : undefined,
    stops
  }
}

export type RouteDetailFetchError = 'unconfigured' | 'network' | 'not-found' | 'invalid'

export type RouteDetailFetchResult =
  | { ok: true; route: CommunityRouteDetail }
  | { ok: false; error: RouteDetailFetchError }

export async function fetchRouteDetail(routeId: string): Promise<RouteDetailFetchResult> {
  if (!supabase) return { ok: false, error: 'unconfigured' }
  try {
    let { data, error } = await supabase.rpc('get_route_detail_v2', { p_route_id: routeId })
    if (error) ({ data, error } = await supabase.rpc('get_route_detail_v1', { p_route_id: routeId }))
    if (error) return { ok: false, error: 'network' }
    if (!data) return { ok: false, error: 'not-found' }
    const route = normalizeCommunityRouteDetail(data)
    if (!route) return { ok: false, error: 'invalid' }
    const [hydrated] = await hydrateRouteMediaUrls([route])
    return { ok: true, route: hydrated }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function fetchOwnedRouteSubmissions(): Promise<OwnedRouteSubmission[]> {
  if (!supabase) return []
  try {
    const { data, error } = await supabase
      .from('routes_owned_v2')
      .select('id,title,description,moderation_status,rejection_reason,created_at,updated_at')
      .order('updated_at', { ascending: false })
    if (error) return []
    return (data ?? []).flatMap((row): OwnedRouteSubmission[] => {
      if (
        typeof row.id !== 'string' ||
        !isLocalizedText(row.title) ||
        !isLocalizedText(row.description) ||
        !['pending', 'approved', 'rejected'].includes(row.moderation_status)
      ) return []
      return [{
        id: row.id,
        title: row.title,
        description: row.description,
        moderationStatus: row.moderation_status as OwnedRouteSubmission['moderationStatus'],
        rejectionReason: typeof row.rejection_reason === 'string' ? row.rejection_reason : undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }]
    })
  } catch {
    return []
  }
}

export type PublishResult =
  | { ok: true; id: string }
  | { ok: false; error: 'unconfigured' | 'auth' | 'network' | 'server' | 'storage' | 'invalid' }

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function loadPublishAttemptMap(): Promise<Record<string, PublishAttempt>> {
  try {
    const value = await localforage.getItem<Record<string, PublishAttempt>>(PUBLISH_ATTEMPTS_STORAGE_ID)
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

async function savePublishAttempt(attempt: PublishAttempt): Promise<void> {
  try {
    const attempts = await loadPublishAttemptMap()
    attempts[attempt.draftId] = { ...attempt, updatedAt: new Date().toISOString() }
    await localforage.setItem(PUBLISH_ATTEMPTS_STORAGE_ID, attempts)
  } catch {
    // Publishing can continue, but an ambiguous network result will need manual retry.
  }
}

async function clearPublishAttempt(draftId: string): Promise<void> {
  try {
    const attempts = await loadPublishAttemptMap()
    if (!attempts[draftId]) return
    delete attempts[draftId]
    await localforage.setItem(PUBLISH_ATTEMPTS_STORAGE_ID, attempts)
  } catch {
    // A stale attempt is safe: IDs and paths remain idempotent on the next retry.
  }
}

function mediaAttemptKey(pointId: string, mediaId: string, order: number): string {
  return `${pointId}:${mediaId}:${order}`
}

async function getOrCreatePublishAttempt(draft: RouteDraft): Promise<PublishAttempt> {
  const attempts = await loadPublishAttemptMap()
  const current = attempts[draft.id]
  const attempt: PublishAttempt = current ?? {
    draftId: draft.id,
    routeId: draft.remoteId ?? createUuid(),
    pointIds: {},
    mediaIds: {},
    uploadedPaths: [],
    ambiguousCommit: false,
    updatedAt: new Date().toISOString()
  }

  for (const point of draft.points) {
    attempt.pointIds[point.id] ??= createUuid()
    point.media.forEach((media, index) => {
      const key = mediaAttemptKey(
        point.id,
        media.id || media.photoId || media.storagePath || 'media',
        index + 1
      )
      attempt.mediaIds[key] ??= createUuid()
    })
  }
  await savePublishAttempt(attempt)
  return attempt
}

async function removeUploadedPaths(paths: string[]): Promise<boolean> {
  if (!supabase || paths.length === 0) return paths.length === 0
  try {
    const { error } = await supabase.storage.from('route-media').remove(paths)
    if (error) {
      console.warn('[netrin-routes] Could not clean uploaded media.', error)
      return false
    }
    return true
  } catch {
    console.warn('[netrin-routes] Could not clean uploaded media.', paths)
    return false
  }
}

async function abandonUncommittedAttempt(attempt: PublishAttempt): Promise<void> {
  if (attempt.committedRoute) {
    const removed = await removeUploadedPaths(attempt.uploadedPaths)
    if (removed) await clearPublishAttempt(attempt.draftId)
    else await savePublishAttempt(attempt)
    return
  }
  if (attempt.ambiguousCommit) {
    await savePublishAttempt(attempt)
    return
  }
  const removed = await removeUploadedPaths(attempt.uploadedPaths)
  if (removed) await clearPublishAttempt(attempt.draftId)
  else await savePublishAttempt(attempt)
}

async function routeCommitState(routeId: string): Promise<'committed' | 'absent' | 'unknown'> {
  if (!supabase) return 'unknown'
  try {
    const { data, error } = await supabase
      .from('routes_owned_v2')
      .select('id')
      .eq('id', routeId)
      .maybeSingle()
    if (error) return 'unknown'
    return data?.id ? 'committed' : 'absent'
  } catch {
    return 'unknown'
  }
}

export async function discardRoutePublishAttempt(draftId: string): Promise<void> {
  const attempts = await loadPublishAttemptMap()
  const attempt = attempts[draftId]
  if (!attempt) return

  if (attempt.committedRoute) {
    await abandonUncommittedAttempt(attempt)
    return
  }

  if (attempt.ambiguousCommit && supabase) {
    try {
      const { data, error } = await supabase
        .from('routes_owned_v2')
        .select('id')
        .eq('id', attempt.routeId)
        .maybeSingle()
      if (error) return
      if (data?.id) {
        await clearPublishAttempt(draftId)
        return
      }
      attempt.ambiguousCommit = false
    } catch {
      return
    }
  }

  await abandonUncommittedAttempt(attempt)
}

type MediaUploadResult =
  | { ok: true; path: string }
  | { ok: false; error: 'unconfigured' | 'network' | 'storage' | 'invalid' }

export async function uploadRouteMedia(
  blob: Blob,
  userId: string,
  routeId: string,
  pointId: string,
  order: number
): Promise<MediaUploadResult> {
  if (!supabase) return { ok: false, error: 'unconfigured' }
  if (blob.size > MAX_ROUTE_MEDIA_BYTES || order < 1 || order > MAX_POINT_MEDIA) {
    return { ok: false, error: 'invalid' }
  }
  const path = `routes/${userId}/${routeId}/${pointId}/${order}.jpg`
  try {
    const { error } = await supabase.storage
      .from('route-media')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    if (error) return { ok: false, error: 'storage' }
    return { ok: true, path }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export function isWgs84LineString(value: unknown): value is Wgs84LineString {
  if (!value || typeof value !== 'object') return false
  const geom = value as Partial<Wgs84LineString>
  if (geom.type !== 'LineString' || !Array.isArray(geom.coordinates)) return false
  if (geom.coordinates.length < 2 || geom.coordinates.length > 10000) return false
  return geom.coordinates.every(
    (pair) =>
      Array.isArray(pair) &&
      pair.length >= 2 &&
      typeof pair[0] === 'number' &&
      Number.isFinite(pair[0]) &&
      pair[0] >= -180 &&
      pair[0] <= 180 &&
      typeof pair[1] === 'number' &&
      Number.isFinite(pair[1]) &&
      pair[1] >= -90 &&
      pair[1] <= 90
  )
}

/** v4 wire: highlightTitle only (no speciesName). */
export function serializeHighlightPointV4Wire(input: {
  id: string
  order: number
  lng: number
  lat: number
  text?: string
  highlightTitle?: string | null
  category?: string | null
  media?: Array<Record<string, unknown>>
}): Record<string, unknown> {
  const highlightTitle = resolveHighlightTitle({ highlightTitle: input.highlightTitle })
  const category =
    typeof input.category === 'string' && input.category.trim()
      ? input.category.trim()
      : undefined
  if (category && category.length > 80) {
    throw new Error('point category must be at most 80 characters')
  }
  return {
    id: input.id,
    order: input.order,
    lng: input.lng,
    lat: input.lat,
    title: highlightTitle ?? '',
    text: input.text ?? '',
    ...(highlightTitle ? { highlightTitle } : {}),
    ...(category ? { category } : {}),
    media: input.media ?? []
  }
}

function isSerializableMedia(item: { photoId?: string; storagePath?: string }): boolean {
  return Boolean(
    (typeof item.photoId === 'string' && item.photoId) ||
      (typeof item.storagePath === 'string' && item.storagePath)
  )
}

function validateConfirmedDraft(draft: RouteDraft): { ok: true } | { ok: false } {
  if (draft.geometryStatus !== 'confirmed') return { ok: false }
  if (!isWgs84LineString(draft.geometry)) return { ok: false }
  if (!draft.geometrySource || !GEOMETRY_SOURCES.has(draft.geometrySource)) return { ok: false }
  if (!TRAVEL_MODES.has(draft.travelMode)) return { ok: false }
  if (draft.points.length < 2 || draft.points.length > 200) return { ok: false }
  for (const point of draft.points) {
    if (!isFiniteCoordinate(point.final[0], point.final[1])) return { ok: false }
    if (point.media.length > MAX_POINT_MEDIA) return { ok: false }
    if (point.media.some((item) => !isSerializableMedia(item))) return { ok: false }
    if (point.category !== undefined && point.category.length > 80) return { ok: false }
  }
  if (draft.difficulty != null && !DIFFICULTIES.has(draft.difficulty)) return { ok: false }
  if (
    draft.distanceM !== undefined &&
    (!(typeof draft.distanceM === 'number') || !Number.isFinite(draft.distanceM) || draft.distanceM < 0)
  ) {
    return { ok: false }
  }
  if (
    draft.durationS !== undefined &&
    (!(typeof draft.durationS === 'number') || !Number.isFinite(draft.durationS) || draft.durationS < 0)
  ) {
    return { ok: false }
  }
  const tags = draft.tags ?? []
  if (tags.length > 10) return { ok: false }
  const seen = new Set<string>()
  for (const tag of tags) {
    if (typeof tag !== 'string') return { ok: false }
    const trimmed = tag.trim()
    if (!trimmed || trimmed.length > 32 || seen.has(trimmed)) return { ok: false }
    seen.add(trimmed)
  }
  if (draft.coverMediaId) {
    const cover = draft.points
      .flatMap((point) => point.media)
      .find((item) => item.id === draft.coverMediaId)
    if (!cover || !isSerializableMedia(cover)) return { ok: false }
  }
  return { ok: true }
}

export type SubmitRouteV4Args = {
  p_route_id: string
  p_title: LocalizedText
  p_description: LocalizedText
  p_points: Array<Record<string, unknown>>
  p_meta: SubmitRouteV4Meta
}

/**
 * Pure builder for submit_route_v4 RPC args. Used by publishRouteDraft.
 * v4 points never include speciesName.
 */
export function buildSubmitRouteV4Args(input: {
  routeId: string
  title: LocalizedText
  description: LocalizedText
  points: Array<{
    id: string
    order: number
    lng: number
    lat: number
    text?: string
    highlightTitle?: string | null
    category?: string | null
    media?: Array<Record<string, unknown>>
  }>
  meta: SubmitRouteV4Meta
}): SubmitRouteV4Args {
  if (!isWgs84LineString(input.meta.geometry)) {
    throw new Error('submit_route_v4 requires WGS-84 LineString geometry')
  }
  if (!GEOMETRY_SOURCES.has(input.meta.geometrySource)) {
    throw new Error('submit_route_v4 geometrySource invalid')
  }
  if (!TRAVEL_MODES.has(input.meta.travelMode)) {
    throw new Error('submit_route_v4 travelMode invalid')
  }
  if (input.points.length < 2 || input.points.length > 200) {
    throw new Error('submit_route_v4 needs 2..200 highlights')
  }
  for (const point of input.points) {
    if (!isFiniteCoordinate(point.lng, point.lat)) {
      throw new Error('submit_route_v4 point coordinate invalid')
    }
    if (Array.isArray(point.media) && point.media.length > MAX_POINT_MEDIA) {
      throw new Error('submit_route_v4 media max 8 per point')
    }
  }
  const tags = input.meta.tags ?? []
  if (tags.length > 10) throw new Error('submit_route_v4 tags max 10')
  const seen = new Set<string>()
  const normalizedTags: string[] = []
  for (const tag of tags) {
    if (typeof tag !== 'string') throw new Error('submit_route_v4 tag invalid')
    const key = tag.trim()
    if (!key || key.length > 32 || seen.has(key)) throw new Error('submit_route_v4 tag invalid')
    seen.add(key)
    normalizedTags.push(key)
  }
  return {
    p_route_id: input.routeId,
    p_title: input.title,
    p_description: input.description,
    p_points: input.points.map((point) => serializeHighlightPointV4Wire(point)),
    p_meta: {
      travelMode: input.meta.travelMode,
      geometry: input.meta.geometry,
      geometrySource: input.meta.geometrySource,
      tags: normalizedTags,
      ...(input.meta.cityAdcode ? { cityAdcode: input.meta.cityAdcode } : {}),
      ...(input.meta.cityName ? { cityName: input.meta.cityName } : {}),
      ...(input.meta.distanceM !== undefined ? { distanceM: input.meta.distanceM } : {}),
      ...(input.meta.durationS !== undefined ? { durationS: input.meta.durationS } : {}),
      ...(input.meta.difficulty !== undefined ? { difficulty: input.meta.difficulty } : {}),
      ...(input.meta.isLoop !== undefined ? { isLoop: input.meta.isLoop } : {}),
      ...(input.meta.coverMediaId ? { coverMediaId: input.meta.coverMediaId } : {})
    }
  }
}

function mapCoverMediaId(
  draft: RouteDraft,
  attempt: PublishAttempt
): string | undefined {
  if (!draft.coverMediaId) return undefined
  for (const point of draft.points) {
    for (const [mediaIndex, item] of point.media.entries()) {
      if (item.id === draft.coverMediaId) {
        if (!isSerializableMedia(item)) return undefined
        const key = mediaAttemptKey(
          point.id,
          item.id || item.photoId || item.storagePath || 'media',
          mediaIndex + 1
        )
        return attempt.mediaIds[key]
      }
    }
  }
  return undefined
}

export async function publishRouteDraft(
  draft: RouteDraft,
  fallbackTitle: string
): Promise<PublishResult> {
  if (!supabase) return { ok: false, error: 'unconfigured' }

  // Current clients publish only complete, confirmed geometry through submit_route_v4.
  // SQL14 removed the legacy v3 and v2 write contracts from production.
  if (draft.geometryStatus !== 'confirmed') return { ok: false, error: 'invalid' }
  const validated = validateConfirmedDraft(draft)
  if (!validated.ok) return { ok: false, error: 'invalid' }

  const session = await ensurePermanentSession()
  if (!session.ok) return { ok: false, error: session.error === 'network' ? 'network' : 'auth' }

  const attempt = await getOrCreatePublishAttempt(draft)
  const routeId = attempt.routeId
  const currentPaths: string[] = []

  let coverServerId: string | undefined
  if (draft.coverMediaId) {
    coverServerId = mapCoverMediaId(draft, attempt)
    if (!coverServerId) return { ok: false, error: 'invalid' }
  }

  try {
    const wirePoints: Array<{
      id: string
      order: number
      lng: number
      lat: number
      text: string
      highlightTitle?: string
      category?: string
      media: Array<Record<string, unknown>>
    }> = []
    for (const [pointIndex, point] of draft.points.entries()) {
      if (!isFiniteCoordinate(point.final[0], point.final[1])) {
        await abandonUncommittedAttempt(attempt)
        return { ok: false, error: 'invalid' }
      }
      const pointId = attempt.pointIds[point.id]
      const media: Array<Record<string, unknown>> = []
      for (const [mediaIndex, item] of point.media.entries()) {
        const mediaKey = mediaAttemptKey(
          point.id,
          item.id || item.photoId || item.storagePath || 'media',
          mediaIndex + 1
        )
        if (item.photoId) {
          const expectedPath = `routes/${session.userId}/${routeId}/${pointId}/${mediaIndex + 1}.jpg`
          let upload: MediaUploadResult = { ok: true, path: expectedPath }
          if (!attempt.uploadedPaths.includes(expectedPath)) {
            const source = await loadMediaBlob(item.photoId)
            if (!source) {
              await abandonUncommittedAttempt(attempt)
              return { ok: false, error: 'invalid' }
            }
            const compressed = await compressImage(source)
            upload = await uploadRouteMedia(
              compressed,
              session.userId,
              routeId,
              pointId,
              mediaIndex + 1
            )
          }
          if (!upload.ok) {
            await abandonUncommittedAttempt(attempt)
            return { ok: false, error: upload.error }
          }
          currentPaths.push(upload.path)
          if (!attempt.uploadedPaths.includes(upload.path)) {
            attempt.uploadedPaths.push(upload.path)
            await savePublishAttempt(attempt)
          }
          media.push({
            id: attempt.mediaIds[mediaKey],
            order: mediaIndex + 1,
            storagePath: upload.path,
            mimeType: 'image/jpeg'
          })
          continue
        }
        if (item.storagePath) {
          media.push({
            id: attempt.mediaIds[mediaKey],
            order: mediaIndex + 1,
            storagePath: item.storagePath,
            mimeType: item.mimeType ?? 'image/jpeg'
          })
        }
      }
      wirePoints.push({
        id: pointId,
        order: pointIndex + 1,
        lng: point.final[0],
        lat: point.final[1],
        text: point.text,
        highlightTitle: point.highlightTitle,
        category: point.category,
        media
      })
    }

    const title: LocalizedText = {
      'zh-CN': draft.title.trim() || fallbackTitle,
      en: draft.title.trim() || fallbackTitle
    }
    const description: LocalizedText = {
      'zh-CN': draft.note.trim(),
      en: draft.note.trim()
    }

    const rpcName = 'submit_route_v4'
    const rpcArgs = buildSubmitRouteV4Args({
      routeId,
      title,
      description,
      points: wirePoints,
      meta: {
        travelMode: draft.travelMode,
        geometry: draft.geometry!,
        geometrySource: draft.geometrySource!,
        cityAdcode: draft.cityAdcode,
        cityName: draft.cityName,
        distanceM: draft.distanceM,
        durationS: draft.durationS,
        difficulty: draft.difficulty,
        isLoop: draft.isLoop,
        tags: draft.tags ?? [],
        coverMediaId: coverServerId
      }
    })

    attempt.ambiguousCommit = true
    attempt.committedRoute = false
    await savePublishAttempt(attempt)
    const { data, error } = await supabase.rpc(rpcName, rpcArgs)
    if (error || !data) {
      const commitState = await routeCommitState(routeId)
      if (commitState === 'committed') {
        await clearPublishAttempt(draft.id)
        return { ok: true, id: routeId }
      }
      if (commitState === 'absent') {
        attempt.ambiguousCommit = false
        await savePublishAttempt(attempt)
        await abandonUncommittedAttempt(attempt)
      } else {
        await savePublishAttempt(attempt)
      }
      console.warn(`[netrin-routes] ${rpcName} failed.`, error)
      return { ok: false, error: 'server' }
    }

    const referencedPaths = new Set(currentPaths)
    attempt.uploadedPaths = attempt.uploadedPaths.filter((path) => !referencedPaths.has(path))
    attempt.ambiguousCommit = false
    attempt.committedRoute = attempt.uploadedPaths.length > 0
    if (attempt.uploadedPaths.length === 0) {
      await clearPublishAttempt(draft.id)
    } else {
      const removed = await removeUploadedPaths(attempt.uploadedPaths)
      if (removed) await clearPublishAttempt(draft.id)
      else await savePublishAttempt(attempt)
    }
    return { ok: true, id: data as string }
  } catch {
    await abandonUncommittedAttempt(attempt)
    return { ok: false, error: 'network' }
  }
}

function normalizeDownloadedStop(stop: LegacyDownloadedStop, index: number): DownloadedStop | undefined {
  const location = Array.isArray(stop.location) && stop.location.length >= 2
    ? stop.location
    : undefined
  if (!location || !isFiniteCoordinate(location[0], location[1])) return undefined

  const rawMedia = Array.isArray(stop.media) ? stop.media : []
  const media = rawMedia.length > 0
    ? rawMedia
      .flatMap((item, mediaIndex): RoutePointMedia[] => {
        if (!item || typeof item !== 'object') return []
        const id = typeof item.id === 'string' ? item.id : `${stop.id ?? 'stop'}-media-${mediaIndex + 1}`
        const order =
          typeof item.order === 'number' && Number.isFinite(item.order) && item.order > 0
            ? item.order
            : mediaIndex + 1
        const sizeBytes = optionalNonNegativeInt(item.sizeBytes)
        return [{
          id,
          order,
          photoId: typeof item.photoId === 'string' ? item.photoId : undefined,
          storagePath: typeof item.storagePath === 'string' ? item.storagePath : undefined,
          // Resolved URLs are runtime-only and must not ride along in storage.
          mimeType:
            item.mimeType === 'image/jpeg' ||
            item.mimeType === 'image/png' ||
            item.mimeType === 'image/webp'
              ? item.mimeType
              : undefined,
          width: typeof item.width === 'number' ? item.width : undefined,
          height: typeof item.height === 'number' ? item.height : undefined,
          ...(sizeBytes !== undefined ? { sizeBytes } : {})
        }]
      })
      .slice(0, MAX_POINT_MEDIA)
    : stop.photoUrl && typeof stop.photoUrl === 'string'
      ? [{ id: `${stop.id ?? 'stop'}-media-1`, order: 1, storagePath: undefined }]
      : []

  const titleText = isLocalizedText(stop.title)
    ? stop.title['zh-CN'] || stop.title.en
    : undefined
  const fields = readHighlightFields({
    highlightTitle: stop.highlightTitle,
    speciesName: stop.speciesName,
    title: titleText,
    category: stop.category
  })
  const order =
    typeof stop.order === 'number' && Number.isFinite(stop.order) && stop.order > 0
      ? stop.order
      : index + 1

  return {
    id: typeof stop.id === 'string' ? stop.id : `stop-${index + 1}`,
    location: [location[0], location[1]],
    title: isLocalizedText(stop.title)
      ? stop.title
      : keyPointTitle(index, fields.highlightTitle),
    description: isLocalizedText(stop.description)
      ? stop.description
      : { ...EMPTY_TEXT },
    ...fields,
    order,
    media
  }
}

function normalizeDownloadedTravelMode(value: unknown): TravelMode | undefined {
  return value === 'walking' || value === 'cycling' ? value : undefined
}

function normalizeDownloadedDifficulty(value: unknown): RouteDifficulty | null | undefined {
  if (value === null) return null
  return DIFFICULTIES.has(value as RouteDifficulty) ? value as RouteDifficulty : undefined
}

/** Pure normalizer for downloaded routes (v3 runtime shape, no speciesName). */
export function normalizeDownloadedRoute(route: LegacyDownloadedRoute): DownloadedRoute {
  const stops = Array.isArray(route.stops)
    ? route.stops
      .flatMap((stop, index) => {
        const normalized = normalizeDownloadedStop(stop, index)
        return normalized ? [normalized] : []
      })
      .sort((a, b) => a.order - b.order)
    : []

  const travelMode = normalizeDownloadedTravelMode(route.travelMode)
  const geometry = isWgs84LineString(route.geometry) ? route.geometry : undefined
  const geometrySource =
    typeof route.geometrySource === 'string' && GEOMETRY_SOURCES.has(route.geometrySource as GeometrySource)
      ? route.geometrySource as GeometrySource
      : undefined
  const difficulty = normalizeDownloadedDifficulty(route.difficulty)
  const tags = Array.isArray(route.tags)
    ? route.tags.filter((tag): tag is string => typeof tag === 'string')
    : undefined
  const offlinePackage = normalizeOfflinePackageMeta(route.offlinePackage)

  return {
    id: typeof route.id === 'string' ? route.id : `route-${Date.now()}`,
    remoteRouteId:
      typeof route.remoteRouteId === 'string'
        ? route.remoteRouteId
        : typeof route.id === 'string'
          ? route.id
          : undefined,
    title: isLocalizedText(route.title) ? route.title : { ...EMPTY_TEXT },
    description: isLocalizedText(route.description) ? route.description : { ...EMPTY_TEXT },
    author: typeof route.author === 'string' ? route.author : '',
    stops,
    ...(travelMode ? { travelMode } : {}),
    ...(geometry ? { geometry } : {}),
    ...(geometrySource ? { geometrySource } : {}),
    ...(typeof route.cityAdcode === 'string' ? { cityAdcode: route.cityAdcode } : {}),
    ...(typeof route.cityName === 'string' ? { cityName: route.cityName } : {}),
    ...(optionalFiniteNumber(route.distanceM) !== undefined
      ? { distanceM: optionalFiniteNumber(route.distanceM) }
      : {}),
    ...(optionalFiniteNumber(route.durationS) !== undefined
      ? { durationS: optionalFiniteNumber(route.durationS) }
      : {}),
    ...(typeof route.metricsUpdatedAt === 'string'
      ? { metricsUpdatedAt: route.metricsUpdatedAt }
      : {}),
    ...(difficulty !== undefined ? { difficulty } : {}),
    ...(typeof route.isLoop === 'boolean' ? { isLoop: route.isLoop } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(typeof route.coverMediaId === 'string' ? { coverMediaId: route.coverMediaId } : {}),
    downloadedAt:
      typeof route.downloadedAt === 'string' ? route.downloadedAt : new Date().toISOString(),
    localEditedAt: typeof route.localEditedAt === 'string' ? route.localEditedAt : undefined,
    isLocalEdited: route.isLocalEdited === true,
    remoteUpdatedAt: typeof route.remoteUpdatedAt === 'string' ? route.remoteUpdatedAt : undefined,
    ...(offlinePackage ? { offlinePackage } : {})
  }
}

function persistableDownloads(list: DownloadedRoute[]): DownloadedRoute[] {
  return list.map((route) => {
    const normalized = normalizeDownloadedRoute(route)
    return {
      ...normalized,
      stops: normalized.stops.map((stop) => {
        const { photoUrl: _photoUrl, ...rest } = stop
        return {
          ...rest,
          media: stop.media.map(({ url: _url, ...media }) => media)
        }
      })
    }
  })
}

export async function loadDownloads(): Promise<DownloadedRoute[]> {
  try {
    const current = await localforage.getItem<LegacyDownloadedRoute[]>(DOWNLOADS_KEY)
    if (Array.isArray(current)) {
      return await hydrateRouteMediaUrls(current.map(normalizeDownloadedRoute))
    }

    const v2 = await localforage.getItem<LegacyDownloadedRoute[]>(DOWNLOADS_KEY_V2)
    if (Array.isArray(v2)) {
      const migrated = v2.map(normalizeDownloadedRoute)
      const persisted = persistableDownloads(migrated)
      await localforage.setItem(DOWNLOADS_KEY, persisted)
      await localforage.removeItem(DOWNLOADS_KEY_V2)
      return await hydrateRouteMediaUrls(migrated)
    }

    const v1 = await localforage.getItem<LegacyDownloadedRoute[]>(DOWNLOADS_KEY_V1)
    if (!Array.isArray(v1)) return []
    const migrated = v1.map(normalizeDownloadedRoute)
    const persisted = persistableDownloads(migrated)
    await localforage.setItem(DOWNLOADS_KEY, persisted)
    await localforage.removeItem(DOWNLOADS_KEY_V1)
    return await hydrateRouteMediaUrls(migrated)
  } catch {
    return []
  }
}

export async function saveDownloads(list: DownloadedRoute[]): Promise<void> {
  try {
    await localforage.setItem(DOWNLOADS_KEY, persistableDownloads(list))
  } catch {
    // The in-memory library remains usable when IndexedDB is unavailable.
  }
}

export type DownloadedRoutePatch = Partial<
  Pick<
    DownloadedRoute,
    | 'title'
    | 'description'
    | 'stops'
    | 'travelMode'
    | 'geometry'
    | 'geometrySource'
    | 'cityAdcode'
    | 'cityName'
    | 'distanceM'
    | 'durationS'
    | 'metricsUpdatedAt'
    | 'difficulty'
    | 'isLoop'
    | 'tags'
    | 'coverMediaId'
    | 'offlinePackage'
    | 'remoteUpdatedAt'
  >
>

/**
 * Apply a local edit while preserving confirmed geometry, mode, city/meta,
 * metrics, package metadata, and remoteUpdatedAt unless patched.
 */
export function patchDownloadedRoute(
  route: DownloadedRoute,
  patch: DownloadedRoutePatch
): DownloadedRoute {
  return normalizeDownloadedRoute({
    ...route,
    ...patch,
    remoteRouteId: route.remoteRouteId ?? route.id,
    isLocalEdited: true,
    localEditedAt: new Date().toISOString()
  })
}

export { isSupabaseConfigured }
