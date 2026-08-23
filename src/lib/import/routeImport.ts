import distance from '@turf/distance'
import { lineString, point } from '@turf/helpers'
import simplify from '@turf/simplify'
import type {
  Coordinate,
  RecordedPoint,
  RouteGeometryCandidate,
  RouteImportSummary
} from '../../data/types'

export const MAX_ROUTE_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_ROUTE_IMPORT_COORDINATES = 10_000

export type RouteImportTrack = {
  id: string
  name: string
  geometryCandidate: RouteGeometryCandidate
  points: RecordedPoint[]
  summary: RouteImportSummary
}

export type RouteImportErrorCode =
  | 'too-large'
  | 'invalid-file'
  | 'unsupported-geometry'
  | 'not-enough-points'

export class RouteImportError extends Error {
  readonly code: RouteImportErrorCode

  constructor(code: RouteImportErrorCode, message: string) {
    super(message)
    this.name = 'RouteImportError'
    this.code = code
  }
}

function coordinate(value: unknown): Coordinate | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const lng = Number(value[0])
  const lat = Number(value[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return undefined
  return [lng, lat]
}

function withoutAdjacentDuplicates(coordinates: Coordinate[]): Coordinate[] {
  const next: Coordinate[] = []
  for (const current of coordinates) {
    const previous = next[next.length - 1]
    if (!previous || previous[0] !== current[0] || previous[1] !== current[1]) next.push(current)
  }
  return next
}

function simplifyCoordinates(coordinates: Coordinate[]): Coordinate[] {
  if (coordinates.length <= MAX_ROUTE_IMPORT_COORDINATES) return coordinates
  let tolerance = 0.000001
  let current = coordinates
  while (current.length > MAX_ROUTE_IMPORT_COORDINATES && tolerance <= 1) {
    const simplified = simplify(lineString(coordinates), {
      tolerance,
      highQuality: true,
      mutate: false
    }).geometry.coordinates.flatMap((item): Coordinate[] => {
      const parsed = coordinate(item)
      return parsed ? [parsed] : []
    })
    if (simplified.length >= 2) current = simplified
    tolerance *= 2
  }
  if (current.length > MAX_ROUTE_IMPORT_COORDINATES) {
    const stride = Math.ceil(current.length / MAX_ROUTE_IMPORT_COORDINATES)
    const sampled = current.filter((_, index) => index % stride === 0)
    const last = current[current.length - 1]
    if (sampled[sampled.length - 1] !== last) sampled.push(last)
    current = sampled
  }
  return withoutAdjacentDuplicates(current)
}

function distanceMeters(coordinates: Coordinate[]): number {
  let total = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distance(point(coordinates[index - 1]), point(coordinates[index]), { units: 'meters' })
  }
  return Math.round(total)
}

function safeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim()
}

function tagText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'i'))
  return match ? safeXmlText(match[1]) : undefined
}

function pointElements(xml: string, tag: 'trkpt' | 'rtept' | 'wpt'): Array<{ coordinate: Coordinate; name?: string; description?: string }> {
  const pattern = new RegExp(`<(?:(?:[\\w-]+):)?${tag}\\b([^>]*)>([\\s\\S]*?)<\\/(?:(?:[\\w-]+):)?${tag}>|<(?:(?:[\\w-]+):)?${tag}\\b([^>]*)\\/>`, 'gi')
  const points: Array<{ coordinate: Coordinate; name?: string; description?: string }> = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml))) {
    const attributes = match[1] ?? match[3] ?? ''
    const body = match[2] ?? ''
    const lat = attributes.match(/\blat\s*=\s*["']([^"']+)["']/i)?.[1]
    const lon = attributes.match(/\b(?:lon|lng)\s*=\s*["']([^"']+)["']/i)?.[1]
    const parsed = coordinate([Number(lon), Number(lat)])
    if (!parsed) continue
    points.push({
      coordinate: parsed,
      name: tagText(body, 'name'),
      description: tagText(body, 'desc') ?? tagText(body, 'cmt')
    })
  }
  return points
}

function xmlBlocks(xml: string, tag: 'trk' | 'rte'): string[] {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'gi'))]
    .map((match) => match[1])
}

function pointRecord(input: { id: string; index: number; coordinate: Coordinate; title?: string; text?: string }): RecordedPoint {
  return {
    id: input.id,
    index: input.index,
    raw: input.coordinate,
    final: input.coordinate,
    snapped: false,
    text: input.text ?? '',
    highlightTitle: input.title,
    media: []
  }
}

function importedTrack(input: {
  id: string
  name: string
  fileName: string
  format: 'gpx' | 'geojson'
  source: 'gpx-import' | 'geojson-import'
  coordinates: Coordinate[]
  waypoints?: Array<{ coordinate: Coordinate; name?: string; description?: string }>
}): RouteImportTrack {
  const rawCoordinates = withoutAdjacentDuplicates(input.coordinates)
  if (rawCoordinates.length < 2) throw new RouteImportError('not-enough-points', 'Imported line needs at least two coordinates.')
  const coordinates = simplifyCoordinates(rawCoordinates)
  if (coordinates.length < 2) throw new RouteImportError('not-enough-points', 'Imported line needs at least two coordinates.')
  // Two slots are reserved for generated start/end highlights; the publish contract caps highlights at 200.
  const points = (input.waypoints ?? []).slice(0, 198).map((waypoint, index) => pointRecord({
    id: `${input.id}-waypoint-${index + 1}`,
    index: index + 2,
    coordinate: waypoint.coordinate,
    title: waypoint.name,
    text: waypoint.description
  }))
  points.unshift(pointRecord({ id: `${input.id}-start`, index: 1, coordinate: coordinates[0] }))
  points.push(pointRecord({ id: `${input.id}-end`, index: points.length + 1, coordinate: coordinates[coordinates.length - 1] }))
  return {
    id: input.id,
    name: input.name,
    geometryCandidate: {
      geometry: { type: 'LineString', coordinates },
      source: input.source,
      distanceM: distanceMeters(coordinates),
      generatedAt: new Date().toISOString()
    },
    points: points.map((item, index) => ({ ...item, index: index + 1 })),
    summary: {
      format: input.format,
      fileName: input.fileName,
      selectedTrackName: input.name,
      originalCoordinateCount: rawCoordinates.length,
      coordinateCount: coordinates.length,
      simplified: coordinates.length < rawCoordinates.length,
      strippedMetadata: input.format === 'gpx'
        ? ['time', 'elevation', 'device', 'extensions', 'raw-file']
        : ['properties', 'foreign-members', 'raw-file']
    }
  }
}

export function parseGeoJsonRoute(text: string, fileName = 'route.geojson'): RouteImportTrack[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new RouteImportError('invalid-file', 'GeoJSON is not valid JSON.')
  }
  if (!value || typeof value !== 'object') throw new RouteImportError('invalid-file', 'GeoJSON object required.')
  const root = value as Record<string, unknown>
  if (root.type === 'FeatureCollection' || root.type === 'MultiLineString') {
    throw new RouteImportError('unsupported-geometry', 'Only one LineString is supported.')
  }
  const geometry = root.type === 'Feature' ? root.geometry : root
  if (!geometry || typeof geometry !== 'object' || (geometry as Record<string, unknown>).type !== 'LineString') {
    throw new RouteImportError('unsupported-geometry', 'Only one LineString is supported.')
  }
  const coordinates = Array.isArray((geometry as Record<string, unknown>).coordinates)
    ? ((geometry as Record<string, unknown>).coordinates as unknown[]).flatMap((item): Coordinate[] => {
        const parsed = coordinate(item)
        return parsed ? [parsed] : []
      })
    : []
  if (coordinates.length !== ((geometry as Record<string, unknown>).coordinates as unknown[] | undefined)?.length) {
    throw new RouteImportError('invalid-file', 'GeoJSON contains invalid coordinates.')
  }
  const properties = root.type === 'Feature' && root.properties && typeof root.properties === 'object'
    ? root.properties as Record<string, unknown>
    : {}
  return [importedTrack({
    id: 'geojson-1',
    name: typeof properties.name === 'string' ? properties.name.slice(0, 160) : fileName,
    fileName,
    format: 'geojson',
    source: 'geojson-import',
    coordinates
  })]
}

export function parseGpxRoute(text: string, fileName = 'route.gpx'): RouteImportTrack[] {
  if (!/<(?:[\w-]+:)?gpx\b/i.test(text)) throw new RouteImportError('invalid-file', 'GPX document required.')
  const waypoints = pointElements(text, 'wpt')
  const tracks = xmlBlocks(text, 'trk').map((block, index) => {
    const coordinates = pointElements(block, 'trkpt').map((item) => item.coordinate)
    return importedTrack({
      id: `gpx-track-${index + 1}`,
      name: tagText(block, 'name') ?? `${fileName} · ${index + 1}`,
      fileName,
      format: 'gpx',
      source: 'gpx-import',
      coordinates,
      waypoints
    })
  })
  const routes = xmlBlocks(text, 'rte').map((block, index) => {
    const routePoints = pointElements(block, 'rtept')
    return importedTrack({
      id: `gpx-route-${index + 1}`,
      name: tagText(block, 'name') ?? `${fileName} · route ${index + 1}`,
      fileName,
      format: 'gpx',
      source: 'gpx-import',
      coordinates: routePoints.map((item) => item.coordinate),
      waypoints: routePoints.filter((item) => item.name || item.description)
    })
  })
  const candidates = [...tracks, ...routes]
  if (candidates.length === 0) throw new RouteImportError('not-enough-points', 'GPX contains no usable track or route.')
  return candidates
}

export async function parseRouteImportFile(file: File): Promise<RouteImportTrack[]> {
  if (file.size > MAX_ROUTE_IMPORT_BYTES) throw new RouteImportError('too-large', 'Import file exceeds 10 MiB.')
  const text = await file.text()
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.gpx') || /<\s*(?:[\w-]+:)?gpx\b/i.test(text)) return parseGpxRoute(text, file.name)
  if (lower.endsWith('.geojson') || lower.endsWith('.json') || /^\s*[{[]/.test(text)) {
    return parseGeoJsonRoute(text, file.name)
  }
  throw new RouteImportError('invalid-file', 'Only GPX and GeoJSON files are supported.')
}
