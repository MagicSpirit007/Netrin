import type {
  Coordinate,
  RoutePlanLeg,
  RoutePlanPurpose,
  RoutePlanStep,
  RouteProvider,
  TravelMode,
  Wgs84LineString
} from '../../data/types'
import { supabase } from '../supabase'

export type AmapPlanSegmentInput = {
  id?: string
  fromPointId: string
  toPointId: string
  from: Coordinate
  to: Coordinate
  travelMode?: TravelMode
  purpose?: RoutePlanPurpose
  fromSnapped?: boolean
  toSnapped?: boolean
}

type RoutePoint = {
  id: string
  final: Coordinate
  snapped?: boolean
}

type RoutePlanWire = {
  travelMode?: unknown
  geometry?: unknown
  distanceM?: unknown
  durationS?: unknown
  steps?: unknown
  provider?: unknown
  plannedAt?: unknown
}

const SUCCESS_CACHE_TTL_MS = 2 * 60 * 1000
const routeCache = new Map<string, { value: RoutePlanLeg; expiresAt: number }>()
const inflightRoutes = new Map<string, Promise<RoutePlanLeg>>()

function isCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
}

function isLineString(value: unknown): value is Wgs84LineString {
  if (!value || typeof value !== 'object') return false
  const line = value as Partial<Wgs84LineString>
  return line.type === 'LineString' &&
    Array.isArray(line.coordinates) &&
    line.coordinates.length >= 2 &&
    line.coordinates.length <= 10_000 &&
    line.coordinates.every(isCoordinate)
}

function normalizeStep(value: unknown): RoutePlanStep | undefined {
  if (!value || typeof value !== 'object') return undefined
  const step = value as Partial<RoutePlanStep>
  if (!Array.isArray(step.coordinates) || !step.coordinates.every(isCoordinate)) return undefined
  if (step.coordinates.length < 2) return undefined
  const distanceMeters = Number(step.distanceMeters)
  const durationSeconds = step.durationSeconds == null ? undefined : Number(step.durationSeconds)
  return {
    instruction: typeof step.instruction === 'string' ? step.instruction : '',
    distanceMeters: Number.isFinite(distanceMeters) && distanceMeters >= 0 ? distanceMeters : 0,
    ...(durationSeconds !== undefined && Number.isFinite(durationSeconds) && durationSeconds >= 0
      ? { durationSeconds }
      : {}),
    coordinates: step.coordinates.map(([lng, lat]) => [lng, lat])
  }
}

function expectedProvider(mode: TravelMode): RouteProvider {
  return mode === 'cycling' ? 'amap-cycling' : 'amap-walking'
}

export function normalizeRoutePlanWire(
  value: unknown,
  input: AmapPlanSegmentInput
): RoutePlanLeg {
  if (!value || typeof value !== 'object') throw new Error('Route plan response is invalid.')
  const wire = value as RoutePlanWire
  const travelMode = input.travelMode ?? 'walking'
  if (wire.travelMode !== travelMode || wire.provider !== expectedProvider(travelMode)) {
    throw new Error('Route plan mode mismatch.')
  }
  if (!isLineString(wire.geometry)) throw new Error('Route plan geometry is invalid.')
  const distanceMeters = Number(wire.distanceM)
  const durationSeconds = wire.durationS == null ? undefined : Number(wire.durationS)
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error('Route plan distance is invalid.')
  }
  const steps = Array.isArray(wire.steps)
    ? wire.steps.flatMap((step) => {
        const normalized = normalizeStep(step)
        return normalized ? [normalized] : []
      })
    : []
  return {
    id: input.id ?? `segment-${input.fromPointId}-${input.toPointId}`,
    fromPointId: input.fromPointId,
    toPointId: input.toPointId,
    coordinates: wire.geometry.coordinates.map(([lng, lat]) => [lng, lat]),
    kind: 'network',
    distanceMeters,
    coordSystem: 'WGS-84',
    provider: expectedProvider(travelMode),
    plannedAt: typeof wire.plannedAt === 'string' ? wire.plannedAt : new Date().toISOString(),
    ...(durationSeconds !== undefined && Number.isFinite(durationSeconds) && durationSeconds >= 0
      ? { durationSeconds }
      : {}),
    ...(steps.length > 0 ? { steps } : {})
  }
}

function roundedCoordinate(coordinate: Coordinate): string {
  return `${coordinate[0].toFixed(5)},${coordinate[1].toFixed(5)}`
}

function cacheKey(input: AmapPlanSegmentInput): string {
  return `${input.travelMode ?? 'walking'}:${roundedCoordinate(input.from)}>${roundedCoordinate(input.to)}`
}

async function requestRouteSegment(input: AmapPlanSegmentInput): Promise<RoutePlanLeg> {
  if (!supabase) throw new Error('Route planning service is not configured.')
  if (!isCoordinate(input.from) || !isCoordinate(input.to)) {
    throw new Error('Route planning coordinates are invalid.')
  }
  const travelMode = input.travelMode ?? 'walking'
  const { data, error } = await supabase.functions.invoke('netrin-route-plan', {
    body: {
      travelMode,
      from: input.from,
      to: input.to,
      purpose: input.purpose ?? 'preview'
    }
  })
  if (error) throw new Error('Route planning service failed.')
  return normalizeRoutePlanWire(data, { ...input, travelMode })
}

export async function planRouteSegment(input: AmapPlanSegmentInput): Promise<RoutePlanLeg> {
  const normalizedInput = { ...input, travelMode: input.travelMode ?? 'walking' }
  const key = cacheKey(normalizedInput)
  const cached = routeCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.value,
      id: input.id ?? cached.value.id,
      fromPointId: input.fromPointId,
      toPointId: input.toPointId
    }
  }
  if (cached) routeCache.delete(key)

  let planned = inflightRoutes.get(key)
  if (!planned) {
    planned = requestRouteSegment(normalizedInput)
      .then((segment) => {
        routeCache.set(key, { value: segment, expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS })
        return segment
      })
      .finally(() => inflightRoutes.delete(key))
    inflightRoutes.set(key, planned)
  }

  const segment = await planned
  return {
    ...segment,
    id: input.id ?? segment.id,
    fromPointId: input.fromPointId,
    toPointId: input.toPointId
  }
}

/** Compatibility alias for call sites that explicitly need walking. */
export function planAmapSegment(input: AmapPlanSegmentInput): Promise<RoutePlanLeg> {
  return planRouteSegment({ ...input, travelMode: 'walking' })
}

export async function planRouteSegmentsForPoints(
  points: RoutePoint[],
  travelMode: TravelMode = 'walking',
  purpose: RoutePlanPurpose = 'preview'
): Promise<RoutePlanLeg[]> {
  if (points.length < 2) return []
  return Promise.all(
    points.slice(1).map((point, index) => {
      const previous = points[index]
      return planRouteSegment({
        id: `segment-${previous.id}-${point.id}`,
        fromPointId: previous.id,
        toPointId: point.id,
        from: previous.final,
        to: point.final,
        travelMode,
        purpose,
        fromSnapped: previous.snapped,
        toSnapped: point.snapped
      })
    })
  )
}

export function clearAmapRouteCache(): void {
  routeCache.clear()
  inflightRoutes.clear()
}
