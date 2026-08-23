import localforage from 'localforage'
import type {
  AuthoringMode,
  AiGenerationProvenance,
  Coordinate,
  GeometrySource,
  GeometryStatus,
  RecordedPoint,
  RouteDifficulty,
  RouteDraft,
  RouteGeometryCandidate,
  RouteImportSummary,
  RoutePointMedia,
  RouteStopInline,
  TravelMode,
  Wgs84LineString
} from './types'
import {
  ROUTE_DRAFT_VERSION,
  readHighlightFields
} from './types'

const LEGACY_ROUTE_DRAFTS_KEY = 'netrin.routeDrafts'
const ROUTE_DRAFTS_KEY = 'routeDrafts'

const GEOMETRY_SOURCES = new Set<GeometrySource>([
  'amap-planned',
  'field-recorded',
  'gpx-import',
  'geojson-import',
  'legacy-point-chain'
])

const TRAVEL_MODES = new Set<TravelMode>(['walking', 'cycling'])
const DIFFICULTIES = new Set<RouteDifficulty>(['easy', 'moderate', 'hard'])
const AUTHORING_MODES = new Set<AuthoringMode>(['map', 'field', 'import', 'ai'])

export const draftsStore = localforage.createInstance({
  name: 'netrin',
  storeName: 'drafts',
  description: 'Netrin route drafts and point media'
})

export const mediaStore = localforage.createInstance({
  name: 'netrin',
  storeName: 'media',
  description: 'Netrin draft photo blobs'
})

type LegacyRouteDraft = {
  id?: unknown
  title?: unknown
  note?: unknown
  snapToRoads?: unknown
  createdAt?: unknown
  waypoints?: unknown
  stops?: unknown
}

function isCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  )
}

function isLegacyStop(value: unknown): value is RouteStopInline {
  if (!value || typeof value !== 'object') return false
  const stop = value as Partial<RouteStopInline>
  return typeof stop.lng === 'number' && typeof stop.lat === 'number'
}

function isWgs84LineString(value: unknown): value is Wgs84LineString {
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

function normalizeGeometryCandidate(value: unknown): RouteGeometryCandidate | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const geometry = isWgs84LineString(raw.geometry) ? raw.geometry : undefined
  const source =
    typeof raw.source === 'string' && GEOMETRY_SOURCES.has(raw.source as GeometrySource)
      ? raw.source as GeometrySource
      : undefined
  if (!geometry || !source) return undefined
  return {
    geometry,
    source,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    distanceM:
      typeof raw.distanceM === 'number' && Number.isFinite(raw.distanceM) && raw.distanceM >= 0
        ? raw.distanceM
        : undefined,
    durationS:
      typeof raw.durationS === 'number' && Number.isFinite(raw.durationS) && raw.durationS >= 0
        ? raw.durationS
        : undefined
  }
}

function normalizeImportSummary(value: unknown): RouteImportSummary | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (raw.format !== 'gpx' && raw.format !== 'geojson') return undefined
  if (typeof raw.fileName !== 'string') return undefined
  const originalCoordinateCount =
    typeof raw.originalCoordinateCount === 'number' && Number.isFinite(raw.originalCoordinateCount)
      ? Math.max(0, Math.round(raw.originalCoordinateCount))
      : 0
  const coordinateCount =
    typeof raw.coordinateCount === 'number' && Number.isFinite(raw.coordinateCount)
      ? Math.max(0, Math.round(raw.coordinateCount))
      : 0
  return {
    format: raw.format,
    fileName: raw.fileName.slice(0, 240),
    selectedTrackName:
      typeof raw.selectedTrackName === 'string' ? raw.selectedTrackName.slice(0, 160) : undefined,
    originalCoordinateCount,
    coordinateCount,
    simplified: raw.simplified === true,
    strippedMetadata: Array.isArray(raw.strippedMetadata)
      ? raw.strippedMetadata.filter((item): item is string => typeof item === 'string').slice(0, 20)
      : []
  }
}

function normalizeAiProvenance(value: unknown): AiGenerationProvenance | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (!['prompt', 'file'].includes(String(raw.inputKind))) return undefined
  const short = (input: unknown, maximum: number): string | undefined =>
    typeof input === 'string' && input.trim() ? input.trim().slice(0, maximum) : undefined
  const generatedAt = short(raw.generatedAt, 80)
  const harnessVersion = short(raw.harnessVersion, 120)
  const promptVersion = short(raw.promptVersion, 120)
  if (!generatedAt || !harnessVersion || !promptVersion) return undefined
  const sourceRefs = Array.isArray(raw.sourceRefs)
    ? raw.sourceRefs.flatMap((value): AiGenerationProvenance['sourceRefs'] => {
        if (!value || typeof value !== 'object') return []
        const source = value as Record<string, unknown>
        if (source.kind !== 'file-name') return []
        const label = short(source.label, 240)
        if (!label || /[\\/]/.test(label)) return []
        return [{ kind: source.kind as AiGenerationProvenance['sourceRefs'][number]['kind'], label }]
      }).slice(0, 20)
    : []
  const count = (input: unknown) =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0
      ? Math.min(100, Math.round(input))
      : 0
  return {
    inputKind: raw.inputKind as AiGenerationProvenance['inputKind'],
    generatedAt,
    sourceRefs,
    candidateCount: count(raw.candidateCount),
    ambiguityCount: count(raw.ambiguityCount),
    harnessVersion,
    promptVersion
  }
}

/** v3: preserve trimmed strings (incl. empty/dup/long/>10) for publish rejection. */
function normalizeTags(value: unknown, preserveInvalid: boolean): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (preserveInvalid) {
    const tags: string[] = []
    for (const item of value) {
      if (typeof item === 'string') tags.push(item.trim())
    }
    return tags
  }
  return undefined
}

function draftDefaults(): Pick<
  RouteDraft,
  | 'version'
  | 'authoringMode'
  | 'travelMode'
  | 'geometryStatus'
  | 'geometryCandidate'
  | 'importSummary'
  | 'aiProvenance'
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
> {
  return {
    version: ROUTE_DRAFT_VERSION,
    authoringMode: 'field',
    travelMode: 'walking',
    geometryStatus: 'missing',
    geometryCandidate: undefined,
    importSummary: undefined,
    aiProvenance: undefined,
    geometry: undefined,
    geometrySource: undefined,
    cityAdcode: undefined,
    cityName: undefined,
    distanceM: undefined,
    durationS: undefined,
    metricsUpdatedAt: undefined,
    difficulty: undefined,
    isLoop: undefined,
    tags: undefined,
    coverMediaId: undefined
  }
}

export function migrateLegacyDraft(value: LegacyRouteDraft, fallbackIndex: number): RouteDraft {
  const now = new Date().toISOString()
  const id = typeof value.id === 'string' ? value.id : `migrated-${Date.now()}-${fallbackIndex}`
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : now
  const waypoints = Array.isArray(value.waypoints) ? value.waypoints.filter(isCoordinate) : []
  const stops = Array.isArray(value.stops) ? value.stops.filter(isLegacyStop) : []
  const points: RecordedPoint[] = waypoints.map((coordinate, index) => {
    const stop = stops[index]
    const fields = readHighlightFields({
      highlightTitle: stop?.highlightTitle,
      speciesName: stop?.speciesName,
      category: stop?.category
    })
    const legacyPhoto =
      typeof stop?.photo === 'string'
        ? stop.photo
        : undefined
    const stopRecord = stop as (RouteStopInline & { order?: unknown }) | undefined
    const stopOrder =
      typeof stopRecord?.order === 'number' &&
      Number.isFinite(stopRecord.order) &&
      stopRecord.order > 0
        ? stopRecord.order
        : index + 1
    return {
      id: typeof stop?.id === 'string' ? stop.id : `${id}-point-${index + 1}`,
      index: stopOrder,
      raw: coordinate,
      final: coordinate,
      snapped: false,
      text: stop?.text ?? '',
      ...fields,
      media: normalizeMedia(stop?.media, legacyPhoto)
    }
  })

  return {
    ...draftDefaults(),
    id,
    title: typeof value.title === 'string' ? value.title : '',
    note: typeof value.note === 'string' ? value.note : '',
    points,
    snapToRoads: value.snapToRoads !== false,
    syncState: 'local',
    createdAt,
    updatedAt: createdAt
  }
}

function normalizeMedia(value: unknown, legacyPhotoId?: string): RoutePointMedia[] {
  const raw = Array.isArray(value) ? value : []
  const media = raw.flatMap((item, index): RoutePointMedia[] => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Partial<RoutePointMedia>
    const photoId = typeof candidate.photoId === 'string' ? candidate.photoId : undefined
    const storagePath = typeof candidate.storagePath === 'string' ? candidate.storagePath : undefined
    const url = typeof candidate.url === 'string' ? candidate.url : undefined
    if (!photoId && !storagePath && !url) return []
    return [{
      id: typeof candidate.id === 'string' ? candidate.id : `media-${index + 1}`,
      order:
        typeof candidate.order === 'number' && Number.isFinite(candidate.order) && candidate.order > 0
          ? candidate.order
          : index + 1,
      photoId,
      storagePath,
      url,
      mimeType:
        candidate.mimeType === 'image/jpeg' ||
        candidate.mimeType === 'image/png' ||
        candidate.mimeType === 'image/webp'
          ? candidate.mimeType
          : undefined,
      width: typeof candidate.width === 'number' ? candidate.width : undefined,
      height: typeof candidate.height === 'number' ? candidate.height : undefined
    }]
  })
  if (media.length === 0 && legacyPhotoId) {
    media.push({ id: legacyPhotoId, order: 1, photoId: legacyPhotoId })
  }
  // Draft media is not capped here; publish validation rejects >8.
  return media
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: item.order > 0 ? item.order : index + 1 }))
}

function normalizeRecordedPoint(value: unknown, index: number): RecordedPoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const point = value as RecordedPoint & {
    speciesName?: unknown
    highlightTitle?: unknown
    category?: unknown
    photoId?: unknown
  }
  const raw = isCoordinate(point.raw) ? point.raw : undefined
  const final = isCoordinate(point.final) ? point.final : raw
  if (!raw || !final) return undefined
  const fields = readHighlightFields({
    highlightTitle: typeof point.highlightTitle === 'string' ? point.highlightTitle : undefined,
    speciesName: typeof point.speciesName === 'string' ? point.speciesName : undefined,
    category: typeof point.category === 'string' ? point.category : undefined
  })
  const storedIndex =
    typeof point.index === 'number' && Number.isFinite(point.index) && point.index > 0
      ? point.index
      : index + 1
  return {
    id: typeof point.id === 'string' ? point.id : `point-${index + 1}`,
    index: storedIndex,
    raw,
    final,
    accuracy: typeof point.accuracy === 'number' ? point.accuracy : undefined,
    snapped: point.snapped === true,
    text: typeof point.text === 'string' ? point.text : '',
    ...fields,
    media: normalizeMedia(
      point.media,
      typeof point.photoId === 'string' ? point.photoId : undefined
    )
  }
}

export function createEmptyRouteDraft(input: {
  id: string
  authoringMode?: AuthoringMode
  title?: string
  note?: string
  snapToRoads?: boolean
  now?: string
}): RouteDraft {
  const now = input.now ?? new Date().toISOString()
  return {
    ...draftDefaults(),
    id: input.id,
    authoringMode: input.authoringMode ?? 'field',
    title: input.title ?? '',
    note: input.note ?? '',
    points: [],
    snapToRoads: input.snapToRoads !== false,
    syncState: 'local',
    createdAt: now,
    updatedAt: now
  }
}

export function normalizeRouteDraftRecord(value: unknown): RouteDraft {
  const now = new Date().toISOString()
  const raw =
    value && typeof value === 'object'
      ? (value as Record<string, unknown> & { segments?: unknown; points?: unknown })
      : {}
  const { segments: _legacySegments, ...rest } = raw
  const points = Array.isArray(raw.points)
    ? raw.points.flatMap((point, index) => {
        const normalized = normalizeRecordedPoint(point, index)
        return normalized ? [normalized] : []
      })
    : []

  const syncState =
    (raw.syncState as string) === 'published'
      ? 'approved'
      : typeof raw.syncState === 'string' &&
          ['local', 'uploading', 'pending', 'approved', 'rejected', 'failed'].includes(raw.syncState)
        ? (raw.syncState as RouteDraft['syncState'])
        : 'local'

  const base = {
    version: ROUTE_DRAFT_VERSION,
    id: typeof raw.id === 'string' ? raw.id : `draft-${Date.now()}`,
    authoringMode:
      typeof raw.authoringMode === 'string' && AUTHORING_MODES.has(raw.authoringMode as AuthoringMode)
        ? raw.authoringMode as AuthoringMode
        : 'field',
    title: typeof raw.title === 'string' ? raw.title : '',
    note: typeof raw.note === 'string' ? raw.note : '',
    points,
    snapToRoads: raw.snapToRoads !== false,
    syncState,
    remoteId: typeof raw.remoteId === 'string' ? raw.remoteId : undefined,
    rejectionReason: typeof raw.rejectionReason === 'string' ? raw.rejectionReason : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  }

  const isSupportedVersion = raw.version === 3 || raw.version === 4 || raw.version === ROUTE_DRAFT_VERSION

  // Versionless / older drafts: strip all M1 geometry/mode metadata.
  if (!isSupportedVersion) {
    void rest
    return {
      ...draftDefaults(),
      ...base,
      travelMode: 'walking',
      geometryStatus: 'missing',
      geometryCandidate: undefined,
      importSummary: undefined,
      aiProvenance: undefined,
      geometry: undefined,
      geometrySource: undefined,
      tags: undefined
    }
  }

  const geometry = isWgs84LineString(raw.geometry) ? raw.geometry : undefined
  const geometrySource =
    typeof raw.geometrySource === 'string' && GEOMETRY_SOURCES.has(raw.geometrySource as GeometrySource)
      ? (raw.geometrySource as GeometrySource)
      : undefined
  const requestedConfirmed = raw.geometryStatus === 'confirmed'
  const requestedPending = raw.geometryStatus === 'pending'
  const travelMode =
    typeof raw.travelMode === 'string' && TRAVEL_MODES.has(raw.travelMode as TravelMode)
      ? (raw.travelMode as TravelMode)
      : 'walking'

  const difficulty =
    raw.difficulty === null
      ? null
      : typeof raw.difficulty === 'string' && DIFFICULTIES.has(raw.difficulty as RouteDifficulty)
        ? (raw.difficulty as RouteDifficulty)
        : undefined

  // Explicit confirmed stays confirmed even if geometry/source failed parse (publish rejects).
  const geometryStatus: GeometryStatus = requestedConfirmed
    ? 'confirmed'
    : requestedPending
      ? 'pending'
      : 'missing'

  void rest
  return {
    ...base,
    travelMode,
    geometryStatus,
    geometryCandidate:
      raw.version === 4 || raw.version === ROUTE_DRAFT_VERSION
        ? normalizeGeometryCandidate(raw.geometryCandidate)
        : undefined,
    importSummary:
      raw.version === 4 || raw.version === ROUTE_DRAFT_VERSION
        ? normalizeImportSummary(raw.importSummary)
        : undefined,
    aiProvenance:
      raw.version === ROUTE_DRAFT_VERSION && base.authoringMode === 'ai'
        ? normalizeAiProvenance(raw.aiProvenance)
        : undefined,
    geometry: requestedConfirmed ? geometry : undefined,
    geometrySource: requestedConfirmed ? geometrySource : undefined,
    cityAdcode: typeof raw.cityAdcode === 'string' ? raw.cityAdcode : undefined,
    cityName: typeof raw.cityName === 'string' ? raw.cityName : undefined,
    distanceM:
      typeof raw.distanceM === 'number' && Number.isFinite(raw.distanceM) && raw.distanceM >= 0
        ? raw.distanceM
        : undefined,
    durationS:
      typeof raw.durationS === 'number' && Number.isFinite(raw.durationS) && raw.durationS >= 0
        ? raw.durationS
        : undefined,
    metricsUpdatedAt: typeof raw.metricsUpdatedAt === 'string' ? raw.metricsUpdatedAt : undefined,
    difficulty,
    isLoop: typeof raw.isLoop === 'boolean' ? raw.isLoop : undefined,
    tags: normalizeTags(raw.tags, true),
    coverMediaId: typeof raw.coverMediaId === 'string' ? raw.coverMediaId : undefined
  }
}

export async function loadRouteDrafts(): Promise<RouteDraft[]> {
  let current: RouteDraft[] = []
  try {
    const stored = await draftsStore.getItem<unknown[]>(ROUTE_DRAFTS_KEY)
    current = Array.isArray(stored) ? stored.map(normalizeRouteDraftRecord) : []
  } catch {
    current = []
  }

  if (typeof window === 'undefined') return current
  let legacyRaw: string | null = null
  try {
    legacyRaw = window.localStorage.getItem(LEGACY_ROUTE_DRAFTS_KEY)
  } catch {
    return current
  }
  if (!legacyRaw) return current

  try {
    const parsed = JSON.parse(legacyRaw) as unknown
    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(LEGACY_ROUTE_DRAFTS_KEY)
      return current
    }

    const migrated = parsed.map((item, index) =>
      migrateLegacyDraft(
        item && typeof item === 'object' ? (item as LegacyRouteDraft) : {},
        index
      )
    )
    const knownIds = new Set(current.map((draft) => draft.id))
    const merged = [...migrated.filter((draft) => !knownIds.has(draft.id)), ...current]
    try {
      await draftsStore.setItem(ROUTE_DRAFTS_KEY, merged.map(normalizeRouteDraftRecord))
      window.localStorage.removeItem(LEGACY_ROUTE_DRAFTS_KEY)
    } catch {
      return current
    }
    return merged
  } catch {
    return current
  }
}

export async function saveRouteDrafts(drafts: RouteDraft[]): Promise<void> {
  try {
    await draftsStore.setItem(ROUTE_DRAFTS_KEY, drafts.map(normalizeRouteDraftRecord))
  } catch {
    // IndexedDB may be unavailable in private browsing or constrained WebViews.
  }
}

export async function saveMediaBlob(photoId: string, blob: Blob): Promise<void> {
  try {
    await mediaStore.setItem(photoId, blob)
  } catch {
    throw new Error('Media storage unavailable')
  }
}

export async function loadMediaBlob(photoId: string): Promise<Blob | null> {
  try {
    return (await mediaStore.getItem<Blob>(photoId)) ?? null
  } catch {
    return null
  }
}

export async function removeMediaBlob(photoId: string): Promise<void> {
  try {
    await mediaStore.removeItem(photoId)
  } catch {
    // Orphan cleanup is best-effort.
  }
}
