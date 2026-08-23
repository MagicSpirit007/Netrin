import type { Coordinate, RouteBounds } from '../../data/types'
import { distanceMeters } from '../navigation/geo'
import { gcj02ToWgs84, wgs84ToGcj02 } from './coords'
import { loadAmap } from './loadAmap'
import {
  amapLngLatTuple,
  type AmapDistrictSearchResult,
  type AmapDistrictWire,
  type AmapPlaceSearchResult,
  type AmapPoiWire
} from './types'

const AMAP_SEARCH_TIMEOUT_MS = 5000
const AMAP_SEARCH_RESULT_LIMIT = 8
const AMAP_NEARBY_MAX_RADIUS_METERS = 50000
const AMAP_NEARBY_MIN_RADIUS_METERS = 100

export type AmapSearchResult = {
  id: string
  kind: 'city' | 'place'
  label: string
  providerId?: string
  address?: string
  coordinate?: Coordinate
  bounds?: RouteBounds
  cityAdcode?: string
  cityName?: string
}

export type AmapPlaceSearchOptions = {
  /** City name, citycode, or adcode used as a non-strict relevance bias. */
  city?: string
  /** Current visible map bounds, always expressed as WGS-84. */
  bounds?: RouteBounds
  /** Current map center, always expressed as WGS-84. */
  center?: Coordinate
}

export function normalizeAmapPoi(poi: AmapPoiWire, index: number): AmapSearchResult | undefined {
  if (typeof poi.name !== 'string' || !poi.name.trim()) return undefined
  const gcj = amapLngLatTuple(poi.location)
  const wgs = gcj ? gcj02ToWgs84(gcj) : undefined
  return {
    id: poi.id || `place-fallback-${index}-${poi.name.trim()}`,
    kind: 'place',
    label: poi.name.trim(),
    providerId: poi.id,
    address: typeof poi.address === 'string' ? poi.address : undefined,
    coordinate: wgs ? [wgs[0], wgs[1]] : undefined,
    cityAdcode: typeof poi.adcode === 'string' ? poi.adcode : undefined,
    cityName: typeof poi.cityname === 'string' ? poi.cityname : undefined
  }
}

function flattenDistricts(items: AmapDistrictWire[]): AmapDistrictWire[] {
  return items.flatMap((item) => [item, ...flattenDistricts(item.districtList ?? [])])
}

function boundsFromDistrict(city: AmapDistrictWire): RouteBounds | undefined {
  const coordinates = (city.boundaries ?? []).flatMap((boundary) =>
    boundary.flatMap((point): Coordinate[] => {
      const gcj = amapLngLatTuple(point)
      if (!gcj) return []
      const wgs = gcj02ToWgs84(gcj)
      return [[wgs[0], wgs[1]]]
    })
  )
  if (coordinates.length === 0) return undefined
  return coordinates.reduce<RouteBounds>(
    (bounds, [lng, lat]) => ({
      minLng: Math.min(bounds.minLng, lng),
      minLat: Math.min(bounds.minLat, lat),
      maxLng: Math.max(bounds.maxLng, lng),
      maxLat: Math.max(bounds.maxLat, lat)
    }),
    {
      minLng: Number.POSITIVE_INFINITY,
      minLat: Number.POSITIVE_INFINITY,
      maxLng: Number.NEGATIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY
    }
  )
}

export function normalizeAmapCities(items: AmapDistrictWire[]): AmapSearchResult[] {
  return flattenDistricts(items).flatMap((city, index): AmapSearchResult[] => {
    if (city.level !== 'city' || typeof city.name !== 'string' || typeof city.adcode !== 'string') return []
    const gcj = amapLngLatTuple(city.center)
    const wgs = gcj ? gcj02ToWgs84(gcj) : undefined
    return [{
      id: `city-${city.adcode}-${index}`,
      kind: 'city',
      label: city.name,
      coordinate: wgs ? [wgs[0], wgs[1]] : undefined,
      bounds: boundsFromDistrict(city),
      cityAdcode: city.adcode,
      cityName: city.name
    }]
  })
}

function runAmapSearch<T>(
  start: (callback: (status: string, result: T) => void) => void,
  normalize: (result: T) => AmapSearchResult[],
  failureMessage: string
): Promise<AmapSearchResult[]> {
  return new Promise((resolve, reject) => {
    let settled = false
    const resolveOnce = (value: AmapSearchResult[]) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      resolve(value)
    }
    const rejectOnce = (error: unknown) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(failureMessage))
    }
    const timer = globalThis.setTimeout(
      () => rejectOnce(new Error(`${failureMessage}: timeout`)),
      AMAP_SEARCH_TIMEOUT_MS
    )

    try {
      start((status, result) => {
        if (status === 'complete') {
          resolveOnce(normalize(result))
          return
        }
        if (status === 'no_data') {
          resolveOnce([])
          return
        }
        const info =
          typeof result === 'object' &&
          result !== null &&
          'info' in result &&
          typeof result.info === 'string'
            ? result.info
            : failureMessage
        rejectOnce(new Error(info))
      })
    } catch (error) {
      rejectOnce(error)
    }
  })
}

export function centerOfBounds(bounds: RouteBounds): Coordinate {
  return [
    (bounds.minLng + bounds.maxLng) / 2,
    (bounds.minLat + bounds.maxLat) / 2
  ]
}

export function searchRadiusForBounds(
  bounds: RouteBounds,
  center: Coordinate = centerOfBounds(bounds)
): number {
  const corners: Coordinate[] = [
    [bounds.minLng, bounds.minLat],
    [bounds.minLng, bounds.maxLat],
    [bounds.maxLng, bounds.minLat],
    [bounds.maxLng, bounds.maxLat]
  ]
  const radius = Math.ceil(Math.max(...corners.map((corner) => distanceMeters(center, corner))))
  return Math.min(
    AMAP_NEARBY_MAX_RADIUS_METERS,
    Math.max(AMAP_NEARBY_MIN_RADIUS_METERS, radius)
  )
}

export function coordinateInBounds(
  coordinate: Coordinate,
  bounds: RouteBounds
): boolean {
  return (
    coordinate[0] >= bounds.minLng &&
    coordinate[0] <= bounds.maxLng &&
    coordinate[1] >= bounds.minLat &&
    coordinate[1] <= bounds.maxLat
  )
}

function placeResultKey(item: AmapSearchResult): string {
  if (item.providerId) return `provider:${item.providerId}`
  const coordinate = item.coordinate
    ? `${item.coordinate[0].toFixed(6)},${item.coordinate[1].toFixed(6)}`
    : ''
  return `fallback:${item.label.trim().toLocaleLowerCase()}:${coordinate}`
}

export function rankAmapPlaceResults(
  items: AmapSearchResult[],
  options: Pick<AmapPlaceSearchOptions, 'bounds' | 'center'> = {}
): AmapSearchResult[] {
  const center = options.center ?? (options.bounds ? centerOfBounds(options.bounds) : undefined)
  const seen = new Set<string>()
  return items
    .filter((item) => {
      if (item.kind !== 'place' || !item.coordinate) return false
      const key = placeResultKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => {
      if (options.bounds) {
        const leftInBounds = coordinateInBounds(left.coordinate!, options.bounds)
        const rightInBounds = coordinateInBounds(right.coordinate!, options.bounds)
        if (leftInBounds !== rightInBounds) return leftInBounds ? -1 : 1
      }
      if (!center) return 0
      return distanceMeters(center, left.coordinate!) - distanceMeters(center, right.coordinate!)
    })
    .slice(0, AMAP_SEARCH_RESULT_LIMIT)
}

function normalizePlaceSearchResult(result: AmapPlaceSearchResult): AmapSearchResult[] {
  return (result.poiList?.pois ?? []).flatMap((poi, index) => {
    const normalized = normalizeAmapPoi(poi, index)
    return normalized?.coordinate ? [normalized] : []
  })
}

export async function searchAmapPlaces(
  keyword: string,
  options: AmapPlaceSearchOptions = {}
): Promise<AmapSearchResult[]> {
  const query = keyword.trim()
  if (!query) return []
  const AMap = await loadAmap()
  if (!AMap.PlaceSearch) throw new Error('AMap.PlaceSearch unavailable')
  const service = new AMap.PlaceSearch({
    pageSize: AMAP_SEARCH_RESULT_LIMIT,
    pageIndex: 1,
    city: options.city?.trim() || undefined,
    citylimit: false
  })
  const accumulated: AmapSearchResult[] = []
  let completedRequest = false
  let lastError: unknown
  const attempt = async (
    start: (callback: (status: string, result: AmapPlaceSearchResult) => void) => void
  ) => {
    try {
      const results = await runAmapSearch<AmapPlaceSearchResult>(
        start,
        normalizePlaceSearchResult,
        'AMap place search failed'
      )
      completedRequest = true
      accumulated.push(...results)
    } catch (error) {
      lastError = error
    }
  }

  if (options.bounds && service.searchInBounds) {
    const southwest = wgs84ToGcj02([options.bounds.minLng, options.bounds.minLat])
    const northeast = wgs84ToGcj02([options.bounds.maxLng, options.bounds.maxLat])
    await attempt((callback) => service.searchInBounds!(
      query,
      [southwest[0], southwest[1], northeast[0], northeast[1]],
      callback
    ))
  }

  let ranked = rankAmapPlaceResults(accumulated, options)
  const center = options.center ?? (options.bounds ? centerOfBounds(options.bounds) : undefined)
  if (ranked.length < AMAP_SEARCH_RESULT_LIMIT && center && service.searchNearBy) {
    const providerCenter = wgs84ToGcj02(center)
    const radius = options.bounds
      ? searchRadiusForBounds(options.bounds, center)
      : AMAP_NEARBY_MAX_RADIUS_METERS
    await attempt((callback) => service.searchNearBy!(query, providerCenter, radius, callback))
    ranked = rankAmapPlaceResults(accumulated, options)
  }

  if (ranked.length < AMAP_SEARCH_RESULT_LIMIT) {
    await attempt((callback) => service.search(query, callback))
    ranked = rankAmapPlaceResults(accumulated, options)
  }

  if (!completedRequest && lastError) throw lastError
  return ranked
}

export async function searchAmapCities(keyword: string): Promise<AmapSearchResult[]> {
  const query = keyword.trim()
  if (!query) return []
  const AMap = await loadAmap()
  if (!AMap.DistrictSearch) throw new Error('AMap.DistrictSearch unavailable')
  const service = new AMap.DistrictSearch({ level: 'city', subdistrict: 0, extensions: 'all' })
  return runAmapSearch<AmapDistrictSearchResult>(
    (callback) => service.search(query, callback),
    (result) => normalizeAmapCities(result.districtList ?? []).slice(0, 10),
    'AMap city search failed'
  )
}

export async function searchAmap(
  keyword: string,
  options: AmapPlaceSearchOptions = {}
): Promise<AmapSearchResult[]> {
  const settled = await Promise.allSettled([
    searchAmapCities(keyword),
    searchAmapPlaces(keyword, options)
  ])
  const results = settled.flatMap((item) => item.status === 'fulfilled' ? item.value : [])
  if (results.length === 0 && settled.some((item) => item.status === 'rejected')) {
    throw new Error('AMap search unavailable')
  }
  const seen = new Set<string>()
  return results.filter((item) => {
    const key = `${item.kind}:${item.cityAdcode ?? ''}:${item.label}:${item.coordinate?.join(',') ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
