import type {
  DiscoveryQuery,
  RouteBounds,
  RouteDifficulty,
  RouteSummary,
  TravelMode
} from '../data/types'

export type CityFilterValue = {
  adcode: string
  name: string
}

const LEGACY_RECOMMENDATIONS = new Set(['nearby'])
const ROUTE_FILTER_KEYS = [
  'city',
  'cityName',
  'mode',
  'minDistanceM',
  'maxDistanceM',
  'minDurationS',
  'maxDurationS',
  'difficulty',
  'minLng',
  'minLat',
  'maxLng',
  'maxLat',
  'tags'
] as const

function optionalNumber(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function boundsFromParams(params: URLSearchParams): RouteBounds | undefined {
  const minLng = optionalNumber(params.get('minLng'))
  const minLat = optionalNumber(params.get('minLat'))
  const maxLng = optionalNumber(params.get('maxLng'))
  const maxLat = optionalNumber(params.get('maxLat'))
  return minLng == null || minLat == null || maxLng == null || maxLat == null
    ? undefined
    : { minLng, minLat, maxLng, maxLat }
}

export function readCityFilter(params: URLSearchParams): CityFilterValue | undefined {
  const adcode = params.get('city')?.trim()
  if (!adcode) return undefined
  return {
    adcode,
    name: params.get('cityName')?.trim() ?? ''
  }
}

export function writeCityFilter(
  params: URLSearchParams,
  city: CityFilterValue | undefined
): URLSearchParams {
  const next = new URLSearchParams(params)
  if (city?.adcode) {
    next.set('city', city.adcode)
    if (city.name) next.set('cityName', city.name)
    else next.delete('cityName')
  } else {
    next.delete('city')
    next.delete('cityName')
  }
  return next
}

export function cityParamsForPath(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams()
  for (const key of ['city', 'cityName']) {
    const value = params.get(key)
    if (value) next.set(key, value)
  }
  return next
}

export function readRouteCatalogQuery(params: URLSearchParams): DiscoveryQuery {
  return {
    cityAdcode: params.get('city') || undefined,
    travelMode: (params.get('mode') || undefined) as TravelMode | undefined,
    minDistanceM: optionalNumber(params.get('minDistanceM')),
    maxDistanceM: optionalNumber(params.get('maxDistanceM')),
    minDurationS: optionalNumber(params.get('minDurationS')),
    maxDurationS: optionalNumber(params.get('maxDurationS')),
    difficulty: (params.get('difficulty') || undefined) as RouteDifficulty | undefined,
    bounds: boundsFromParams(params)
  }
}

export function hasRouteCatalogFilters(params: URLSearchParams): boolean {
  return ROUTE_FILTER_KEYS.some((key) => params.has(key))
}

export function clearRouteCatalogFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  ROUTE_FILTER_KEYS.forEach((key) => next.delete(key))
  return next
}

function numberMatches(value: number | undefined, min: number | undefined, max: number | undefined): boolean {
  if (min === undefined && max === undefined) return true
  if (value === undefined) return false
  return (min === undefined || value >= min) && (max === undefined || value <= max)
}

function boundsIntersect(left: RouteBounds | undefined, right: RouteBounds | undefined): boolean {
  if (!right) return true
  if (!left) return false
  return (
    left.maxLng >= right.minLng &&
    left.minLng <= right.maxLng &&
    left.maxLat >= right.minLat &&
    left.minLat <= right.maxLat
  )
}

export function routeMatchesCatalogQuery(route: RouteSummary, query: DiscoveryQuery): boolean {
  if (query.cityAdcode && route.cityAdcode !== query.cityAdcode) return false
  if (query.travelMode && route.travelMode !== query.travelMode) return false
  if (!numberMatches(route.distanceM, query.minDistanceM, query.maxDistanceM)) return false
  if (!numberMatches(route.durationS, query.minDurationS, query.maxDurationS)) return false
  if (query.difficulty && route.difficulty !== query.difficulty) return false
  return boundsIntersect(route.bounds, query.bounds)
}

export function legacyWorkshopParams(params: URLSearchParams): URLSearchParams | undefined {
  const recommendation = params.get('recommend')
  if (!recommendation || !LEGACY_RECOMMENDATIONS.has(recommendation)) return undefined
  const next = new URLSearchParams()
  for (const key of ['q', 'city', 'cityName', 'recommend', 'nearLng', 'nearLat']) {
    const value = params.get(key)
    if (value) next.set(key, value)
  }
  return next
}

export function pathWithParams(path: string, params: URLSearchParams): string {
  const query = params.toString()
  return query ? `${path}?${query}` : path
}
