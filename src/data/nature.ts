import rawNatureData from '../../data/nature.json'
import type {
  ActiveRouteView,
  CommunityRouteDetail,
  DownloadedRoute,
  LocaleCode,
  LocalizedText,
  NatureData,
  RouteDraft,
  TrailRoute,
  TrailStop
} from './types'
import { readHighlightFields, resolveHighlightTitle } from './types'

export const natureData = rawNatureData as NatureData

export const routes: TrailRoute[] = natureData.routes
export const stops: TrailStop[] = natureData.stops

export function textFor(value: LocalizedText, locale: string): string {
  const key: LocaleCode = locale.startsWith('en') ? 'en' : 'zh-CN'
  return value[key] ?? value['zh-CN']
}

export function getRouteById(id: string): TrailRoute | undefined {
  return routes.find((route) => route.id === id)
}

export function getStopsForRoute(route: TrailRoute): TrailStop[] {
  return route.stops
    .map((stopId) => stops.find((stop) => stop.id === stopId))
    .filter((stop): stop is TrailStop => Boolean(stop))
    .sort((a, b) => a.order - b.order)
}

/** 把当前激活路线（随包路线或已下载路线）归一化成 Home 可直接消费的视图。 */
export function resolveActiveRoute(
  activeRouteId: string,
  downloaded: DownloadedRoute[],
  drafts: RouteDraft[] = []
): ActiveRouteView | undefined {
  const trail = getRouteById(activeRouteId)
  if (trail) {
    const routeStops = getStopsForRoute(trail).map((stop) => {
      const fields = readHighlightFields({
        highlightTitle: stop.species.join(' / ') || undefined
      })
      return {
        id: stop.id,
        location: stop.location,
        title: stop.title,
        description: stop.description,
        ...fields,
        media: stop.photoUrl
          ? [{ id: `${stop.id}-media-1`, order: 1, url: stop.photoUrl }]
          : [],
        photoUrl: stop.photoUrl,
        order: stop.order
      }
    })
    return {
      id: trail.id,
      title: trail.title,
      description: trail.description,
      stops: routeStops,
      travelMode: 'walking'
    }
  }

  const downloadedRoute = downloaded.find((route) => route.id === activeRouteId)
  if (downloadedRoute) {
    return {
      id: downloadedRoute.id,
      title: downloadedRoute.title,
      description: downloadedRoute.description,
      stops: downloadedRoute.stops,
      author: downloadedRoute.author,
      travelMode: downloadedRoute.travelMode ?? 'walking',
      geometry: downloadedRoute.geometry,
      geometrySource: downloadedRoute.geometrySource,
      cityAdcode: downloadedRoute.cityAdcode,
      cityName: downloadedRoute.cityName,
      distanceM: downloadedRoute.distanceM,
      durationS: downloadedRoute.durationS,
      difficulty: downloadedRoute.difficulty,
      isLoop: downloadedRoute.isLoop,
      tags: downloadedRoute.tags,
      coverMediaId: downloadedRoute.coverMediaId
    }
  }

  const draft = drafts.find((item) => item.id === activeRouteId)
  return draft ? routeDraftToActiveRoute(draft) : undefined
}

export function routeDraftToActiveRoute(draft: RouteDraft): ActiveRouteView | undefined {
  if (draft.points.length === 0) return undefined

  const routeTitle = draft.title.trim() || 'Untitled route'
  const routeDescription = draft.note.trim()

  return {
    id: draft.id,
    title: { 'zh-CN': routeTitle, en: routeTitle },
    description: { 'zh-CN': routeDescription, en: routeDescription },
    author: '',
    travelMode: draft.travelMode,
    geometry: draft.geometryStatus === 'confirmed' ? draft.geometry : undefined,
    geometrySource: draft.geometryStatus === 'confirmed' ? draft.geometrySource : undefined,
    cityAdcode: draft.cityAdcode,
    cityName: draft.cityName,
    distanceM: draft.distanceM,
    durationS: draft.durationS,
    difficulty: draft.difficulty,
    isLoop: draft.isLoop,
    tags: draft.tags,
    coverMediaId: draft.coverMediaId,
    stops: draft.points.map((point, index) => {
      const highlight = resolveHighlightTitle({
        highlightTitle: point.highlightTitle
      })
      const fields = readHighlightFields({
        highlightTitle: highlight,
        category: point.category
      })
      return {
        id: point.id,
        location: point.final,
        title: highlight
          ? { 'zh-CN': highlight, en: highlight }
          : { 'zh-CN': `关键点 ${index + 1}`, en: `Key point ${index + 1}` },
        description: { 'zh-CN': point.text, en: point.text },
        ...fields,
        media: point.media,
        photoId: point.media[0]?.photoId,
        order: point.index
      }
    })
  }
}

export function resolveLocalRouteDetail(
  routeId: string,
  downloaded: DownloadedRoute[],
  drafts: RouteDraft[]
): CommunityRouteDetail | undefined {
  const route = resolveActiveRoute(routeId, downloaded, drafts)
  if (!route) return undefined
  return {
    ...route,
    author: route.author ?? '',
    downloads: 0,
  }
}
