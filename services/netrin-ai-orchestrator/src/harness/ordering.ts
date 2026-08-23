import type { AiRouteConstraints, Coordinate, PlacePriority } from '../contracts/aiRoute.js'
import type { TrustedPoi } from '../tools/amapPoi.js'

export type ResolvedStop = {
  candidateId: string
  poi: TrustedPoi
  reason: string
  priority: PlacePriority
  estimatedStayMinutes?: number
  userLockedOrder?: number
}

const EARTH_RADIUS_M = 6_371_008.8

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180
  const phi1 = a[1] * radians
  const phi2 = b[1] * radians
  const deltaPhi = (b[1] - a[1]) * radians
  const deltaLambda = (b[0] - a[0]) * radians
  const h = Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function routeDistance(stops: ResolvedStop[]): number {
  return stops.slice(1).reduce(
    (sum, stop, index) => sum + distanceMeters(stops[index].poi.wgs84, stop.poi.wgs84),
    0
  )
}

function twoOpt(input: ResolvedStop[]): ResolvedStop[] {
  let best = [...input]
  let improved = true
  while (improved) {
    improved = false
    const currentDistance = routeDistance(best)
    for (let start = 1; start < best.length - 1; start += 1) {
      for (let end = start + 1; end < best.length; end += 1) {
        const candidate = [
          ...best.slice(0, start),
          ...best.slice(start, end + 1).reverse(),
          ...best.slice(end + 1)
        ]
        if (routeDistance(candidate) + 0.5 < currentDistance) {
          best = candidate
          improved = true
        }
      }
    }
  }
  return best
}

export function orderResolvedStops(
  stops: ResolvedStop[],
  proposedOrder: string[]
): ResolvedStop[] {
  const proposedIndex = new Map(proposedOrder.map((id, index) => [id, index]))
  const semantic = [...stops].sort((a, b) =>
    (a.userLockedOrder ?? proposedIndex.get(a.candidateId) ?? Number.MAX_SAFE_INTEGER) -
    (b.userLockedOrder ?? proposedIndex.get(b.candidateId) ?? Number.MAX_SAFE_INTEGER)
  )
  if (stops.some((stop) => stop.userLockedOrder !== undefined) ||
      stops.some((stop) => stop.priority === 'required')) {
    return semantic
  }
  return twoOpt(semantic)
}

export function buildTimeWarnings(
  constraints: AiRouteConstraints,
  stops: ResolvedStop[],
  travelMinutes: number
): { totalEstimatedMinutes: number; warnings: string[] } {
  const stayMinutes = stops.reduce((sum, stop) => sum + (stop.estimatedStayMinutes ?? 0), 0)
  const totalEstimatedMinutes = Math.ceil(travelMinutes + stayMinutes)
  const warnings: string[] = []
  if (constraints.durationMinutes && totalEstimatedMinutes > constraints.durationMinutes) {
    const optional = stops.filter((stop) => stop.priority === 'optional').map((stop) => stop.candidateId)
    warnings.push(optional.length > 0
      ? `TIME_BUDGET_EXCEEDED_OPTIONAL:${optional.join(',')}`
      : 'TIME_BUDGET_EXCEEDED')
  }
  return { totalEstimatedMinutes, warnings }
}
