import distance from '@turf/distance'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import { point } from '@turf/helpers'
import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { Coordinate } from '../data/types'

/** Distance within which a nearest path is applied as the snapped point. */
export const SNAP_APPLY_THRESHOLD_METERS = 15
/** Spatial probe used to find candidate paths before applying the 15 m threshold. */
export const SNAP_PROBE_RADIUS_METERS = 50
/** GPS accuracy worse than this skips snapping and retains the raw fix. */
export const SNAP_LOW_ACCURACY_METERS = 50

export type SnapReason =
  | 'snapped'
  | 'over-threshold'
  | 'outside-coverage'
  | 'no-nearby-path'
  | 'path-data-unavailable'
  | 'low-accuracy'

export type SnapResult = {
  /** Coordinate to use (snapped or raw). Callers that only read final/snapped stay compatible. */
  final: Coordinate
  snapped: boolean
  /** Meters to the nearest probed path when known; otherwise null. */
  distance: number | null
  reason: SnapReason
}

export type SnapPointOptions = {
  thresholdMeters?: number
  probeRadiusMeters?: number
  accuracyMeters?: number
}

type CampusPaths = FeatureCollection<LineString>

type IndexedPath = {
  feature: Feature<LineString>
  minLongitude: number
  minLatitude: number
  maxLongitude: number
  maxLatitude: number
}

type PathsLoadState =
  | { status: 'ok'; paths: IndexedPath[]; coverage: CoverageBox }
  | { status: 'unavailable' }

type CoverageBox = {
  minLongitude: number
  minLatitude: number
  maxLongitude: number
  maxLatitude: number
}

let pathsPromise: Promise<PathsLoadState> | null = null
const CAMPUS_PATHS_URL = `${import.meta.env.BASE_URL}data/campus-paths.json`

function indexPath(feature: Feature<LineString>): IndexedPath | null {
  const coordinates = feature.geometry?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null

  let minLongitude = Number.POSITIVE_INFINITY
  let minLatitude = Number.POSITIVE_INFINITY
  let maxLongitude = Number.NEGATIVE_INFINITY
  let maxLatitude = Number.NEGATIVE_INFINITY

  for (const coordinate of coordinates) {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length < 2 ||
      typeof coordinate[0] !== 'number' ||
      typeof coordinate[1] !== 'number' ||
      !Number.isFinite(coordinate[0]) ||
      !Number.isFinite(coordinate[1])
    ) {
      return null
    }
    minLongitude = Math.min(minLongitude, coordinate[0])
    minLatitude = Math.min(minLatitude, coordinate[1])
    maxLongitude = Math.max(maxLongitude, coordinate[0])
    maxLatitude = Math.max(maxLatitude, coordinate[1])
  }

  return { feature, minLongitude, minLatitude, maxLongitude, maxLatitude }
}

function buildCoverage(paths: IndexedPath[]): CoverageBox {
  let minLongitude = Number.POSITIVE_INFINITY
  let minLatitude = Number.POSITIVE_INFINITY
  let maxLongitude = Number.NEGATIVE_INFINITY
  let maxLatitude = Number.NEGATIVE_INFINITY
  for (const path of paths) {
    minLongitude = Math.min(minLongitude, path.minLongitude)
    minLatitude = Math.min(minLatitude, path.minLatitude)
    maxLongitude = Math.max(maxLongitude, path.maxLongitude)
    maxLatitude = Math.max(maxLatitude, path.maxLatitude)
  }
  return { minLongitude, minLatitude, maxLongitude, maxLatitude }
}

function isValidPathCollection(value: unknown): value is CampusPaths {
  if (!value || typeof value !== 'object') return false
  const collection = value as Partial<CampusPaths>
  return collection.type === 'FeatureCollection' && Array.isArray(collection.features)
}

function expandDeltaMeters(latitude: number, meters: number): { latitudeDelta: number; longitudeDelta: number } {
  const latitudeDelta = meters / 111_320
  const longitudeDelta = meters / (111_320 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)))
  return { latitudeDelta, longitudeDelta }
}

function isOutsideCoverage(raw: Coordinate, coverage: CoverageBox, probeRadiusMeters: number): boolean {
  const { latitudeDelta, longitudeDelta } = expandDeltaMeters(raw[1], probeRadiusMeters)
  return (
    raw[0] < coverage.minLongitude - longitudeDelta ||
    raw[0] > coverage.maxLongitude + longitudeDelta ||
    raw[1] < coverage.minLatitude - latitudeDelta ||
    raw[1] > coverage.maxLatitude + latitudeDelta
  )
}

function filterCandidates(
  paths: IndexedPath[],
  raw: Coordinate,
  probeRadiusMeters: number
): IndexedPath[] {
  const { latitudeDelta, longitudeDelta } = expandDeltaMeters(raw[1], probeRadiusMeters)
  return paths.filter(
    (path) =>
      raw[0] >= path.minLongitude - longitudeDelta &&
      raw[0] <= path.maxLongitude + longitudeDelta &&
      raw[1] >= path.minLatitude - latitudeDelta &&
      raw[1] <= path.maxLatitude + latitudeDelta
  )
}

async function loadCampusPaths(): Promise<PathsLoadState> {
  if (!pathsPromise) {
    pathsPromise = fetch(CAMPUS_PATHS_URL)
      .then(async (response) => {
        if (!response.ok) return { status: 'unavailable' } as const
        const payload: unknown = await response.json()
        if (!isValidPathCollection(payload)) return { status: 'unavailable' } as const
        const paths = payload.features
          .map((feature) => indexPath(feature as Feature<LineString>))
          .filter((path): path is IndexedPath => path !== null)
        if (paths.length === 0) return { status: 'unavailable' } as const
        return { status: 'ok', paths, coverage: buildCoverage(paths) } as const
      })
      .catch(() => ({ status: 'unavailable' }) as const)
  }
  return pathsPromise
}

function resolveOptions(
  thresholdOrOptions: number | SnapPointOptions = SNAP_APPLY_THRESHOLD_METERS
): Required<Pick<SnapPointOptions, 'thresholdMeters' | 'probeRadiusMeters'>> &
  Pick<SnapPointOptions, 'accuracyMeters'> {
  if (typeof thresholdOrOptions === 'number') {
    return {
      thresholdMeters: thresholdOrOptions,
      probeRadiusMeters: SNAP_PROBE_RADIUS_METERS
    }
  }
  return {
    thresholdMeters: thresholdOrOptions.thresholdMeters ?? SNAP_APPLY_THRESHOLD_METERS,
    probeRadiusMeters: thresholdOrOptions.probeRadiusMeters ?? SNAP_PROBE_RADIUS_METERS,
    accuracyMeters: thresholdOrOptions.accuracyMeters
  }
}

function rawResult(raw: Coordinate, reason: Exclude<SnapReason, 'snapped' | 'over-threshold'>, distanceMeters: number | null = null): SnapResult {
  return { final: raw, snapped: false, distance: distanceMeters, reason }
}

/**
 * Best-effort offline path snap. Keeps raw WGS-84 coordinates when path data is
 * missing, out of coverage, beyond the apply threshold, or GPS accuracy is poor.
 */
export async function snapPoint(
  raw: Coordinate,
  thresholdOrOptions: number | SnapPointOptions = SNAP_APPLY_THRESHOLD_METERS
): Promise<SnapResult> {
  const { thresholdMeters, probeRadiusMeters, accuracyMeters } = resolveOptions(thresholdOrOptions)

  if (typeof accuracyMeters === 'number' && accuracyMeters > SNAP_LOW_ACCURACY_METERS) {
    return rawResult(raw, 'low-accuracy')
  }

  const loaded = await loadCampusPaths()
  if (loaded.status === 'unavailable') {
    return rawResult(raw, 'path-data-unavailable')
  }

  if (isOutsideCoverage(raw, loaded.coverage, probeRadiusMeters)) {
    return rawResult(raw, 'outside-coverage')
  }

  const candidates = filterCandidates(loaded.paths, raw, probeRadiusMeters)
  if (candidates.length === 0) {
    return rawResult(raw, 'no-nearby-path')
  }

  const rawFeature = point(raw)
  let best: Coordinate | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const path of candidates) {
    const candidate = nearestPointOnLine(path.feature, rawFeature)
    const candidateCoordinate = candidate.geometry.coordinates as Coordinate
    const meters = distance(rawFeature, candidate, { units: 'meters' })
    if (meters < bestDistance) {
      bestDistance = meters
      best = candidateCoordinate
    }
  }

  if (!best || !Number.isFinite(bestDistance)) {
    return rawResult(raw, 'no-nearby-path')
  }

  // Probe can admit a bbox-near path whose true geodesic distance exceeds the probe.
  if (bestDistance > probeRadiusMeters) {
    return rawResult(raw, 'no-nearby-path', bestDistance)
  }

  if (bestDistance > thresholdMeters) {
    return {
      final: raw,
      snapped: false,
      distance: bestDistance,
      reason: 'over-threshold'
    }
  }

  return {
    final: best,
    snapped: true,
    distance: bestDistance,
    reason: 'snapped'
  }
}

/** Test-only: drop the cached path index so the next call reloads. */
export function resetSnapPathCacheForTests(): void {
  pathsPromise = null
}
