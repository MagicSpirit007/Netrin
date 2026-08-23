import type { Coordinate, RouteSegment, RouteSegmentPart } from '../../data/types'
import { distanceMeters, lineLengthMeters } from '../navigation/geo'

const DUPLICATE_POINT_THRESHOLD_METERS = 0.6

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
function cloneCoordinate(coordinate: Coordinate): Coordinate {
  return [coordinate[0], coordinate[1]]
}

function pushCoordinate(list: Coordinate[], coordinate: Coordinate) {
  const previous = list[list.length - 1]
  if (previous && distanceMeters(previous, coordinate) <= DUPLICATE_POINT_THRESHOLD_METERS) return
  list.push(cloneCoordinate(coordinate))
}

export function routeSegmentParts(segment: RouteSegment): RouteSegmentPart[] {
  const parts = Array.isArray(segment.parts)
    ? segment.parts.flatMap((part): RouteSegmentPart[] => {
        const coordinates = Array.isArray(part.coordinates)
          ? part.coordinates.filter(isCoordinate).map(cloneCoordinate)
          : []
        return coordinates.length >= 2
          ? [{ coordinates, kind: 'network', distanceMeters: lineLengthMeters(coordinates) }]
          : []
      })
    : []
  return parts.length > 0
    ? parts
    : [{
        coordinates: segment.coordinates.map(cloneCoordinate),
        kind: 'network',
        distanceMeters: lineLengthMeters(segment.coordinates)
      }]
}

export function normalizeRouteSegments(value: unknown): RouteSegment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): RouteSegment[] => {
    if (!item || typeof item !== 'object') return []
    const segment = item as Partial<RouteSegment>
    const coordinates = Array.isArray(segment.coordinates)
      ? segment.coordinates.filter(isCoordinate).map(cloneCoordinate)
      : []
    if (
      typeof segment.id !== 'string' ||
      typeof segment.fromPointId !== 'string' ||
      typeof segment.toPointId !== 'string' ||
      coordinates.length < 2
    ) {
      return []
    }
    return [{
      id: segment.id,
      fromPointId: segment.fromPointId,
      toPointId: segment.toPointId,
      coordinates,
      kind: 'network',
      distanceMeters:
        typeof segment.distanceMeters === 'number' && Number.isFinite(segment.distanceMeters)
          ? segment.distanceMeters
          : lineLengthMeters(coordinates),
      coordSystem: 'WGS-84',
      provider: segment.provider === 'amap-cycling' ? 'amap-cycling' : 'amap-walking',
      plannedAt: typeof segment.plannedAt === 'string' ? segment.plannedAt : undefined,
      durationSeconds:
        typeof segment.durationSeconds === 'number' && Number.isFinite(segment.durationSeconds)
          ? segment.durationSeconds
          : undefined,
      steps: Array.isArray(segment.steps) ? segment.steps : undefined
    }]
  })
}

export function routeLineFromSegments(segments: RouteSegment[]): Coordinate[] {
  const line: Coordinate[] = []
  normalizeRouteSegments(segments).forEach((segment) => {
    segment.coordinates.forEach((coordinate) => pushCoordinate(line, coordinate))
  })
  return line
}
