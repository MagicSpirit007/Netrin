import { useEffect, useMemo, useState } from 'react'
import { useNetrinState } from '../state/NetrinState'
import { resolveLocalRouteDetail } from './nature'
import { fetchRouteDetail, type RouteDetailFetchError } from './routeLibrary'
import type { CommunityRouteDetail, DownloadedRoute, OfflinePackageMeta } from './types'
import { isOfflinePackageStale } from './offlinePackage'

export type RouteDetailState =
  | { phase: 'loading' }
  | { phase: 'ready'; route: CommunityRouteDetail }
  | { phase: 'error'; error: RouteDetailFetchError }

/** Background remote check; never auto-applied over local confirmed geometry. */
export type RemoteRouteDetailState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'ready'; route: CommunityRouteDetail }
  | { phase: 'error'; error: RouteDetailFetchError }

export function hasConfirmedGeometry(route: CommunityRouteDetail | undefined): boolean {
  return Boolean(
    route?.geometry &&
    route.geometry.type === 'LineString' &&
    Array.isArray(route.geometry.coordinates) &&
    route.geometry.coordinates.length >= 2
  )
}

/** Remote may fill the main view only when there is no confirmed local geometry. */
export function shouldAdoptRemoteAsPrimary(localConfirmed: boolean): boolean {
  return !localConfirmed
}

export type OfflineSaveSourcePlan = {
  /**
   * Explicit offline save/refresh uses remote detail whenever it is available
   * (signed media URLs live only on the remote response).
   */
  useRemote: boolean
  /** Local edits would be replaced by remote; UI must confirm first. */
  requiresLocalEditConfirm: boolean
}

/**
 * Decide whether an explicit offline save/refresh should take remote detail.
 * Never auto-overwrites in the hook — only plans a user-triggered save.
 *
 * When remote is available, always use it so refresh can re-sign media URLs.
 * Local-edited downloads always require confirm before that remote adoption.
 */
export function planOfflineSaveSource(input: {
  hasExistingDownload: boolean
  existingIsLocalEdited: boolean
  packageStale: boolean
  remoteAvailable: boolean
}): OfflineSaveSourcePlan {
  if (!input.remoteAvailable) {
    return { useRemote: false, requiresLocalEditConfirm: false }
  }
  return {
    useRemote: true,
    requiresLocalEditConfirm: input.hasExistingDownload && input.existingIsLocalEdited
  }
}

export function packageNeedsRedownloadPrompt(
  existing: Pick<DownloadedRoute, 'remoteUpdatedAt' | 'offlinePackage'> | undefined,
  remoteUpdatedAt: string | undefined
): boolean {
  if (!existing) return false
  return isOfflinePackageStale(existing, remoteUpdatedAt)
}

export function formatPackageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** Build a download record from community detail without marking local edits unless preserved. */
export function toDownloadedRoute(
  source: CommunityRouteDetail,
  options: {
    existing?: DownloadedRoute
    offlinePackage: OfflinePackageMeta
    remoteUpdatedAt?: string
    preserveLocalEdits: boolean
  }
): DownloadedRoute {
  const now = new Date().toISOString()
  return {
    id: source.id,
    remoteRouteId: source.id,
    title: source.title,
    description: source.description,
    author: source.author,
    stops: source.stops,
    travelMode: source.travelMode,
    geometry: source.geometry,
    geometrySource: source.geometrySource,
    cityAdcode: source.cityAdcode,
    cityName: source.cityName,
    distanceM: source.distanceM,
    durationS: source.durationS,
    metricsUpdatedAt: source.metricsUpdatedAt,
    difficulty: source.difficulty,
    isLoop: source.isLoop,
    tags: source.tags,
    coverMediaId: source.coverMediaId,
    downloadedAt: options.existing?.downloadedAt ?? now,
    remoteUpdatedAt: options.remoteUpdatedAt,
    offlinePackage: options.offlinePackage,
    isLocalEdited: options.preserveLocalEdits ? options.existing?.isLocalEdited === true : false,
    localEditedAt: options.preserveLocalEdits ? options.existing?.localEditedAt : undefined
  }
}

/**
 * Prefer a local download/draft with confirmed geometry for immediate ready
 * (offline-safe). When online, still fetch remote in the background and expose
 * it separately — never overwrite the displayed local route automatically.
 */
export function useRouteDetail(routeId: string | undefined) {
  const { downloadedRoutes, routeDrafts } = useNetrinState()
  const [retryToken, setRetryToken] = useState(0)
  const localRoute = useMemo(
    () => (routeId ? resolveLocalRouteDetail(routeId, downloadedRoutes, routeDrafts) : undefined),
    [downloadedRoutes, routeDrafts, routeId]
  )
  const localConfirmed = hasConfirmedGeometry(localRoute)

  const [state, setState] = useState<RouteDetailState>(() =>
    localRoute ? { phase: 'ready', route: localRoute } : { phase: 'loading' }
  )
  const [remoteRoute, setRemoteRoute] = useState<CommunityRouteDetail | undefined>()
  const [remoteStatus, setRemoteStatus] = useState<RemoteRouteDetailState>({ phase: 'idle' })

  useEffect(() => {
    if (!routeId) {
      setState({ phase: 'error', error: 'not-found' })
      setRemoteRoute(undefined)
      setRemoteStatus({ phase: 'idle' })
      return
    }

    // Confirmed local geometry: ready immediately and keep showing local data.
    if (localRoute) {
      setState({ phase: 'ready', route: localRoute })
    } else {
      setState({ phase: 'loading' })
    }

    let alive = true
    setRemoteStatus({ phase: 'checking' })
    void fetchRouteDetail(routeId).then((result) => {
      if (!alive) return
      if (result.ok) {
        setRemoteRoute(result.route)
        setRemoteStatus({ phase: 'ready', route: result.route })
        if (shouldAdoptRemoteAsPrimary(localConfirmed)) {
          setState({ phase: 'ready', route: result.route })
        }
        return
      }
      setRemoteRoute(undefined)
      setRemoteStatus({ phase: 'error', error: result.error })
      if (!localRoute) {
        setState({ phase: 'error', error: result.error })
      }
    })

    return () => {
      alive = false
    }
  }, [localConfirmed, localRoute, retryToken, routeId])

  return {
    state,
    /** Latest successful remote detail, if any; never auto-merged into `state`. */
    remoteRoute,
    remoteStatus,
    localRoute,
    localConfirmed,
    retry: () => setRetryToken((value) => value + 1)
  }
}
