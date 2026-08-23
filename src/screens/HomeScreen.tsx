import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/core/Button'
import { IconButton } from '../components/core/IconButton'
import {
  AmapNetrinMap as NetrinMap,
  type MapCameraMode,
  type NetrinMapHandle
} from '../components/domain/AmapNetrinMap'
import { PixelIcon, type PixelIconName } from '../components/icons/PixelIcon'
import { RouteStopPhoto } from '../components/domain/RouteStopPhoto'
import { Panel } from '../components/surfaces/Panel'
import { SearchField } from '../components/forms/SearchField'
import { resolveActiveRoute, textFor } from '../data/nature'
import type { ActiveRouteView, ActiveStop, Coordinate, RoutePlanStep, RouteSegment } from '../data/types'
import { lineLengthMeters, projectPointToLine, type LocationFix } from '../lib/navigation/geo'
import { snapPoint } from '../lib/snap'
import { planRouteSegment } from '../lib/amap/routePlanning'
import { useAmapRoutePreview, type RoutePreviewStatus } from '../lib/amap/useRoutePreview'
import { routeLineFromSegments } from '../lib/routing/routeSegments'
import { searchAmap, type AmapSearchResult } from '../lib/amap/search'
import {
  continueFromStop,
  createNavigationState,
  getNavigationOutput,
  moveToNextStop,
  moveToPreviousStop,
  reduceGuideFalsePositive,
  reduceGuideLocationFix,
  setNavigationLocationError,
  shouldAdvanceNavigation,
  startNavigation,
  type NavigationPhase,
  type NavigationState
} from '../lib/navigation/navigationEngine'
import { useNetrinState } from '../state/NetrinState'

type HomeDetail = {
  index: string
  label: string
  title: string
  description?: string
  stop?: ActiveStop
  focus: boolean
}
type HomeSearchItem = AmapSearchResult | {
  id: string
  kind: 'stop'
  label: string
  address?: string
  coordinate: Coordinate
}

function closestProviderStep(
  steps: RoutePlanStep[] | undefined,
  position: Coordinate | undefined
): RoutePlanStep | undefined {
  if (!steps?.length) return undefined
  if (!position) return steps[0]
  return steps.reduce<{ step: RoutePlanStep; distance: number } | undefined>((best, step) => {
    const projection = projectPointToLine(position, step.coordinates)
    const distance = projection?.distanceMeters ?? Number.POSITIVE_INFINITY
    return !best || distance < best.distance ? { step, distance } : best
  }, undefined)?.step
}

function getBrowserPosition(): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('geolocation-unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          coordinate: [pos.coords.longitude, pos.coords.latitude],
          accuracy: pos.coords.accuracy,
          heading:
            typeof pos.coords.heading === 'number' && Number.isFinite(pos.coords.heading)
              ? pos.coords.heading
              : undefined,
          timestamp: pos.timestamp
        }),
      reject,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )
  })
}

export function HomeScreen({ routeOverride }: { routeOverride?: ActiveRouteView } = {}) {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const {
    activeRouteId,
    appearanceSettings,
    downloadedRoutes,
    routeDrafts,
    setNavigationActive,
    snapToRoads
  } = useNetrinState()
  const selectedRoute = useMemo(
    () => resolveActiveRoute(activeRouteId, downloadedRoutes, routeDrafts),
    [activeRouteId, downloadedRoutes, routeDrafts]
  )
  const activeRoute = routeOverride ?? selectedRoute
  const activeStops = useMemo(() => activeRoute?.stops ?? [], [activeRoute])
  const mapRef = useRef<NetrinMapHandle | null>(null)
  const guideRequestIdRef = useRef(0)
  const navigationPathRequestIdRef = useRef(0)
  const galleryRef = useRef<HTMLDivElement | null>(null)
  const stopCardRefs = useRef<Map<string, HTMLElement>>(new Map())
  /** Mirror of navigationState for pure reducers outside setState updaters. */
  const navigationStateRef = useRef<NavigationState>(createNavigationState(activeRoute?.id))
  /** Prevents double-click / replay from recording two false-positive counters. */
  const falsePositiveArmedRef = useRef(true)

  const [selectedStopId, setSelectedStopId] = useState(activeStops[0]?.id ?? '')
  const [previewStopId, setPreviewStopId] = useState<string>()
  const [expanded, setExpanded] = useState(false)
  const [pendingStopScrollId, setPendingStopScrollId] = useState<string>()
  const [navigationState, setNavigationState] = useState<NavigationState>(() =>
    createNavigationState(activeRoute?.id)
  )
  const [navigationPath, setNavigationPath] = useState<RouteSegment>()
  const [navigationPlanStatus, setNavigationPlanStatus] = useState<RoutePreviewStatus>('idle')
  const [navigationRetryToken, setNavigationRetryToken] = useState(0)
  const [lastLocationFix, setLastLocationFix] = useState<LocationFix | undefined>(undefined)
  const [cameraMode, setCameraMode] = useState<MapCameraMode>('overview')
  const [searchOpen, setSearchOpen] = useState(false)
  const [mapSearch, setMapSearch] = useState('')
  const [searchResults, setSearchResults] = useState<HomeSearchItem[]>([])
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const {
    segments: overviewSegments,
    status: overviewPlanStatus
  } = useAmapRoutePreview(
    activeStops,
    activeRoute?.travelMode ?? 'walking',
    !activeRoute?.geometry
  )

  const activeRouteLine = useMemo(
    () => activeRoute?.geometry?.coordinates ?? routeLineFromSegments(overviewSegments),
    [activeRoute?.geometry, overviewSegments]
  )
  const overviewDistanceMeters = useMemo(
    () => activeRoute?.distanceM ?? overviewSegments.reduce((total, segment) => total + segment.distanceMeters, 0),
    [activeRoute?.distanceM, overviewSegments]
  )
  const overviewDurationSeconds = useMemo(
    () => activeRoute?.durationS ?? overviewSegments.reduce((total, segment) => total + (segment.durationSeconds ?? 0), 0),
    [activeRoute?.durationS, overviewSegments]
  )

  useEffect(() => {
    setSelectedStopId(activeStops[0]?.id ?? '')
    setPreviewStopId(undefined)
    setExpanded(false)
    setPendingStopScrollId(undefined)
    setNavigationState(createNavigationState(activeRoute?.id))
    setNavigationPath(undefined)
    setNavigationPlanStatus('idle')
    setCameraMode('overview')
  }, [activeRoute?.id, activeStops])

  useEffect(() => {
    const query = mapSearch.trim().toLowerCase()
    if (!searchOpen || !query) {
      setSearchResults([])
      setSearchStatus('idle')
      return
    }
    const local: HomeSearchItem[] = activeStops.flatMap((stop) => {
      const title = textFor(stop.title, i18n.language)
      const description = textFor(stop.description, i18n.language)
      return `${title} ${description}`.toLowerCase().includes(query)
        ? [{ id: `stop-${stop.id}`, kind: 'stop' as const, label: title, address: description, coordinate: stop.location }]
        : []
    })
    setSearchResults(local)
    setSearchStatus('loading')
    let cancelled = false
    const timer = window.setTimeout(() => {
      void searchAmap(mapSearch).then((remote) => {
        if (cancelled) return
        setSearchResults([...local, ...remote])
        setSearchStatus('ready')
      }).catch(() => {
        if (cancelled) return
        setSearchResults(local)
        setSearchStatus(local.length ? 'ready' : 'error')
      })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeStops, i18n.language, mapSearch, searchOpen])

  const selectedStop = activeStops.find((stop) => stop.id === selectedStopId) ?? activeStops[0]
  const previewStop = activeStops.find((stop) => stop.id === previewStopId)
  const navigationOutput = useMemo(
    () =>
      activeRoute
        ? getNavigationOutput(
            activeRoute,
            navigationState,
            selectedStop,
            navigationPath?.coordinates ?? []
          )
        : undefined,
    [activeRoute, navigationPath, navigationState, selectedStop]
  )
  const navigationPhase = navigationState.phase
  const isNavigationMode = navigationPhase !== 'idle'
  const isTravelingPhase = navigationPhase === 'toStart' || navigationPhase === 'following'

  useEffect(() => {
    navigationStateRef.current = navigationState
    // Re-arm false-positive once we leave offRoute so a later alert can be dismissed once.
    if (navigationState.phase !== 'offRoute') {
      falsePositiveArmedRef.current = true
    }
  }, [navigationState])
  const isManualBrowse =
    cameraMode === 'manualBrowse' && isTravelingPhase
  const isRouteOverview = cameraMode === 'overview' && isTravelingPhase
  const isCameraDetached = isManualBrowse || isRouteOverview
  const visibleStop = navigationOutput?.visibleStop
  const visibleIndex = navigationOutput?.visibleStopIndex ?? 0
  const activeMapStopId = previewStop?.id ?? navigationOutput?.activeMapStopId ?? selectedStop?.id
  const targetDistance = navigationOutput?.targetDistanceMeters
  const targetDistanceText =
    targetDistance == null
      ? undefined
      : targetDistance < 1000
        ? t('home.distanceMeters', { value: Math.max(1, Math.round(targetDistance)) })
        : t('home.distanceKm', { value: (targetDistance / 1000).toFixed(1) })
  const completedStopCount =
    navigationPhase === 'completed'
      ? activeStops.length
      : navigationPhase === 'atStop'
        ? Math.min(activeStops.length, navigationState.currentStopIndex + 1)
        : Math.min(activeStops.length, navigationState.currentStopIndex)
  const progressText = t('home.keyPointProgress', {
    current: completedStopCount,
    total: activeStops.length
  })
  const navigationTargetCoordinate = navigationOutput?.targetCoordinate
  const navigationTargetId =
    navigationOutput?.targetStop?.id ??
    (navigationPhase === 'toStart' || (navigationPhase === 'lowAccuracy' && navigationState.resumePhase === 'toStart')
      ? activeStops[0]?.id ?? 'route-start'
      : undefined)
  const navigationOrigin = useMemo(() => {
    const previousStop = activeStops[navigationState.currentStopIndex - 1]
    const followsStoredLeg =
      navigationPhase === 'following' && navigationState.currentStopIndex > 0 && previousStop
    return followsStoredLeg ? previousStop.location : navigationState.currentPosition
  }, [activeStops, navigationPhase, navigationState.currentPosition, navigationState.currentStopIndex])
  const navigationStartKey = navigationOrigin
    ? `${Math.round(navigationOrigin[0] * 5000)}:${Math.round(navigationOrigin[1] * 5000)}`
    : ''
  const navigationTargetKey = navigationTargetCoordinate
    ? `${navigationTargetCoordinate[0].toFixed(6)}:${navigationTargetCoordinate[1].toFixed(6)}`
    : ''
  const isPathNavigationPhase =
    navigationPhase === 'toStart' ||
    navigationPhase === 'following' ||
    navigationPhase === 'offRoute' ||
    navigationPhase === 'lowAccuracy'
  const providerStep = useMemo(
    () => closestProviderStep(navigationPath?.steps, navigationState.currentPosition),
    [navigationPath, navigationState.currentPosition]
  )
  const providerStepDistanceText = providerStep
    ? providerStep.distanceMeters < 1000
      ? t('home.distanceMeters', { value: Math.max(1, Math.round(providerStep.distanceMeters)) })
      : t('home.distanceKm', { value: (providerStep.distanceMeters / 1000).toFixed(1) })
    : undefined
  const providerInstruction = providerStep?.instruction || undefined

  useEffect(() => {
    setNavigationActive(isNavigationMode)
  }, [isNavigationMode, setNavigationActive])

  useEffect(
    () => () => {
      setNavigationActive(false)
    },
    [setNavigationActive]
  )

  useEffect(() => {
    if (
      !activeRoute ||
      !navigationOrigin ||
      !navigationTargetCoordinate ||
      !isPathNavigationPhase
    ) {
      navigationPathRequestIdRef.current += 1
      setNavigationPath(undefined)
      setNavigationPlanStatus('idle')
      return
    }

    const requestId = navigationPathRequestIdRef.current + 1
    navigationPathRequestIdRef.current = requestId
    const from = navigationOrigin
    const to = navigationTargetCoordinate
    const toPointId = navigationTargetId ?? 'navigation-target'
    const segmentId = `navigation-${activeRoute.id}-${toPointId}-${navigationStartKey}`
    const followsStoredGeometry =
      navigationPhase === 'following' ||
      (navigationPhase === 'lowAccuracy' && navigationState.resumePhase === 'following')
    if (followsStoredGeometry && activeRoute.geometry?.coordinates.length) {
      navigationPathRequestIdRef.current += 1
      setNavigationPath({
        id: `stored-${activeRoute.id}`,
        fromPointId: 'route-start',
        toPointId,
        coordinates: activeRoute.geometry.coordinates,
        kind: 'network',
        distanceMeters: activeRoute.distanceM ?? lineLengthMeters(activeRoute.geometry.coordinates),
        coordSystem: 'WGS-84'
      })
      setNavigationPlanStatus('ready')
      return
    }
    setNavigationPath((previous) => (previous?.toPointId === toPointId ? previous : undefined))
    setNavigationPlanStatus('loading')

    planRouteSegment({
      id: segmentId,
      fromPointId: 'current-location',
      toPointId,
      from,
      to,
      travelMode: activeRoute.travelMode,
      purpose: 'guidance',
      fromSnapped: false,
      toSnapped: false
    })
      .then((segment) => {
        if (navigationPathRequestIdRef.current !== requestId) return
        setNavigationPath(segment)
        setNavigationPlanStatus('ready')
      })
      .catch(() => {
        if (navigationPathRequestIdRef.current !== requestId) return
        setNavigationPath(undefined)
        setNavigationPlanStatus('error')
      })
  }, [
    activeRoute,
    isPathNavigationPhase,
    navigationPhase,
    navigationStartKey,
    navigationState.resumePhase,
    navigationRetryToken,
    navigationTargetCoordinate,
    navigationTargetId,
    navigationTargetKey,
    snapToRoads
  ])

  const transformLocationFix = useCallback(
    async (fix: LocationFix): Promise<LocationFix> => {
      if (!snapToRoads) return fix
      const result = await snapPoint(fix.coordinate, { accuracyMeters: fix.accuracy })
      return result.snapped ? { ...fix, coordinate: result.final } : fix
    },
    [snapToRoads]
  )

  const mapStops = useMemo(
    () =>
      activeStops.map((stop, index) => ({
        id: stop.id,
        location: stop.location,
        index: index + 1,
        label: textFor(stop.title, i18n.language)
      })),
    [activeStops, i18n.language]
  )

  useEffect(() => {
    if (navigationPhase === 'idle') return
    const targetStop = navigationOutput?.targetStop
    if (targetStop) setSelectedStopId(targetStop.id)
    setPreviewStopId(undefined)
    setExpanded(false)
    setPendingStopScrollId(undefined)
  }, [navigationOutput?.targetStop?.id, navigationPhase])

  useEffect(() => {
    if (!expanded || !pendingStopScrollId) return
    const frame = window.requestAnimationFrame(() => {
      const gallery = galleryRef.current
      const card = stopCardRefs.current.get(pendingStopScrollId)
      if (gallery && card) {
        const galleryRect = gallery.getBoundingClientRect()
        const cardRect = card.getBoundingClientRect()
        gallery.scrollTo({
          top: gallery.scrollTop + cardRect.top - galleryRect.top,
          behavior: 'smooth'
        })
      }
      setPendingStopScrollId(undefined)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [expanded, pendingStopScrollId])

  const handleSelectStop = (id: string) => {
    setSelectedStopId(id)
    setPreviewStopId(id)
    setPendingStopScrollId(undefined)
    setExpanded(false)
  }

  const handleSearchResult = (item: HomeSearchItem) => {
    if (item.kind === 'city' && item.cityAdcode) {
      const params = new URLSearchParams({ city: item.cityAdcode })
      if (item.cityName) params.set('cityName', item.cityName)
      navigate(`/discover?${params.toString()}`)
      return
    }
    if (item.kind === 'stop') handleSelectStop(item.id.replace(/^stop-/, ''))
    if (item.coordinate) mapRef.current?.followCoordinate(item.coordinate)
    setSearchOpen(false)
  }

  const handleToggleExpanded = () => {
    if (expanded) {
      setExpanded(false)
      setPendingStopScrollId(undefined)
      setPreviewStopId(undefined)
      return
    }

    setPendingStopScrollId(previewStop?.id ?? navigationOutput?.activeMapStopId ?? selectedStop?.id)
    setPreviewStopId(undefined)
    setExpanded(true)
  }

  const commitNavigationState = useCallback((next: NavigationState) => {
    navigationStateRef.current = next
    setNavigationState(next)
  }, [])

  const handleLocationChange = useCallback(
    (fix: LocationFix) => {
      setLastLocationFix(fix)
      if (!activeRoute) return

      const previous = navigationStateRef.current
      const pathPhase =
        previous.phase === 'toStart' ||
        previous.phase === 'following' ||
        previous.phase === 'offRoute' ||
        previous.phase === 'lowAccuracy'
      const allowAdvance =
        shouldAdvanceNavigation(previous.phase) &&
        !(pathPhase && navigationPlanStatus !== 'ready')

      const { state: next } = reduceGuideLocationFix({
        route: activeRoute,
        state: previous,
        fix,
        activeLeg: navigationPath?.coordinates ?? [],
        allowAdvance
      })


      commitNavigationState(next)
    },
    [activeRoute, commitNavigationState, navigationPath, navigationPlanStatus]
  )

  const handleOffRouteFalsePositive = useCallback(() => {
    const previous = navigationStateRef.current
    const { state: next, qualityIntent } = reduceGuideFalsePositive(previous)
    if (qualityIntent !== 'off-route-false-positive') return
    // One click → one counter, even if the handler is re-entered before re-render.
    if (!falsePositiveArmedRef.current) return
    falsePositiveArmedRef.current = false

    commitNavigationState(next)
  }, [commitNavigationState])

  const handleBeginGuide = () => {
    if (!activeRoute) return
    setPreviewStopId(undefined)
    setExpanded(false)
    setPendingStopScrollId(undefined)

    if (lastLocationFix) {
      commitNavigationState(startNavigation(activeRoute, lastLocationFix))
      mapRef.current?.followCoordinate(lastLocationFix.coordinate)
      return
    }

    const requestId = guideRequestIdRef.current + 1
    guideRequestIdRef.current = requestId
    commitNavigationState({ ...createNavigationState(activeRoute.id), phase: 'acquiring' })
    getBrowserPosition()
      .then(transformLocationFix)
      .then((fix) => {
        if (guideRequestIdRef.current !== requestId) return
        setLastLocationFix(fix)
        commitNavigationState(startNavigation(activeRoute, fix))
        mapRef.current?.followCoordinate(fix.coordinate)
      })
      .catch(() => {
        if (guideRequestIdRef.current !== requestId) return
        const previous = navigationStateRef.current
        commitNavigationState(
          setNavigationLocationError(
            previous.routeId === activeRoute.id ? previous : createNavigationState(activeRoute.id)
          )
        )
      })
  }

  const handleEndGuide = () => {
    guideRequestIdRef.current += 1
    setPreviewStopId(undefined)
    setExpanded(false)
    setPendingStopScrollId(undefined)
    commitNavigationState(createNavigationState(activeRoute?.id))
    setNavigationPath(undefined)
    setNavigationPlanStatus('idle')
    setSelectedStopId(activeStops[0]?.id ?? '')
  }

  const handleNextStop = () => {
    if (!activeRoute) return
    setPreviewStopId(undefined)
    const previous = navigationStateRef.current
    const next =
      previous.phase === 'atStop'
        ? continueFromStop(activeRoute, previous)
        : moveToNextStop(activeRoute, previous)
    commitNavigationState(next)
  }

  const handlePreviousStop = () => {
    if (!activeRoute) return
    setPreviewStopId(undefined)
    commitNavigationState(moveToPreviousStop(activeRoute, navigationStateRef.current))
  }

  const statusLabel = (() => {
    if (isPathNavigationPhase && navigationPlanStatus === 'error') return t('home.routeUnavailableLabel')
    if (isPathNavigationPhase && navigationPlanStatus === 'loading') return t('home.routePlanningLabel')
    if (isManualBrowse) return t('home.manualBrowseLabel')
    if (isRouteOverview) return t('home.routeOverview')
    if (navigationPhase === 'acquiring') return t('home.guidanceAcquiring')
    if (navigationPhase === 'toStart') return t('home.guidingToStart')
    if (navigationPhase === 'following') return t('home.guidingToStop')
    if (navigationPhase === 'atStop') return t('home.reachedKeyPoint')
    if (navigationPhase === 'offRoute') return t('home.offRouteLabel')
    if (navigationPhase === 'lowAccuracy') return t('home.lowAccuracyLabel')
    if (navigationPhase === 'completed') return t('home.guideCompleted')
    if (navigationPhase === 'locationError') return t('home.locationErrorLabel')
    if (cameraMode === 'manualBrowse') return t('home.manualBrowseLabel')
    return t('home.routeNow')
  })()

  const guidanceIcon: PixelIconName =
    navigationPlanStatus === 'error' ||
    navigationPhase === 'acquiring' ||
    navigationPhase === 'lowAccuracy' ||
    navigationPhase === 'locationError'
      ? 'gps'
      : navigationPhase === 'atStop' || navigationPhase === 'completed'
        ? 'check'
        : /左|left/i.test(providerInstruction ?? '')
          ? 'turn-left'
          : /右|right/i.test(providerInstruction ?? '')
            ? 'turn-right'
            : providerInstruction
              ? 'arrow-up'
        : navigationPhase === 'offRoute'
          ? 'compass'
          : navigationPhase === 'toStart'
            ? 'flag'
            : 'directions'

  const navigationDetail =
    isPathNavigationPhase && navigationPlanStatus === 'error'
      ? {
          index: '!',
          label: t('home.routeUnavailableLabel'),
          title: t('home.routeUnavailableTitle'),
          description: t('home.routeUnavailableHint'),
          focus: true
        }
      : buildHomeDetail(navigationPhase, visibleStop, visibleIndex)
  const previewStopIndex = previewStop
    ? Math.max(0, activeStops.findIndex((stop) => stop.id === previewStop.id))
    : 0
  const previewDetail: HomeDetail | undefined = previewStop
    ? {
        index: String(previewStopIndex + 1),
        label: t('home.stopPreview'),
        title: textFor(previewStop.title, i18n.language),
        description: textFor(previewStop.description, i18n.language),
        stop: previewStop,
        focus: false
      }
    : undefined
  const detail = previewDetail ?? navigationDetail
  const isPreviewDetail = Boolean(previewDetail)
  const showDetail = Boolean(detail && (expanded || isPreviewDetail))
  const canMoveToPreviousStop =
    isNavigationMode && navigationState.currentStopIndex > 0 && activeStops.length > 0

  function buildHomeDetail(
    phase: NavigationPhase,
    stop: ActiveStop | undefined,
    stopIndex: number
  ): HomeDetail | undefined {
    if (phase === 'acquiring') {
      return {
        index: 'GPS',
        label: t('home.guidanceAcquiring'),
        title: t('home.locationPendingTitle'),
        description: t('home.locationPendingHint'),
        focus: true
      }
    }
    if (phase === 'locationError') {
      return {
        index: 'GPS',
        label: t('home.locationErrorLabel'),
        title: t('home.locationErrorTitle'),
        description: t('home.locationErrorHint'),
        focus: true
      }
    }
    if (phase === 'lowAccuracy') {
      return {
        index: 'GPS',
        label: t('home.lowAccuracyLabel'),
        title: t('home.lowAccuracyTitle'),
        description: t('home.lowAccuracyHint'),
        focus: true
      }
    }
    if (phase === 'offRoute') {
      return {
        index: '!',
        label: t('home.offRouteLabel'),
        title: t('home.offRouteTitle'),
        description: t('home.offRouteHint'),
        focus: true
      }
    }
    if (phase === 'toStart') {
      return {
        index: t('home.startMarker'),
        label: t('home.currentTarget'),
        title: t('home.routeStartTitle'),
        description: t('home.routeStartHint'),
        focus: false
      }
    }
    if (phase === 'completed') {
      return {
        index: 'OK',
        label: t('home.guideCompleted'),
        title: t('home.guideDoneTitle'),
        description: t('home.guideDoneHint'),
        focus: true
      }
    }
    if (stop) {
      return {
        index: String(stopIndex + 1),
        label: phase === 'atStop' ? t('home.reachedKeyPoint') : t('home.nextStop'),
        title: textFor(stop.title, i18n.language),
        description: textFor(stop.description, i18n.language),
        stop,
        focus: phase === 'atStop'
      }
    }
    return undefined
  }

  return (
    <div
      className={`home ${isNavigationMode ? 'home--navigating' : 'home--preview'}`}
      data-appearance-state={
        !activeRoute
          ? 'no-route'
          : !isNavigationMode
            ? 'preview'
            : navigationPlanStatus === 'loading'
              ? 'route-loading'
              : navigationPlanStatus === 'error'
                ? 'route-error'
                : navigationPhase === 'atStop'
                  ? 'at-point'
                  : navigationPhase === 'completed'
                    ? 'completed'
                    : navigationPhase === 'acquiring'
                      ? 'locating'
                      : 'navigating'
      }
    >
      <div className="home__map">
        <NetrinMap
          ref={mapRef}
          route={activeRouteLine}
          routeSegments={activeRoute?.geometry ? [] : overviewSegments}
          navigationPath={navigationPath}
          stops={mapStops}
          activeStopId={activeMapStopId}
          onSelectStop={handleSelectStop}
          onMapBackgroundClick={() => setPreviewStopId(undefined)}
          onLocationChange={handleLocationChange}
          onCameraModeChange={setCameraMode}
          transformLocationFix={transformLocationFix}
          navigationActive={isNavigationMode}
          showCompass={false}
          mapStyleId={appearanceSettings.mapStyleId}
          locate={isNavigationMode}
        />
      </div>

      {isNavigationMode && activeRoute ? (
        <section className="home__nav-banner" aria-label={statusLabel} data-appearance-hook="navigation-instruction">
          <div className="home__nav-turn">
            <PixelIcon name={guidanceIcon} size={44} />
          </div>
          <div className="home__nav-instruction">
            <span>{statusLabel}</span>
            <h1>
              {(providerStepDistanceText ?? targetDistanceText) && navigationPhase !== 'atStop'
                ? providerStepDistanceText ?? targetDistanceText
                : navigationDetail?.index ?? textFor(activeRoute.title, i18n.language)}
            </h1>
            <p>
              {providerInstruction ??
                navigationDetail?.title ??
                textFor(activeRoute.title, i18n.language)}
            </p>
          </div>
          <div className="home__nav-actions">
            <IconButton
              icon="close"
              label={t('home.endGuide')}
              variant="paper"
              onClick={handleEndGuide}
            />
            <IconButton
              icon="gps"
              label={t('home.followLocation')}
              variant="paper"
              className={isCameraDetached ? 'home__nav-recenter--active' : ''}
              onClick={() => mapRef.current?.recenter()}
            />
          </div>
        </section>
      ) : (
        <header className="home__chrome home__chrome--four-actions" data-appearance-hook="top-bar">
          <div className="home__wordmark" data-appearance-slot="brand-wordmark">
            <b data-appearance-slot="brand-title">NETRIN</b>
            <span className="home__brand-name" data-appearance-slot="brand-name">{t('app.name')}</span>
            <span className="home__live" data-appearance-slot="brand-mark" aria-label={t('app.live')} />
          </div>
          <div className="home__chrome-actions">
            <IconButton
              icon="search"
              label={t('home.searchMap')}
              variant="paper"
              onClick={() => setSearchOpen((value) => !value)}
            />
            <IconButton
              icon="compass"
              label={t('home.resetNorth')}
              variant="paper"
              onClick={() => mapRef.current?.resetNorth()}
            />
            <IconButton
              icon="directions"
              label={t('home.routeOverview')}
              variant="paper"
              onClick={() => mapRef.current?.fitRoute()}
            />
            <IconButton
              icon="gps"
              label={t('home.followLocation')}
              variant="paper"
              onClick={() => mapRef.current?.recenter()}
            />
          </div>
        </header>
      )}

      {!isNavigationMode && searchOpen ? (
        <section className="home__search-panel" aria-label={t('home.searchMap')}>
          <SearchField value={mapSearch} onChange={setMapSearch} onClear={() => setMapSearch('')} placeholder={t('home.searchMapHint')} clearLabel={t('common.clear')} />
          {searchStatus === 'loading' ? <p className="quiet" role="status">{t('home.searching')}</p> : null}
          {searchStatus === 'error' ? <p className="quiet">{t('home.searchUnavailable')}</p> : null}
          {searchStatus === 'ready' && searchResults.length === 0 ? <p className="quiet">{t('home.searchEmpty')}</p> : null}
          <div className="home__search-results">
            {searchResults.map((item) => (
              <button type="button" key={item.id} onClick={() => handleSearchResult(item)}>
                <PixelIcon name={item.kind === 'city' ? 'globe' : item.kind === 'stop' ? 'flag' : 'search'} size={18} />
                <span><b>{item.label}</b><small>{item.kind === 'city' ? t('home.searchCityAction') : item.address}</small></span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="home__sheet" data-appearance-hook="sheet">
        <Panel
          variant="paper"
          shadow
          padding="0"
          className={showDetail && detail?.focus ? 'home__sheet-panel--focus' : ''}
          style={{ overflow: 'hidden' }}
        >
          {activeRoute ? (
            <>
              <div className="home__sheet-main">
                <div className="home__sheet-info">
                  <div className="home__sheet-eyeline">
                    <span className="home__sheet-swatch" style={{ background: 'var(--signal-green)' }} />
                    <span className="home__sheet-label">{statusLabel}</span>
                  </div>
                  <h2 className="home__sheet-title">{textFor(activeRoute.title, i18n.language)}</h2>
                  <div className="home__sheet-stats">
                    {isNavigationMode ? (
                      <>
                        {targetDistanceText && navigationPhase !== 'atStop' ? (
                          <span>{t('home.distanceToTarget', { distance: targetDistanceText })}</span>
                        ) : null}
                        <span>{progressText}</span>
                      </>
                    ) : (
                      <>
                        {overviewDistanceMeters > 0 ? (
                          <span>
                            {overviewDistanceMeters < 1000
                              ? t('home.distanceMeters', { value: Math.round(overviewDistanceMeters) })
                              : t('home.distanceKm', { value: (overviewDistanceMeters / 1000).toFixed(1) })}
                          </span>
                        ) : null}
                        {overviewDurationSeconds > 0 ? (
                          <span>{Math.max(1, Math.round(overviewDurationSeconds / 60))} min</span>
                        ) : null}
                        {overviewPlanStatus === 'loading' ? (
                          <span>{t('home.routePlanningLabel')}</span>
                        ) : null}
                        {overviewPlanStatus === 'error' ? (
                          <span>{t('home.routeUnavailableLabel')}</span>
                        ) : null}
                        <span>
                          {activeStops.length} {t('home.stops')}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="home__sheet-actions">
                  {activeStops.length > 0 ? (
                    <IconButton
                      icon={expanded ? 'chevron-down' : 'chevron-up'}
                      label={expanded ? t('home.hideAllStops') : t('home.showAllStops')}
                      variant="paper"
                      size="sm"
                      onClick={handleToggleExpanded}
                    />
                  ) : null}
                  {isNavigationMode ? (
                    !isPreviewDetail && canMoveToPreviousStop ? (
                      <Button
                        icon="arrow-left"
                        size="sm"
                        className="home__guide-button"
                        onClick={handlePreviousStop}
                      >
                        {t('home.previousKeyPoint')}
                      </Button>
                    ) : null
                  ) : (
                    <Button
                      icon="play"
                      size="sm"
                      className="home__guide-button"
                      onClick={handleBeginGuide}
                    >
                      {t('home.beginRoute')}
                    </Button>
                  )}
                </div>
              </div>
              {!isPreviewDetail && navigationPhase === 'offRoute' ? (
                <div className="home__off-route-actions">
                  <Button
                    block
                    size="sm"
                    variant="dark"
                    className="home__off-route-false-positive"
                    data-testid="off-route-false-positive"
                    onClick={handleOffRouteFalsePositive}
                  >
                    {t('home.offRouteFalsePositive')}
                  </Button>
                </div>
              ) : null}
              {showDetail && detail ? (
                <div
                  className={`home__sheet-next ${detail.focus ? 'home__sheet-next--focus' : ''}`.trim()}
                >
                  <div className="home__sheet-index">{detail.index}</div>
                  <div className="home__sheet-detail">
                    <span className="home__sheet-label">{detail.label}</span>
                    <h3>{detail.title}</h3>
                    <RouteStopPhoto
                      stop={detail.stop}
                      className="home__stop-photo"
                      alt={t('home.stopPhoto', { title: detail.title })}
                    />
                    {detail.stop?.highlightTitle ? (
                      <p className="home__stop-species">
                        <span>{t('home.highlightTitle')}</span>
                        <b>{detail.stop.highlightTitle}</b>
                      </p>
                    ) : null}
                    {detail.description ? <p>{detail.description}</p> : null}
                    {!isPreviewDetail &&
                    targetDistanceText &&
                    (navigationPhase === 'toStart' ||
                      navigationPhase === 'following' ||
                      navigationPhase === 'offRoute' ||
                      navigationPhase === 'lowAccuracy') ? (
                      <p className="home__guide-distance">
                        {t('home.distanceToTarget', { distance: targetDistanceText })}
                      </p>
                    ) : null}
                    {!isPreviewDetail &&
                    isNavigationMode &&
                    navigationPlanStatus !== 'error' &&
                    navigationPhase !== 'acquiring' &&
                    navigationPhase !== 'completed' &&
                    activeStops.length > 0 ? (
                      <Button block icon="arrow-right" onClick={handleNextStop}>
                        {navigationOutput?.hasNextStop ? t('home.nextKeyPoint') : t('home.finishGuide')}
                      </Button>
                    ) : null}
                    {!isPreviewDetail && navigationPlanStatus === 'error' ? (
                      <Button
                        block
                        icon="reload"
                        onClick={() => setNavigationRetryToken((value) => value + 1)}
                      >
                        {t('home.retryRoute')}
                      </Button>
                    ) : null}
                    {!isPreviewDetail &&
                    (navigationPhase === 'completed' || navigationPhase === 'locationError') ? (
                      <Button
                        block
                        icon={navigationPhase === 'completed' ? 'reload' : 'gps'}
                        onClick={handleBeginGuide}
                      >
                        {navigationPhase === 'completed' ? t('home.restartGuide') : t('home.retryGuide')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {expanded && activeStops.length > 0 ? (
                <div ref={galleryRef} className="home__sheet-gallery" aria-label={t('home.stops')} data-appearance-hook="media-gallery">
                  {activeStops.map((stop, index) => {
                    const title = textFor(stop.title, i18n.language)
                    const description = textFor(stop.description, i18n.language)
                    const isTarget = stop.id === activeMapStopId
                    return (
                      <article
                        key={stop.id}
                        ref={(node) => {
                          if (node) stopCardRefs.current.set(stop.id, node)
                          else stopCardRefs.current.delete(stop.id)
                        }}
                        data-stop-id={stop.id}
                        data-appearance-hook="route-point-card"
                        className={`home__sheet-stop ${isTarget ? 'home__sheet-stop--target' : ''}`.trim()}
                      >
                        <div className="home__sheet-stop-index">{index + 1}</div>
                        <div className="home__sheet-stop-body">
                          <h4>{title}</h4>
                          <RouteStopPhoto
                            stop={stop}
                            className="home__sheet-stop-photo"
                            alt={t('home.stopPhoto', { title })}
                          />
                          {stop.highlightTitle ? (
                            <p className="home__stop-species">
                              <span>{t('home.highlightTitle')}</span>
                              <b>{stop.highlightTitle}</b>
                            </p>
                          ) : null}
                          {description ? <p>{description}</p> : null}
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : null}
            </>
          ) : (
            <div className="home__sheet-main" data-appearance-hook="empty-state">
              <div className="home__sheet-info">
                <div className="home__sheet-eyeline">
                  <span className="home__sheet-swatch" style={{ background: 'var(--signal-green)' }} />
                  <span className="home__sheet-label">{t('home.noRouteLabel')}</span>
                </div>
                <h2 className="home__sheet-title">{t('home.noRouteTitle')}</h2>
                <div className="home__sheet-stats">
                  <span>{t('home.noRouteHint')}</span>
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
