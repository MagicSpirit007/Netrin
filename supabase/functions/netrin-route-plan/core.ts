export type Coordinate = [number, number]
export type TravelMode = 'walking' | 'cycling'
export type RoutePlanPurpose = 'authoring' | 'guidance' | 'preview'

export type RoutePlanRequest = {
  travelMode: TravelMode
  from: Coordinate
  to: Coordinate
  purpose: RoutePlanPurpose
}

export type RoutePlanResponse = {
  travelMode: TravelMode
  geometry: { type: 'LineString'; coordinates: Coordinate[] }
  distanceM: number
  durationS?: number
  steps: Array<{
    instruction: string
    distanceMeters: number
    durationSeconds?: number
    coordinates: Coordinate[]
  }>
  provider: 'amap-walking' | 'amap-cycling'
  plannedAt: string
}

const PI = Math.PI
const SEMI_MAJOR_AXIS = 6378245.0
const ECCENTRICITY_SQUARED = 0.00669342162296594323

function outsideChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(lng: number, lat: number): number {
  let ret = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
  ret += ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3
  ret += ((20 * Math.sin(lat * PI) + 40 * Math.sin((lat / 3) * PI)) * 2) / 3
  ret += ((160 * Math.sin((lat / 12) * PI) + 320 * Math.sin((lat * PI) / 30)) * 2) / 3
  return ret
}

function transformLng(lng: number, lat: number): number {
  let ret = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
  ret += ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3
  ret += ((20 * Math.sin(lng * PI) + 40 * Math.sin((lng / 3) * PI)) * 2) / 3
  ret += ((150 * Math.sin((lng / 12) * PI) + 300 * Math.sin((lng / 30) * PI)) * 2) / 3
  return ret
}

export function wgs84ToGcj02(position: Coordinate): Coordinate {
  const [lng, lat] = position
  if (outsideChina(lng, lat)) return [lng, lat]
  let dLat = transformLat(lng - 105, lat - 35)
  let dLng = transformLng(lng - 105, lat - 35)
  const radLat = (lat / 180) * PI
  let magic = Math.sin(radLat)
  magic = 1 - ECCENTRICITY_SQUARED * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / (((SEMI_MAJOR_AXIS * (1 - ECCENTRICITY_SQUARED)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180) / ((SEMI_MAJOR_AXIS / sqrtMagic) * Math.cos(radLat) * PI)
  return [lng + dLng, lat + dLat]
}

export function gcj02ToWgs84(position: Coordinate): Coordinate {
  const [lng, lat] = position
  if (outsideChina(lng, lat)) return [lng, lat]
  let estimateLng = lng
  let estimateLat = lat
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const [projectedLng, projectedLat] = wgs84ToGcj02([estimateLng, estimateLat])
    estimateLng -= projectedLng - lng
    estimateLat -= projectedLat - lat
  }
  return [estimateLng, estimateLat]
}

export function isCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === 'number' && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180 &&
    typeof value[1] === 'number' && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90
}

export function parseRoutePlanRequest(value: unknown): RoutePlanRequest {
  if (!value || typeof value !== 'object') throw new Error('invalid-request')
  const body = value as Partial<RoutePlanRequest>
  if (body.travelMode !== 'walking' && body.travelMode !== 'cycling') throw new Error('invalid-travel-mode')
  if (!isCoordinate(body.from) || !isCoordinate(body.to)) throw new Error('invalid-coordinate')
  if (!['authoring', 'guidance', 'preview'].includes(body.purpose ?? '')) throw new Error('invalid-purpose')
  return {
    travelMode: body.travelMode,
    from: [body.from[0], body.from[1]],
    to: [body.to[0], body.to[1]],
    purpose: body.purpose as RoutePlanPurpose
  }
}

export function buildAmapRouteUrl(input: RoutePlanRequest, key: string): URL {
  const endpoint = input.travelMode === 'cycling' ? 'bicycling' : 'walking'
  const url = new URL(`https://restapi.amap.com/v5/direction/${endpoint}`)
  const from = wgs84ToGcj02(input.from)
  const to = wgs84ToGcj02(input.to)
  url.searchParams.set('key', key)
  url.searchParams.set('origin', `${from[0].toFixed(6)},${from[1].toFixed(6)}`)
  url.searchParams.set('destination', `${to[0].toFixed(6)},${to[1].toFixed(6)}`)
  url.searchParams.set('alternative_route', '1')
  url.searchParams.set('show_fields', 'cost,navi,polyline')
  url.searchParams.set('output', 'json')
  if (input.travelMode === 'walking') url.searchParams.set('isindoor', '0')
  return url
}

function parseNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function parsePolyline(value: unknown): Coordinate[] {
  if (typeof value !== 'string') return []
  return value.split(';').flatMap((pair): Coordinate[] => {
    const [lngText, latText] = pair.split(',')
    const gcj: Coordinate = [Number(lngText), Number(latText)]
    return isCoordinate(gcj) ? [gcj02ToWgs84(gcj)] : []
  })
}

function appendCoordinate(target: Coordinate[], coordinate: Coordinate): void {
  const previous = target[target.length - 1]
  if (previous && Math.abs(previous[0] - coordinate[0]) < 1e-9 && Math.abs(previous[1] - coordinate[1]) < 1e-9) return
  target.push([coordinate[0], coordinate[1]])
}

function lineLengthMeters(coordinates: Coordinate[]): number {
  const radius = 6_371_008.8
  let total = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    const [lng1, lat1] = coordinates[index - 1]
    const [lng2, lat2] = coordinates[index]
    const phi1 = lat1 * PI / 180
    const phi2 = lat2 * PI / 180
    const dPhi = (lat2 - lat1) * PI / 180
    const dLambda = (lng2 - lng1) * PI / 180
    const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
    total += radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
  return total
}

export function normalizeAmapRouteResponse(
  value: unknown,
  input: RoutePlanRequest,
  now = new Date().toISOString()
): RoutePlanResponse {
  if (!value || typeof value !== 'object') throw new Error('invalid-provider-response')
  const response = value as {
    status?: unknown
    route?: { paths?: unknown }
  }
  if (String(response.status) !== '1' || !Array.isArray(response.route?.paths) || response.route.paths.length === 0) {
    throw new Error('provider-route-unavailable')
  }
  const path = response.route.paths[0] as {
    distance?: unknown
    cost?: { duration?: unknown }
    duration?: unknown
    steps?: unknown
  }
  const steps = Array.isArray(path.steps)
    ? path.steps.flatMap((raw): RoutePlanResponse['steps'] => {
        if (!raw || typeof raw !== 'object') return []
        const step = raw as {
          instruction?: unknown
          step_distance?: unknown
          distance?: unknown
          cost?: { duration?: unknown }
          duration?: unknown
          polyline?: unknown
        }
        const coordinates = parsePolyline(step.polyline)
        if (coordinates.length < 2) return []
        const durationSeconds = parseNumber(step.cost?.duration) ?? parseNumber(step.duration)
        return [{
          instruction: typeof step.instruction === 'string' ? step.instruction.trim() : '',
          distanceMeters: parseNumber(step.step_distance) ?? parseNumber(step.distance) ?? lineLengthMeters(coordinates),
          ...(durationSeconds !== undefined ? { durationSeconds } : {}),
          coordinates
        }]
      })
    : []
  const coordinates: Coordinate[] = []
  appendCoordinate(coordinates, input.from)
  steps.forEach((step) => step.coordinates.forEach((coordinate) => appendCoordinate(coordinates, coordinate)))
  appendCoordinate(coordinates, input.to)
  if (coordinates.length < 2 || coordinates.length > 10_000) throw new Error('invalid-provider-geometry')
  const durationS = parseNumber(path.cost?.duration) ?? parseNumber(path.duration)
  return {
    travelMode: input.travelMode,
    geometry: { type: 'LineString', coordinates },
    distanceM: parseNumber(path.distance) ?? lineLengthMeters(coordinates),
    ...(durationS !== undefined ? { durationS } : {}),
    steps,
    provider: input.travelMode === 'cycling' ? 'amap-cycling' : 'amap-walking',
    plannedAt: now
  }
}
