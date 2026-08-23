import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Coordinate, MapStyleId, RouteBounds, RouteSegment } from '../../data/types'
import { gcj02ToWgs84, wgs84PathToGcj02, wgs84ToGcj02 } from '../../lib/amap/coords'
import { getCurrentWgs84Fix } from '../../lib/amap/geolocation'
import { AmapLoadFailure, getAmapRuntimeConfig, loadAmap } from '../../lib/amap/loadAmap'
import { getAmapStyleUrl } from '../../lib/amap/mapStyles'
import type {
  AMapNamespace,
  AmapLoadStatus,
  AmapMapInstance,
  AmapMarkerInstance,
  AmapOverlayInstance,
  AmapPolylineInstance
} from '../../lib/amap/types'
import { amapLngLatTuple } from '../../lib/amap/types'
import type { LocationFix } from '../../lib/navigation/geo'
import { routeSegmentParts } from '../../lib/routing/routeSegments'
import { PixelIcon } from '../icons/PixelIcon'

export type NetrinMapHandle = {
  recenter: () => void
  followCoordinate: (coordinate: Coordinate) => void
  focusCoordinate: (coordinate: Coordinate, zoom?: number) => void
  focusBounds: (bounds: RouteBounds) => void
  resetNorth: () => void
  fitRoute: () => void
}

export type MapCameraMode = 'overview' | 'follow' | 'manualBrowse'

export type StopMarker = {
  id: string
  location: Coordinate
  index: number
  label?: string
}

export type AmapNetrinMapProps = {
  /** All coordinates crossing this boundary are WGS-84. */
  route: Coordinate[]
  routeSegments?: RouteSegment[]
  navigationPath?: RouteSegment
  network?: Coordinate[][]
  stops?: StopMarker[]
  you?: Coordinate
  activeStopId?: string
  onSelectStop?: (id: string) => void
  onMapBackgroundClick?: () => void
  locate?: boolean
  onLocationChange?: (fix: LocationFix) => void
  transformLocationFix?: (fix: LocationFix) => LocationFix | Promise<LocationFix>
  onBearingChange?: (bearing: number) => void
  onCameraModeChange?: (mode: MapCameraMode) => void
  navigationActive?: boolean
  recenterControl?: boolean
  recenterLabel?: string
  compactControls?: boolean
  onMapClick?: (coordinate: Coordinate) => void
  onBoundsChange?: (bounds: RouteBounds) => void
  draftPoint?: Coordinate
  rawPoint?: Coordinate
  framed?: boolean
  label?: string
  interactive?: boolean
  showCompass?: boolean
  compassLabel?: string
  className?: string
  mapStyleId?: MapStyleId
}

const NATIONAL_CENTER: Coordinate = [104.1954, 35.8617]
const NATIONAL_ZOOM = 4
const INK = '#0b0c0e'
const WHITE = '#f4f5f2'
const GUIDE = '#9cff6f'
const STOP_MARKER_REFERENCE_ZOOM = 16
const STOP_MARKER_SCALE_PER_ZOOM = 0.14
const STOP_MARKER_MIN_SCALE = 0.58
const STOP_MARKER_MAX_SCALE = 1.42

type DeviceOrientationEventWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number }
type DeviceOrientationEventConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const normalizeHeading = (value: number) => ((value % 360) + 360) % 360

function isFiniteCoordinate(coordinate: Coordinate | undefined): coordinate is Coordinate {
  return Boolean(
    coordinate &&
    Number.isFinite(coordinate[0]) &&
    Number.isFinite(coordinate[1])
  )
}

function isFiniteBounds(bounds: RouteBounds): boolean {
  return (
    Number.isFinite(bounds.minLng) &&
    Number.isFinite(bounds.minLat) &&
    Number.isFinite(bounds.maxLng) &&
    Number.isFinite(bounds.maxLat) &&
    bounds.minLng <= bounds.maxLng &&
    bounds.minLat <= bounds.maxLat
  )
}

function headingFromEvent(event: DeviceOrientationEventWithCompass): number | undefined {
  if (typeof event.webkitCompassHeading === 'number') return normalizeHeading(event.webkitCompassHeading)
  return typeof event.alpha === 'number' ? normalizeHeading(360 - event.alpha) : undefined
}

function locationFixFromPosition(position: GeolocationPosition): LocationFix {
  return {
    coordinate: [position.coords.longitude, position.coords.latitude],
    accuracy: position.coords.accuracy,
    heading:
      typeof position.coords.heading === 'number' && Number.isFinite(position.coords.heading)
        ? normalizeHeading(position.coords.heading)
        : undefined,
    timestamp: position.timestamp
  }
}

export async function requestNetrinHeadingPermission(): Promise<void> {
  if (typeof window === 'undefined') return
  const eventCtor = window.DeviceOrientationEvent as
    | DeviceOrientationEventConstructorWithPermission
    | undefined
  if (typeof eventCtor?.requestPermission !== 'function') return
  try {
    await eventCtor.requestPermission()
  } catch {
    // Heading is an enhancement; the position marker remains useful without it.
  }
}

function readWgs84FromMapEvent(event: unknown): Coordinate | null {
  const lnglat = (event as { lnglat?: unknown }).lnglat
  const point = amapLngLatTuple(lnglat as Parameters<typeof amapLngLatTuple>[0])
  return point ? gcj02ToWgs84(point) as Coordinate : null
}

function createStopMarkerElement(stop: StopMarker, active: boolean): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = `netmap-stop${active ? ' netmap-stop--active' : ''}`
  element.setAttribute('aria-label', stop.label ?? String(stop.index))
  const badge = document.createElement('span')
  badge.className = 'netmap-stop__badge'
  badge.textContent = String(stop.index)
  element.append(badge)
  return element
}

function createLocationMarkerElement(
  variant: 'you' | 'raw' | 'draft',
  heading: number,
  bearing: number
): HTMLDivElement {
  const element = document.createElement('div')
  element.className = `netmap-location-marker netmap-location-marker--${variant}`
  element.style.setProperty('--netmap-heading', `${normalizeHeading(heading - bearing)}deg`)
  const pulse = document.createElement('span')
  pulse.className = 'netmap-location-marker__pulse'
  const arrow = document.createElement('span')
  arrow.className = 'netmap-location-marker__arrow'
  element.append(pulse, arrow)
  return element
}

function stopMarkerScale(zoom: number): number {
  const scale = 1 + (zoom - STOP_MARKER_REFERENCE_ZOOM) * STOP_MARKER_SCALE_PER_ZOOM
  return Math.min(STOP_MARKER_MAX_SCALE, Math.max(STOP_MARKER_MIN_SCALE, scale))
}

function attachOverlay(map: AmapMapInstance, overlay: AmapOverlayInstance): void {
  if (overlay.setMap) overlay.setMap(map)
  else map.add?.(overlay)
}

function detachOverlays(map: AmapMapInstance | null, overlays: AmapOverlayInstance[]): void {
  overlays.forEach((overlay) => {
    if (overlay.setMap) overlay.setMap(null)
    else map?.remove?.(overlay)
  })
}

export const AmapNetrinMap = forwardRef<NetrinMapHandle, AmapNetrinMapProps>(function AmapNetrinMap(
  {
    route,
    routeSegments = [],
    navigationPath,
    network = [],
    stops = [],
    you,
    activeStopId,
    onSelectStop,
    onMapBackgroundClick,
    locate = false,
    onLocationChange,
    transformLocationFix,
    onBearingChange,
    onCameraModeChange,
    navigationActive = false,
    recenterControl = false,
    recenterLabel = 'Recenter',
    compactControls = false,
    onMapClick,
    onBoundsChange,
    draftPoint,
    rawPoint,
    framed = false,
    label,
    interactive = true,
    showCompass = true,
    compassLabel = 'Reset north',
    className = '',
    mapStyleId = 'dark'
  },
  ref
) {
  const { t } = useTranslation()
  const runtimeConfig = useMemo(() => getAmapRuntimeConfig(), [])
  const [status, setStatus] = useState<AmapLoadStatus>(runtimeConfig.hasKey ? 'idle' : 'missing-key')
  const [errorMessage, setErrorMessage] = useState('')
  const [bearing, setBearing] = useState(0)
  const [liveCoordinate, setLiveCoordinate] = useState<Coordinate | undefined>(you)
  const [liveHeading, setLiveHeading] = useState(0)
  const [appearanceRevision, setAppearanceRevision] = useState(0)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const amapRef = useRef<AMapNamespace | null>(null)
  const mapRef = useRef<AmapMapInstance | null>(null)
  const routeOverlaysRef = useRef<AmapPolylineInstance[]>([])
  const networkOverlaysRef = useRef<AmapPolylineInstance[]>([])
  const stopMarkersRef = useRef<AmapMarkerInstance[]>([])
  const locationMarkersRef = useRef<AmapMarkerInstance[]>([])
  const routeRef = useRef(route)
  const routeSegmentsRef = useRef(routeSegments)
  const stopsRef = useRef(stops)
  const liveCoordinateRef = useRef(liveCoordinate)
  const userInteractedRef = useRef(false)
  const cameraModeRef = useRef<MapCameraMode>('overview')
  const navigationActiveRef = useRef(navigationActive)
  const hasPublishedLocationRef = useRef(false)
  const locationSequenceRef = useRef(0)
  const onSelectStopRef = useRef(onSelectStop)
  const onMapBackgroundClickRef = useRef(onMapBackgroundClick)
  const onMapClickRef = useRef(onMapClick)
  const onBoundsChangeRef = useRef(onBoundsChange)
  const onLocationChangeRef = useRef(onLocationChange)
  const transformLocationFixRef = useRef(transformLocationFix)
  const onBearingChangeRef = useRef(onBearingChange)
  const onCameraModeChangeRef = useRef(onCameraModeChange)

  routeRef.current = route
  routeSegmentsRef.current = routeSegments
  stopsRef.current = stops
  liveCoordinateRef.current = liveCoordinate
  navigationActiveRef.current = navigationActive
  onSelectStopRef.current = onSelectStop
  onMapBackgroundClickRef.current = onMapBackgroundClick
  onMapClickRef.current = onMapClick
  onBoundsChangeRef.current = onBoundsChange
  onLocationChangeRef.current = onLocationChange
  transformLocationFixRef.current = transformLocationFix
  onBearingChangeRef.current = onBearingChange
  onCameraModeChangeRef.current = onCameraModeChange

  useEffect(() => {
    const refresh = () => setAppearanceRevision((value) => value + 1)
    window.addEventListener('netrin:appearance-change', refresh)
    return () => window.removeEventListener('netrin:appearance-change', refresh)
  }, [])

  const reportCameraMode = (mode: MapCameraMode) => {
    if (cameraModeRef.current === mode) return
    cameraModeRef.current = mode
    onCameraModeChangeRef.current?.(mode)
  }

  const fitToRoute = () => {
    const map = mapRef.current
    if (!map) return
    const overlays = [...routeOverlaysRef.current, ...stopMarkersRef.current]
    if (overlays.length > 0 && map.setFitView) {
      map.setFitView(overlays, false, framed ? [36, 36, 36, 36] : [92, 44, 180, 44], 17)
    } else {
      const point = routeRef.current[0] ?? stopsRef.current[0]?.location ?? liveCoordinateRef.current
      map.setZoomAndCenter?.(
        point ? 16 : NATIONAL_ZOOM,
        wgs84ToGcj02(point ?? NATIONAL_CENTER)
      )
    }
    reportCameraMode('overview')
  }

  const followLocation = (coordinate: Coordinate) => {
    const map = mapRef.current
    if (!map) return
    const position = wgs84ToGcj02(coordinate)
    if (map.setZoomAndCenter) map.setZoomAndCenter(navigationActiveRef.current ? 17 : 16.5, position)
    else map.setCenter(position)
    reportCameraMode('follow')
  }

  const publishFix = async (rawFix: LocationFix, forceFollow = false) => {
    const sequence = locationSequenceRef.current + 1
    locationSequenceRef.current = sequence
    let fix = rawFix
    try {
      fix = (await transformLocationFixRef.current?.(rawFix)) ?? rawFix
    } catch {
      fix = rawFix
    }
    if (sequence !== locationSequenceRef.current) return

    setLiveCoordinate(fix.coordinate)
    liveCoordinateRef.current = fix.coordinate
    if (fix.heading != null) setLiveHeading(normalizeHeading(fix.heading))
    onLocationChangeRef.current?.(fix)

    const shouldFollow =
      !userInteractedRef.current &&
      (forceFollow || !hasPublishedLocationRef.current || cameraModeRef.current === 'follow')
    hasPublishedLocationRef.current = true
    if (shouldFollow) followLocation(fix.coordinate)
  }

  const locateWithAmap = () => {
    void getCurrentWgs84Fix()
      .then((fix) => publishFix(fix, true))
      .catch(() => fitToRoute())
  }

  const recenter = () => {
    void requestNetrinHeadingPermission()
    userInteractedRef.current = false
    if (liveCoordinateRef.current) {
      followLocation(liveCoordinateRef.current)
      return
    }
    if (!navigator.geolocation) {
      locateWithAmap()
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => void publishFix(locationFixFromPosition(position), true),
      locateWithAmap,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
    )
  }

  const followCoordinate = (coordinate: Coordinate) => {
    userInteractedRef.current = false
    setLiveCoordinate(coordinate)
    liveCoordinateRef.current = coordinate
    followLocation(coordinate)
  }

  const focusCoordinate = (coordinate: Coordinate, zoom = 16.5) => {
    const map = mapRef.current
    if (!map || !isFiniteCoordinate(coordinate)) return
    userInteractedRef.current = false
    const position = wgs84ToGcj02(coordinate)
    if (map.setZoomAndCenter) map.setZoomAndCenter(zoom, position)
    else {
      map.setZoom?.(zoom)
      map.setCenter(position)
    }
    reportCameraMode('overview')
  }

  const focusBounds = (bounds: RouteBounds) => {
    const map = mapRef.current
    if (!map || !isFiniteBounds(bounds)) return
    userInteractedRef.current = false
    const center: Coordinate = [
      (bounds.minLng + bounds.maxLng) / 2,
      (bounds.minLat + bounds.maxLat) / 2
    ]
    const span = Math.max(bounds.maxLng - bounds.minLng, bounds.maxLat - bounds.minLat)
    const zoom = span > 8 ? 5 : span > 3 ? 6 : span > 1.2 ? 8 : span > 0.45 ? 10 : 12
    focusCoordinate(center, zoom)
    reportCameraMode('overview')
  }

  const resetNorth = () => {
    mapRef.current?.setRotation?.(0)
    setBearing(0)
    onBearingChangeRef.current?.(0)
  }

  const fitRoute = () => {
    userInteractedRef.current = false
    fitToRoute()
  }

  useImperativeHandle(ref, () => ({
    recenter,
    followCoordinate,
    focusCoordinate,
    focusBounds,
    resetNorth,
    fitRoute
  }))

  useEffect(() => {
    if (!runtimeConfig.hasKey) {
      setStatus('missing-key')
      return
    }
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const initialTarget = routeRef.current[0] ?? stopsRef.current[0]?.location ?? liveCoordinateRef.current
    const initialCenter = initialTarget ?? NATIONAL_CENTER

    const handleMapClick = (event: unknown) => {
      onMapBackgroundClickRef.current?.()
      const coordinate = readWgs84FromMapEvent(event)
      if (coordinate) onMapClickRef.current?.(coordinate)
    }
    const markManualCamera = () => {
      userInteractedRef.current = true
      reportCameraMode('manualBrowse')
    }
    const handleRotation = () => {
      const next = normalizeHeading(mapRef.current?.getRotation?.() ?? 0)
      setBearing(next)
      onBearingChangeRef.current?.(next)
    }
    const handleZoom = () => {
      const zoom = mapRef.current?.getZoom?.()
      if (zoom == null) return
      const scale = stopMarkerScale(zoom).toFixed(3)
      stopMarkersRef.current.forEach((marker) => {
        const content = marker.getContent?.()
        if (content instanceof HTMLElement) content.style.setProperty('--netmap-stop-scale', scale)
      })
    }
    const reportBounds = () => {
      const bounds = mapRef.current?.getBounds?.()
      const southwest = bounds?.getSouthWest?.()
      const northeast = bounds?.getNorthEast?.()
      const sw = amapLngLatTuple(southwest)
      const ne = amapLngLatTuple(northeast)
      if (!sw || !ne) return
      const [minLng, minLat] = gcj02ToWgs84(sw)
      const [maxLng, maxLat] = gcj02ToWgs84(ne)
      onBoundsChangeRef.current?.({ minLng, minLat, maxLng, maxLat })
    }

    setStatus('loading')
    setErrorMessage('')
    void loadAmap()
      .then((AMap) => {
        if (disposed) return
        const map = new AMap.Map(container, {
          center: wgs84ToGcj02(initialCenter),
          zoom: initialTarget ? 15 : NATIONAL_ZOOM,
          resizeEnable: true,
          mapStyle: getAmapStyleUrl(mapStyleId),
          viewMode: '2D',
          pitch: 0,
          rotateEnable: interactive,
          pitchEnable: false,
          dragEnable: interactive,
          zoomEnable: interactive,
          doubleClickZoom: interactive,
          keyboardEnable: interactive
        })
        map.setStatus?.({
          dragEnable: interactive,
          zoomEnable: interactive,
          doubleClickZoom: interactive,
          keyboardEnable: interactive,
          rotateEnable: interactive,
          pitchEnable: false
        })
        map.on('click', handleMapClick)
        map.on('dragstart', markManualCamera)
        map.on('zoomstart', markManualCamera)
        map.on('rotatestart', markManualCamera)
        map.on('rotatechange', handleRotation)
        map.on('zoomchange', handleZoom)
        map.on('moveend', reportBounds)
        map.on('zoomend', reportBounds)
        amapRef.current = AMap
        mapRef.current = map
        setStatus('ready')
        reportBounds()
      })
      .catch((error: unknown) => {
        if (disposed) return
        if (error instanceof AmapLoadFailure && error.code === 'missing-key') {
          setStatus('missing-key')
          return
        }
        setStatus('failed')
        setErrorMessage(error instanceof Error ? error.message : '')
      })

    return () => {
      disposed = true
      const map = mapRef.current
      detachOverlays(map, routeOverlaysRef.current)
      detachOverlays(map, networkOverlaysRef.current)
      detachOverlays(map, stopMarkersRef.current)
      detachOverlays(map, locationMarkersRef.current)
      routeOverlaysRef.current = []
      networkOverlaysRef.current = []
      stopMarkersRef.current = []
      locationMarkersRef.current = []
      if (map) {
        map.off?.('click', handleMapClick)
        map.off?.('dragstart', markManualCamera)
        map.off?.('zoomstart', markManualCamera)
        map.off?.('rotatestart', markManualCamera)
        map.off?.('rotatechange', handleRotation)
        map.off?.('zoomchange', handleZoom)
        map.off?.('moveend', reportBounds)
        map.off?.('zoomend', reportBounds)
        map.destroy()
      }
      mapRef.current = null
      amapRef.current = null
    }
    // Map style and interactions are synchronized without rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeConfig.hasKey])

  useEffect(() => {
    mapRef.current?.setMapStyle?.(getAmapStyleUrl(mapStyleId))
  }, [mapStyleId, status])

  useEffect(() => {
    mapRef.current?.setStatus?.({
      dragEnable: interactive,
      zoomEnable: interactive,
      doubleClickZoom: interactive,
      keyboardEnable: interactive,
      rotateEnable: interactive,
      pitchEnable: false
    })
  }, [interactive, status])

  useEffect(() => {
    if (status !== 'ready') return
    const AMap = amapRef.current
    const map = mapRef.current
    if (!AMap || !map) return

    detachOverlays(map, routeOverlaysRef.current)
    detachOverlays(map, networkOverlaysRef.current)
    const nextRouteOverlays: AmapPolylineInstance[] = []
    const nextNetworkOverlays: AmapPolylineInstance[] = []
    const appearanceRoot = containerRef.current?.closest<HTMLElement>('.app-frame') ?? document.documentElement
    const styles = window.getComputedStyle(appearanceRoot)
    const overlayInk = styles.getPropertyValue('--map-overlay-ink').trim() || INK
    const overlayRoute = styles.getPropertyValue('--map-overlay-route').trim() || WHITE
    const overlayGuide = styles.getPropertyValue('--map-overlay-guide').trim() || GUIDE

    const addPolyline = (
      target: AmapPolylineInstance[],
      coordinates: Coordinate[],
      color: string,
      width: number,
      opacity: number,
      dashed = false,
      zIndex = 50
    ) => {
      if (coordinates.length < 2 || coordinates.some((coordinate) => !isFiniteCoordinate(coordinate))) return
      const overlay = new AMap.Polyline({
        path: wgs84PathToGcj02(coordinates),
        strokeColor: color,
        strokeWeight: width,
        strokeOpacity: opacity,
        strokeStyle: dashed ? 'dashed' : 'solid',
        borderWeight: target === nextRouteOverlays ? 2 : 0,
        outlineColor: overlayInk,
        lineJoin: 'round',
        lineCap: 'round',
        zIndex
      })
      attachOverlay(map, overlay)
      target.push(overlay)
    }

    network.forEach((coordinates) =>
      addPolyline(nextNetworkOverlays, coordinates, overlayRoute, 2, 0.25, false, 20)
    )

    if (routeSegments.length > 0) {
      routeSegments.forEach((segment) => {
        routeSegmentParts(segment).forEach((part) => {
          addPolyline(
            nextRouteOverlays,
            part.coordinates,
            overlayRoute,
            5,
            1,
            false,
            70
          )
        })
      })
    } else {
      addPolyline(nextRouteOverlays, route, overlayRoute, 5, 1, false, 70)
    }

    if (navigationPath) {
      routeSegmentParts(navigationPath).forEach((part) => {
        addPolyline(
          nextRouteOverlays,
          part.coordinates,
          overlayGuide,
          7,
          1,
          false,
          90
        )
      })
    }

    routeOverlaysRef.current = nextRouteOverlays
    networkOverlaysRef.current = nextNetworkOverlays
    if (!userInteractedRef.current && cameraModeRef.current === 'overview') {
      window.requestAnimationFrame(fitToRoute)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearanceRevision, navigationPath, network, route, routeSegments, status])

  useEffect(() => {
    if (status !== 'ready') return
    const AMap = amapRef.current
    const map = mapRef.current
    if (!AMap || !map) return

    detachOverlays(map, stopMarkersRef.current)
    const nextMarkers: AmapMarkerInstance[] = []
    const scale = stopMarkerScale(map.getZoom?.() ?? 16).toFixed(3)
    stops.forEach((stop) => {
      if (!isFiniteCoordinate(stop.location)) return
      const element = createStopMarkerElement(stop, stop.id === activeStopId)
      element.style.setProperty('--netmap-stop-scale', scale)
      element.addEventListener('click', (event) => {
        event.stopPropagation()
        onSelectStopRef.current?.(stop.id)
      })
      const marker = new AMap.Marker({
        position: wgs84ToGcj02(stop.location),
        content: element,
        anchor: 'center',
        zIndex: stop.id === activeStopId ? 110 : 100
      })
      attachOverlay(map, marker)
      nextMarkers.push(marker)
    })
    stopMarkersRef.current = nextMarkers
  }, [activeStopId, status, stops])

  useEffect(() => {
    if (status !== 'ready') return
    const AMap = amapRef.current
    const map = mapRef.current
    if (!AMap || !map) return

    detachOverlays(map, locationMarkersRef.current)
    const nextMarkers: AmapMarkerInstance[] = []
    const addMarker = (coordinate: Coordinate | undefined, variant: 'you' | 'raw' | 'draft', zIndex: number) => {
      if (!isFiniteCoordinate(coordinate)) return
      const marker = new AMap.Marker({
        position: wgs84ToGcj02(coordinate),
        content: createLocationMarkerElement(variant, liveHeading, bearing),
        anchor: 'center',
        zIndex
      })
      attachOverlay(map, marker)
      nextMarkers.push(marker)
    }
    addMarker(liveCoordinate, 'you', 120)
    addMarker(rawPoint, 'raw', 121)
    addMarker(draftPoint, 'draft', 122)
    locationMarkersRef.current = nextMarkers
  }, [bearing, draftPoint, liveCoordinate, liveHeading, rawPoint, status])

  useEffect(() => {
    if (hasPublishedLocationRef.current) return
    setLiveCoordinate(you)
    liveCoordinateRef.current = you
  }, [you])

  useEffect(() => {
    const handleOrientation = (event: DeviceOrientationEvent) => {
      const next = headingFromEvent(event as DeviceOrientationEventWithCompass)
      if (next != null) setLiveHeading(next)
    }
    window.addEventListener('deviceorientation', handleOrientation, true)
    window.addEventListener('deviceorientationabsolute', handleOrientation, true)
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true)
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true)
    }
  }, [])

  useEffect(() => {
    if (!locate || !navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (position) => void publishFix(locationFixFromPosition(position)),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    )
    return () => navigator.geolocation.clearWatch(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locate])

  const showOverlay = status !== 'ready'
  const overlayTitle =
    status === 'missing-key'
      ? t('amap.map.missingKeyTitle')
      : status === 'failed'
        ? t('amap.map.loadFailedTitle')
        : t('amap.map.loadingTitle')
  const overlayHint =
    status === 'missing-key'
      ? t('amap.map.missingKeyHint')
      : status === 'failed'
        ? errorMessage || t('amap.map.loadFailedHint')
        : t('amap.map.loadingHint')

  return (
    <div
      className={[
        'netmap',
        'amap-netrin-map',
        framed ? 'netmap--framed' : '',
        compactControls ? 'netmap--compact-controls' : '',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      data-appearance-hook="map-frame"
    >
      {label ? (
        <span className="netmap__chip">
          <PixelIcon name="compass" size={14} />
          {label}
        </span>
      ) : null}
      <div
        ref={containerRef}
        className={`netmap__canvas amap-netrin-map__canvas ${onMapClick ? 'netmap__canvas--editable' : ''}`.trim()}
        aria-label={t('amap.map.aria')}
      />
      {showOverlay ? (
        <div className="amap-netrin-map__overlay">
          <p className="eyeline">{status === 'missing-key' ? t('amap.status.config') : t('amap.status.loading')}</p>
          <h2>{overlayTitle}</h2>
          <p>{overlayHint}</p>
        </div>
      ) : null}
      {recenterControl ? (
        <button
          type="button"
          className="netmap__recenter"
          data-appearance-hook="map-controls"
          aria-label={recenterLabel}
          onClick={recenter}
        >
          <PixelIcon name="gps" size={compactControls ? 18 : 20} />
        </button>
      ) : null}
      {showCompass && interactive ? (
        <button
          type="button"
          className="netmap__compass"
          data-appearance-hook="map-controls"
          aria-label={compassLabel}
          onClick={resetNorth}
        >
          <span className="netmap__compass-needle" style={{ transform: `rotate(${-bearing}deg)` }}>
            <PixelIcon name="compass" size={compactControls ? 18 : 22} />
          </span>
          <span className="netmap__compass-n">N</span>
        </button>
      ) : null}
    </div>
  )
})

export default AmapNetrinMap
