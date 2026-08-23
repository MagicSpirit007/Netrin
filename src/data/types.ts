export type LocaleCode = 'zh-CN' | 'en'

export type LocalizedText = Record<LocaleCode, string>

export type Coordinate = [number, number]

export type RouteShell = {
  id: string
  title: LocalizedText
  description: LocalizedText
  author: string
  ownerId?: string
  isPublic?: boolean
  createdAt?: string
  updatedAt?: string
}

export type CoordinateSystem = 'WGS-84' | 'GCJ-02'

export const MAX_POINT_MEDIA = 8
export const MAX_ROUTE_MEDIA_BYTES = 5 * 1024 * 1024

export const ROUTE_DRAFT_VERSION = 5 as const

export type AuthoringMode = 'map' | 'field' | 'import' | 'ai'

export type RouteProvider = 'amap-walking' | 'amap-cycling'

export type TravelMode = 'walking' | 'cycling'

export type RoutePlanPurpose = 'authoring' | 'guidance' | 'preview'

export type GeometrySource =
  | 'amap-planned'
  | 'field-recorded'
  | 'gpx-import'
  | 'geojson-import'
  | 'legacy-point-chain'

export type RouteDifficulty = 'easy' | 'moderate' | 'hard'

export type GeometryStatus = 'missing' | 'pending' | 'confirmed'

export type Wgs84LineString = {
  type: 'LineString'
  coordinates: Coordinate[]
}

export type RouteGeometryCandidate = {
  geometry: Wgs84LineString
  source: GeometrySource
  distanceM?: number
  durationS?: number
  generatedAt: string
}

export type RouteImportSummary = {
  format: 'gpx' | 'geojson'
  fileName: string
  selectedTrackName?: string
  originalCoordinateCount: number
  coordinateCount: number
  simplified: boolean
  strippedMetadata: string[]
}

export type AiGenerationProvenance = {
  inputKind: 'prompt' | 'file'
  generatedAt: string
  sourceRefs: Array<{
    kind: 'file-name'
    label: string
  }>
  candidateCount: number
  ambiguityCount: number
  harnessVersion: string
  promptVersion: string
}

export type ModerationStatus = 'pending' | 'approved' | 'rejected'

/** Accept legacy wire/storage fields; return sole runtime highlight label. */
export function resolveHighlightTitle(input: {
  highlightTitle?: string | null
  speciesName?: string | null
  title?: string | null
}): string | undefined {
  for (const value of [input.highlightTitle, input.speciesName, input.title]) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed.slice(0, 160)
  }
  return undefined
}

/** Runtime-only fields from mixed legacy/wire input. Never returns speciesName. */
export function readHighlightFields(input: {
  highlightTitle?: string | null
  speciesName?: string | null
  title?: string | null
  category?: string | null
}): {
  highlightTitle?: string
  category?: string
} {
  const highlightTitle = resolveHighlightTitle(input)
  const category =
    typeof input.category === 'string'
      ? input.category.trim() || undefined
      : undefined
  return {
    ...(highlightTitle ? { highlightTitle } : {}),
    ...(category !== undefined ? { category } : {})
  }
}

export type DraftSyncState =
  | 'local'
  | 'uploading'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'failed'

export type RouteSegmentKind = 'network'

export type RouteSegmentPart = {
  coordinates: Coordinate[]
  kind: RouteSegmentKind
  distanceMeters: number
}

export type RoutePlanStep = {
  instruction: string
  distanceMeters: number
  durationSeconds?: number
  coordinates: Coordinate[]
}

/** Provider-derived route leg. Runtime-only: never write this shape to storage. */
export type RoutePlanLeg = {
  id: string
  fromPointId: string
  toPointId: string
  coordinates: Coordinate[]
  kind: RouteSegmentKind
  distanceMeters: number
  snapDistanceMeters?: { from: number; to: number }
  parts?: RouteSegmentPart[]
  /** Converted back at the provider boundary; the runtime geometry is WGS-84. */
  coordSystem?: 'WGS-84'
  provider?: RouteProvider
  plannedAt?: string
  durationSeconds?: number
  steps?: RoutePlanStep[]
}

/** @deprecated Runtime-only compatibility name; use RoutePlanLeg. */
export type WalkingLeg = RoutePlanLeg

/** @deprecated Runtime-only compatibility name; persistence types never reference it. */
export type RouteSegment = RoutePlanLeg

export type RecordedPoint = {
  id: string
  index: number
  raw: Coordinate
  final: Coordinate
  accuracy?: number
  snapped: boolean
  text: string
  highlightTitle?: string
  category?: string
  media: RoutePointMedia[]
  /** @deprecated v1 draft field; removed while hydrating IndexedDB. */
  photoId?: string
}

export type RoutePointMedia = {
  id: string
  order: number
  /** Local IndexedDB blob identifier. */
  photoId?: string
  /** Supabase Storage object path. */
  storagePath?: string
  /** Resolved read URL; never persisted as route geometry. */
  url?: string
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp'
  width?: number
  height?: number
  /**
   * Object byte length from Storage metadata or a measured blob.
   * Safe to persist for package size estimates; not a signed URL.
   */
  sizeBytes?: number
}

export type RoutePoint = {
  id: string
  order: number
  location: Coordinate
  title: LocalizedText
  description: LocalizedText
  highlightTitle?: string
  category?: string
  media: RoutePointMedia[]
}

export type TrailRoute = RouteShell & {
  stops: string[]
}

export type TrailStop = {
  id: string
  title: LocalizedText
  description: LocalizedText
  location: Coordinate
  species: string[]
  photoUrl?: string
  order: number
  tags: string[]
}

export type NatureData = {
  routes: TrailRoute[]
  stops: TrailStop[]
}

export type RouteDraft = {
  version: typeof ROUTE_DRAFT_VERSION
  id: string
  authoringMode: AuthoringMode
  title: string
  note: string
  points: RecordedPoint[]
  snapToRoads: boolean
  travelMode: TravelMode
  geometryStatus: GeometryStatus
  geometryCandidate?: RouteGeometryCandidate
  importSummary?: RouteImportSummary
  aiProvenance?: AiGenerationProvenance
  geometry?: Wgs84LineString
  geometrySource?: GeometrySource
  cityAdcode?: string
  cityName?: string
  distanceM?: number
  durationS?: number
  metricsUpdatedAt?: string
  difficulty?: RouteDifficulty | null
  isLoop?: boolean
  tags?: string[]
  coverMediaId?: string
  syncState: DraftSyncState
  remoteId?: string
  rejectionReason?: string
  createdAt: string
  updatedAt: string
}

export type OwnedRouteSubmission = {
  id: string
  title: LocalizedText
  description: LocalizedText
  moderationStatus: ModerationStatus
  rejectionReason?: string
  createdAt: string
  updatedAt: string
}

/** Legacy / wire stop shape (may carry speciesName for migration only). */
export type RouteStopInline = {
  id?: string
  lng: number
  lat: number
  text?: string
  highlightTitle?: string
  speciesName?: string
  category?: string
  media?: Array<{
    id?: string
    order: number
    storagePath: string
    mimeType?: string
    width?: number
    height?: number
    sizeBytes?: number
  }>
  /** @deprecated v1 single-photo field. */
  photo?: string
}

/** Route detail/admin highlight wire; legacy servers may still include speciesName during observation. */
export type RoutePublicV2PointRow = {
  id: string
  order: number
  lng: number
  lat: number
  title?: string | null
  text?: string | null
  highlightTitle?: string | null
  speciesName?: string | null
  category?: string | null
  media?: Array<{
    id: string
    order: number
    /** Present only in owner/admin projections; public projections expose ids. */
    storagePath?: string
    /** Short-lived URL resolved by the media authorization function. */
    url?: string
    mimeType?: string | null
    width?: number | null
    height?: number | null
    /** Storage object byte length when known; never a storage path. */
    sizeBytes?: number | null
  }> | null
}

/** Author-confirmed geometry + meta for submit_route_v4. */
export type SubmitRouteV4Meta = {
  travelMode: TravelMode
  cityAdcode?: string
  cityName?: string
  geometry: Wgs84LineString
  geometrySource: GeometrySource
  distanceM?: number
  durationS?: number
  difficulty?: RouteDifficulty | null
  isLoop?: boolean
  tags?: string[]
  coverMediaId?: string
}

/** 下载到本地的路线（前端消费形态）。stops 是内联的，不是 id 引用。 */
export type DownloadedStop = RoutePoint & {
  /** @deprecated v1 downloaded record field; normalized into media. */
  photoUrl?: string
}

/**
 * Local offline package metadata for a downloaded route.
 * Phase 1 packages contain geometry and text only. Media stays online-only.
 */
export type OfflinePackageMeta = {
  version: 2
  packagedAt: string
  /** UTF-8 byte length of geometry + textual fields (via TextEncoder). */
  geometryTextBytes: number
}

export type DownloadedRoute = RouteShell & {
  remoteRouteId?: string
  stops: DownloadedStop[]
  travelMode?: TravelMode
  geometry?: Wgs84LineString
  geometrySource?: GeometrySource
  cityAdcode?: string
  cityName?: string
  distanceM?: number
  durationS?: number
  metricsUpdatedAt?: string
  difficulty?: RouteDifficulty | null
  isLoop?: boolean
  tags?: string[]
  coverMediaId?: string
  downloadedAt: string
  localEditedAt?: string
  isLocalEdited?: boolean
  remoteUpdatedAt?: string
  /** Reader media selection and package size snapshot for offline reuse. */
  offlinePackage?: OfflinePackageMeta
}

/** Home 地图导览消费的归一化激活路线（随包路线与下载路线都映射到它）。 */
export type ActiveStop = RoutePoint & {
  /** Legacy convenience fields, populated only while migrating old records. */
  photoUrl?: string
  photoId?: string
}

export type ActiveRouteView = {
  id: string
  title: LocalizedText
  description: LocalizedText
  stops: ActiveStop[]
  author?: string
  travelMode: TravelMode
  geometry?: Wgs84LineString
  geometrySource?: GeometrySource
  cityAdcode?: string
  cityName?: string
  distanceM?: number
  durationS?: number
  difficulty?: RouteDifficulty | null
  isLoop?: boolean
  tags?: string[]
  coverMediaId?: string
}

export type CommunityRouteDetail = ActiveRouteView & {
  author: string
  downloads: number
  createdAt?: string
  updatedAt?: string
  metricsUpdatedAt?: string
}

export type RouteBounds = {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

export type DiscoveryCursor = {
  createdAt: string
  id: string
}

export type DiscoveryQuery = {
  cursor?: DiscoveryCursor
  limit?: number
  cityAdcode?: string
  travelMode?: TravelMode
  minDistanceM?: number
  maxDistanceM?: number
  minDurationS?: number
  maxDurationS?: number
  difficulty?: RouteDifficulty
  tags?: string[]
  bounds?: RouteBounds
}

export type RouteSummary = {
  id: string
  author: string
  title: LocalizedText
  description: LocalizedText
  downloads: number
  createdAt: string
  updatedAt?: string
  travelMode: TravelMode
  cityAdcode?: string
  cityName?: string
  distanceM?: number
  durationS?: number
  metricsUpdatedAt?: string
  difficulty?: RouteDifficulty | null
  isLoop?: boolean
  tags: string[]
  coverMediaId?: string
  coverUrl?: string
  bounds?: RouteBounds
  pointCount: number
  recommendationReason?: 'nearby' | 'city' | 'new' | 'popular'
}

export type RecommendationBasis = 'nearby' | 'city' | 'new' | 'popular'

export const MAP_STYLE_IDS = [
  'normal',
  'dark',
  'light',
  'fresh',
  'grey',
  'macaron',
  'darkblue'
] as const

export type MapStyleId = (typeof MAP_STYLE_IDS)[number]

export type AppearanceSettings = {
  mapStyleId: MapStyleId
  appearanceId: string
}
