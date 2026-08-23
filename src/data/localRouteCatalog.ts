import {
  resolveActiveRoute,
  routeDraftToActiveRoute,
  routes as bundledRoutes
} from './nature'
import type {
  ActiveRouteView,
  Coordinate,
  DiscoveryQuery,
  DownloadedRoute,
  RouteBounds,
  RouteDraft,
  RouteSummary
} from './types'

export type LocalRouteSource = 'draft' | 'downloaded' | 'bundled'

export type LocalRouteSummary = RouteSummary & {
  localSource: LocalRouteSource
}

function isCoordinate(value: Coordinate): boolean {
  return Number.isFinite(value[0]) && Number.isFinite(value[1])
}

function boundsForRoute(route: ActiveRouteView): RouteBounds | undefined {
  const coordinates = (
    route.geometry?.coordinates.length
      ? route.geometry.coordinates
      : route.stops.map((stop) => stop.location)
  ).filter(isCoordinate)

  if (coordinates.length === 0) return undefined

  const lngs = coordinates.map(([lng]) => lng)
  const lats = coordinates.map(([, lat]) => lat)
  return {
    minLng: Math.min(...lngs),
    minLat: Math.min(...lats),
    maxLng: Math.max(...lngs),
    maxLat: Math.max(...lats)
  }
}

function coverUrlForRoute(route: ActiveRouteView): string | undefined {
  const media = route.stops.flatMap((stop) => stop.media)
  const selected = route.coverMediaId
    ? media.find((item) => item.id === route.coverMediaId)
    : undefined
  if (selected?.url) return selected.url

  for (const stop of route.stops) {
    if (stop.photoUrl) return stop.photoUrl
    const resolved = stop.media.find((item) => item.url)
    if (resolved?.url) return resolved.url
  }
  return undefined
}

function toLocalSummary(
  route: ActiveRouteView,
  localSource: LocalRouteSource,
  createdAt: string,
  updatedAt?: string
): LocalRouteSummary {
  return {
    id: route.id,
    author: route.author ?? '',
    title: route.title,
    description: route.description,
    downloads: 0,
    createdAt,
    updatedAt,
    travelMode: route.travelMode,
    cityAdcode: route.cityAdcode,
    cityName: route.cityName,
    distanceM: route.distanceM,
    durationS: route.durationS,
    difficulty: route.difficulty,
    isLoop: route.isLoop,
    tags: route.tags ?? [],
    coverMediaId: route.coverMediaId,
    coverUrl: coverUrlForRoute(route),
    bounds: boundsForRoute(route),
    pointCount: route.stops.length,
    localSource
  }
}

function downloadedRouteView(route: DownloadedRoute): ActiveRouteView {
  return {
    id: route.id,
    title: route.title,
    description: route.description,
    author: route.author,
    stops: route.stops,
    travelMode: route.travelMode ?? 'walking',
    geometry: route.geometry,
    geometrySource: route.geometrySource,
    cityAdcode: route.cityAdcode,
    cityName: route.cityName,
    distanceM: route.distanceM,
    durationS: route.durationS,
    difficulty: route.difficulty,
    isLoop: route.isLoop,
    tags: route.tags,
    coverMediaId: route.coverMediaId
  }
}

/**
 * The route picker is device-local. Community/cloud routes remain in Workshop
 * until the reader explicitly saves them to this device.
 */
export function buildLocalRouteCatalog(
  downloadedRoutes: DownloadedRoute[],
  routeDrafts: RouteDraft[]
): LocalRouteSummary[] {
  const draftItems = [...routeDrafts]
    .filter((draft) => draft.points.length > 0)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .flatMap((draft) => {
      const route = routeDraftToActiveRoute(draft)
      return route
        ? [toLocalSummary(route, 'draft', draft.createdAt, draft.updatedAt)]
        : []
    })

  const downloadedItems = [...downloadedRoutes]
    .sort((left, right) => right.downloadedAt.localeCompare(left.downloadedAt))
    .map((route) => toLocalSummary(
      downloadedRouteView(route),
      'downloaded',
      route.downloadedAt,
      route.localEditedAt ?? route.remoteUpdatedAt
    ))

  const bundledItems = bundledRoutes.flatMap((route) => {
    const active = resolveActiveRoute(route.id, [], [])
    return active
      ? [toLocalSummary(
          active,
          'bundled',
          route.createdAt ?? '1970-01-01T00:00:00.000Z',
          route.updatedAt
        )]
      : []
  })

  const known = new Set<string>()
  return [...draftItems, ...downloadedItems, ...bundledItems].filter((route) => {
    if (known.has(route.id)) return false
    known.add(route.id)
    return true
  })
}

function normalizedCity(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, '')
    .replace(/(?:特别行政区|自治州|地区|盟|市)$/u, '')
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

export function filterLocalRouteCatalog(
  routes: LocalRouteSummary[],
  query: DiscoveryQuery,
  selectedCityName?: string
): LocalRouteSummary[] {
  const requestedTags = (query.tags ?? []).map((tag) => tag.toLocaleLowerCase())
  const cityName = normalizedCity(selectedCityName)

  return routes.filter((route) => {
    const cityMatches = !query.cityAdcode || (
      route.cityAdcode === query.cityAdcode ||
      (cityName !== '' && normalizedCity(route.cityName) === cityName)
    )
    if (!cityMatches) return false
    if (query.travelMode && route.travelMode !== query.travelMode) return false
    if (!numberMatches(route.distanceM, query.minDistanceM, query.maxDistanceM)) return false
    if (!numberMatches(route.durationS, query.minDurationS, query.maxDurationS)) return false
    if (query.difficulty && route.difficulty !== query.difficulty) return false
    if (!boundsIntersect(route.bounds, query.bounds)) return false

    const routeTags = new Set(route.tags.map((tag) => tag.toLocaleLowerCase()))
    return requestedTags.every((tag) => routeTags.has(tag))
  })
}
