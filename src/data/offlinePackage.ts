import type {
  Coordinate,
  DownloadedRoute,
  LocalizedText,
  OfflinePackageMeta,
  Wgs84LineString
} from './types'

export const OFFLINE_PACKAGE_VERSION = 2 as const

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

function nonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

export type GeometryTextEstimateInput = {
  title?: LocalizedText
  description?: LocalizedText
  geometry?: Wgs84LineString
  cityAdcode?: string
  cityName?: string
  tags?: string[]
  stops?: Array<{
    title?: LocalizedText
    description?: LocalizedText
    highlightTitle?: string
    location?: Coordinate
    category?: string
  }>
}

/** Estimate only the persisted WGS-84 geometry and textual route fields. */
export function estimateGeometryTextBytes(route: GeometryTextEstimateInput): number {
  const payload = {
    title: route.title,
    description: route.description,
    geometry: route.geometry,
    cityAdcode: route.cityAdcode,
    cityName: route.cityName,
    tags: route.tags,
    stops: (route.stops ?? []).map((stop) => ({
      title: stop.title,
      description: stop.description,
      highlightTitle: stop.highlightTitle,
      location: stop.location,
      category: stop.category
    }))
  }
  return nonNegativeInt(utf8ByteLength(JSON.stringify(payload)))
}

export function isOfflinePackageComplete(
  meta: OfflinePackageMeta | undefined | null
): meta is OfflinePackageMeta {
  return Boolean(
    meta &&
    meta.version === OFFLINE_PACKAGE_VERSION &&
    typeof meta.packagedAt === 'string' &&
    meta.packagedAt.trim() &&
    isNonNegativeInt(meta.geometryTextBytes)
  )
}

export function parseUpdatedAtMs(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const milliseconds = Date.parse(value.trim())
  return Number.isFinite(milliseconds) ? milliseconds : undefined
}

export function isOfflinePackageStale(
  local: { remoteUpdatedAt?: string; offlinePackage?: OfflinePackageMeta },
  remoteUpdatedAt?: string
): boolean {
  if (!isOfflinePackageComplete(local.offlinePackage)) return true
  const remoteMs = parseUpdatedAtMs(remoteUpdatedAt)
  if (remoteMs === undefined) return false
  const localMs = parseUpdatedAtMs(local.remoteUpdatedAt)
  return localMs === undefined || remoteMs > localMs
}

export type OfflinePackageBuildInput = GeometryTextEstimateInput

export function buildOfflinePackageMeta(
  route: OfflinePackageBuildInput,
  packagedAt = new Date().toISOString()
): OfflinePackageMeta {
  return {
    version: OFFLINE_PACKAGE_VERSION,
    packagedAt,
    geometryTextBytes: estimateGeometryTextBytes(route)
  }
}

/**
 * Normalize v2 metadata. Legacy v1 image selections are deliberately discarded:
 * old route geometry/text remains usable, but no media cache is recreated.
 */
export function normalizeOfflinePackageMeta(value: unknown): OfflinePackageMeta | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as {
    version?: unknown
    packagedAt?: unknown
    geometryTextBytes?: unknown
  }
  if (raw.version !== 1 && raw.version !== OFFLINE_PACKAGE_VERSION) return undefined
  const candidate: OfflinePackageMeta = {
    version: OFFLINE_PACKAGE_VERSION,
    packagedAt: typeof raw.packagedAt === 'string' ? raw.packagedAt : '',
    geometryTextBytes: typeof raw.geometryTextBytes === 'number'
      ? nonNegativeInt(raw.geometryTextBytes)
      : Number.NaN
  }
  return isOfflinePackageComplete(candidate) ? candidate : undefined
}

export function estimateOfflinePackageBytes(route: GeometryTextEstimateInput): {
  geometryTextBytes: number
  totalKnownBytes: number
} {
  const geometryTextBytes = estimateGeometryTextBytes(route)
  return { geometryTextBytes, totalKnownBytes: geometryTextBytes }
}

export type OfflinePackageRouteLike = Pick<
  DownloadedRoute,
  | 'title'
  | 'description'
  | 'geometry'
  | 'cityAdcode'
  | 'cityName'
  | 'tags'
  | 'stops'
  | 'remoteUpdatedAt'
  | 'offlinePackage'
>
