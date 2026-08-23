import type { Coordinate } from '../../data/types'

export type LocationFix = {
  coordinate: Coordinate
  accuracy?: number
  heading?: number
  timestamp: number
}

export type SegmentProjection = {
  coordinate: Coordinate
  distanceMeters: number
  fraction: number
  segmentLengthMeters: number
}

export type LineProjection = SegmentProjection & {
  segmentIndex: number
  distanceAlongMeters: number
  lineLengthMeters: number
}

const EARTH_RADIUS_METERS = 6371008.8

const toRadians = (value: number) => (value * Math.PI) / 180
const toDegrees = (value: number) => (value * 180) / Math.PI
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

type LocalPoint = { x: number; y: number }

export function distanceMeters(from: Coordinate, to: Coordinate): number {
  const dLat = toRadians(to[1] - from[1])
  const dLng = toRadians(to[0] - from[0])
  const lat1 = toRadians(from[1])
  const lat2 = toRadians(to[1])
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function lineLengthMeters(line: Coordinate[]): number {
  let length = 0
  for (let index = 1; index < line.length; index += 1) {
    length += distanceMeters(line[index - 1], line[index])
  }
  return length
}

function toLocalMeters(point: Coordinate, origin: Coordinate): LocalPoint {
  const originLat = toRadians(origin[1])
  const cosLat = Math.max(Math.cos(originLat), 1e-9)
  return {
    x: toRadians(point[0] - origin[0]) * EARTH_RADIUS_METERS * cosLat,
    y: toRadians(point[1] - origin[1]) * EARTH_RADIUS_METERS
  }
}

function fromLocalMeters(point: LocalPoint, origin: Coordinate): Coordinate {
  const originLat = toRadians(origin[1])
  const cosLat = Math.max(Math.cos(originLat), 1e-9)
  return [
    origin[0] + toDegrees(point.x / (EARTH_RADIUS_METERS * cosLat)),
    origin[1] + toDegrees(point.y / EARTH_RADIUS_METERS)
  ]
}

export function projectPointToSegment(
  point: Coordinate,
  segmentStart: Coordinate,
  segmentEnd: Coordinate
): SegmentProjection {
  const start = toLocalMeters(segmentStart, segmentStart)
  const end = toLocalMeters(segmentEnd, segmentStart)
  const current = toLocalMeters(point, segmentStart)
  const segmentX = end.x - start.x
  const segmentY = end.y - start.y
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY

  if (segmentLengthSquared <= Number.EPSILON) {
    return {
      coordinate: segmentStart,
      distanceMeters: distanceMeters(point, segmentStart),
      fraction: 0,
      segmentLengthMeters: 0
    }
  }

  const fraction = clamp(
    ((current.x - start.x) * segmentX + (current.y - start.y) * segmentY) / segmentLengthSquared,
    0,
    1
  )
  const projectedLocal = {
    x: start.x + segmentX * fraction,
    y: start.y + segmentY * fraction
  }
  const projected = fromLocalMeters(projectedLocal, segmentStart)

  return {
    coordinate: projected,
    distanceMeters: distanceMeters(point, projected),
    fraction,
    segmentLengthMeters: distanceMeters(segmentStart, segmentEnd)
  }
}

export function projectPointToLine(point: Coordinate, line: Coordinate[]): LineProjection | undefined {
  if (line.length === 0) return undefined
  if (line.length === 1) {
    return {
      coordinate: line[0],
      distanceMeters: distanceMeters(point, line[0]),
      fraction: 0,
      segmentLengthMeters: 0,
      segmentIndex: 0,
      distanceAlongMeters: 0,
      lineLengthMeters: 0
    }
  }

  let best: LineProjection | undefined
  let distanceBeforeSegment = 0

  for (let index = 0; index < line.length - 1; index += 1) {
    const projection = projectPointToSegment(point, line[index], line[index + 1])
    const distanceAlongMeters = distanceBeforeSegment + projection.segmentLengthMeters * projection.fraction
    const candidate: LineProjection = {
      ...projection,
      segmentIndex: index,
      distanceAlongMeters,
      lineLengthMeters: 0
    }
    if (!best || candidate.distanceMeters < best.distanceMeters) {
      best = candidate
    }
    distanceBeforeSegment += projection.segmentLengthMeters
  }

  return best ? { ...best, lineLengthMeters: distanceBeforeSegment } : undefined
}

export function distanceToTargetAlongLine(
  current: Coordinate,
  target: Coordinate,
  line: Coordinate[],
  maxProjectionDistanceMeters: number
): number {
  const currentProjection = projectPointToLine(current, line)
  const targetProjection = projectPointToLine(target, line)
  if (
    !currentProjection ||
    !targetProjection ||
    currentProjection.distanceMeters > maxProjectionDistanceMeters
  ) {
    return distanceMeters(current, target)
  }

  const alongDistance = targetProjection.distanceAlongMeters - currentProjection.distanceAlongMeters
  return alongDistance >= 0 ? alongDistance : distanceMeters(current, target)
}
