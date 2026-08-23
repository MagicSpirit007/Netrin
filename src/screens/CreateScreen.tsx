import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/core/Button'
import {
  AmapNetrinMap as NetrinMap,
  requestNetrinHeadingPermission,
  type NetrinMapHandle
} from '../components/domain/AmapNetrinMap'
import type { PlaceSearchPhase } from '../components/forms/PlaceSearchPicker'
import { Switch } from '../components/forms/Switch'
import { TextField } from '../components/forms/TextField'
import { PixelIcon } from '../components/icons/PixelIcon'
import { Panel } from '../components/surfaces/Panel'
import { loadMediaBlob, removeMediaBlob, saveMediaBlob } from '../data/drafts'
import {
  MAX_POINT_MEDIA,
  MAX_ROUTE_MEDIA_BYTES,
  type AuthoringMode,
  type Coordinate,
  type RecordedPoint,
  type RouteBounds,
  type RouteDraft
} from '../data/types'
import { createEmptyRouteDraft } from '../data/drafts'
import { useAmapRoutePreview } from '../lib/amap/useRoutePreview'
import { compressImage } from '../lib/image'
import { routeLineFromSegments } from '../lib/routing/routeSegments'
import { snapPoint } from '../lib/snap'
import { discardRoutePublishAttempt } from '../data/routeLibrary'
import { useNetrinState } from '../state/NetrinState'
import type { RouteImportTrack } from '../lib/import/routeImport'
import {
  applyUseRawGps,
  consumeManualCorrectionOnSave,
  type FieldPointComposer
} from './createFieldSnap'
import {
  type MapPlanningCandidate
} from './createMapPlanning'
import type { AmapSearchResult } from '../lib/amap/search'
import { reverseGeocodeWgs84 } from '../lib/amap/geocode'
import manifest from '../manifest'
import { loadAiRouteProviders } from '../lib/ai-route/client'
import '../lib/ai-route/i18n'

const ACTIVE_DRAFT_KEY = 'netrin.activeRouteDraft'
const MapPlanningWorkspace = lazy(() => import('./MapPlanningWorkspace'))

type PointComposer = FieldPointComposer

function reindex(points: RecordedPoint[]): RecordedPoint[] {
  return points.map((point, index) => ({ ...point, index: index + 1 }))
}
function pointPhotoIds(point: RecordedPoint): string[] {
  return point.media.flatMap((item) => (item.photoId ? [item.photoId] : []))
}

async function automaticCityPatch(
  draft: Pick<RouteDraft, 'cityName' | 'cityAdcode'>,
  coordinate: Coordinate,
  knownCity?: Pick<RouteDraft, 'cityName' | 'cityAdcode'>
): Promise<Pick<RouteDraft, 'cityName' | 'cityAdcode'>> {
  if (draft.cityName || draft.cityAdcode) return {}
  if (knownCity?.cityName || knownCity?.cityAdcode) {
    return {
      cityName: knownCity.cityName?.trim() || undefined,
      cityAdcode: knownCity.cityAdcode?.trim() || undefined
    }
  }
  try {
    return await reverseGeocodeWgs84(coordinate)
  } catch {
    return {}
  }
}

function StoredPhoto({ photoId, alt, className }: { photoId: string; alt: string; className: string }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    let active = true
    let objectUrl = ''
    loadMediaBlob(photoId).then((blob) => {
      if (!active || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photoId])

  return url ? <img className={className} src={url} alt={alt} /> : null
}

export function CreateScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { draftId } = useParams()
  const mapRef = useRef<NetrinMapHandle>(null)
  const {
    addRouteDraft,
    appearanceSettings,
    draftsReady,
    removeRouteDraft,
    routeDrafts,
    setSnapToRoads,
    snapToRoads,
    updateRouteDraft
  } = useNetrinState()

  const [activeDraftId, setActiveDraftId] = useState('')
  const [recording, setRecording] = useState(false)
  const [composer, setComposer] = useState<PointComposer | null>(null)
  const [locating, setLocating] = useState(false)
  const [locateFailed, setLocateFailed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const [importTracks, setImportTracks] = useState<RouteImportTrack[]>([])
  const [importError, setImportError] = useState<string>('')
  const [importing, setImporting] = useState(false)
  const [mapSearch, setMapSearch] = useState('')
  const [mapSearchPhase, setMapSearchPhase] = useState<PlaceSearchPhase>('idle')
  const [mapBounds, setMapBounds] = useState<RouteBounds>()
  const [mapSearchCity, setMapSearchCity] =
    useState<{ cityName: string; cityAdcode?: string }>()
  const [mapPlanningCandidate, setMapPlanningCandidate] =
    useState<MapPlanningCandidate | null>(null)
  const [mapAddedIndex, setMapAddedIndex] = useState<number>()
  const [aiRouteAvailable, setAiRouteAvailable] = useState(false)

  useEffect(() => {
    if (manifest.plugins.ai !== 'ai-route-cortex') return
    const controller = new AbortController()
    void loadAiRouteProviders(controller.signal)
      .then((registry) => setAiRouteAvailable(
        registry.providers.some((provider) => provider.toolCalling && provider.allowedModelIds.length > 0)
      ))
      .catch(() => setAiRouteAvailable(false))
    return () => controller.abort()
  }, [])

  const activeDraft = routeDrafts.find((draft) => draft.id === activeDraftId)
  const points = useMemo(() => activeDraft?.points ?? [], [activeDraft])
  const photoCount = points.reduce((total, point) => total + point.media.length, 0)
  const mapStops = useMemo(() => {
    const confirmedStops = points.map((point) => ({
        id: point.id,
        location: point.final,
        index: point.index,
        label: point.text || `${t('record.keyPoint')} ${point.index}`
      }))
    if (!mapPlanningCandidate) return confirmedStops
    return [
      ...confirmedStops,
      {
        id: 'map-planning-candidate',
        location: mapPlanningCandidate.coordinate,
        index: points.length + 1,
        label: mapPlanningCandidate.label || t('record.addAsKeyPoint', {
          index: points.length + 1
        })
      }
    ]
  }, [mapPlanningCandidate, points, t])
  const {
    segments: plannedSegments,
    status: planStatus,
    retry: retryPlan
  } = useAmapRoutePreview(
    points.map((point) => ({ id: point.id, location: point.final })),
    activeDraft?.travelMode ?? 'walking',
    Boolean(
      activeDraft &&
      activeDraft.authoringMode !== 'import' &&
      activeDraft.geometryStatus !== 'confirmed'
    )
  )
  const plannedGeometry = useMemo(
    () => routeLineFromSegments(plannedSegments),
    [plannedSegments]
  )
  const plannedDistanceM = useMemo(
    () => plannedSegments.reduce((total, segment) => total + segment.distanceMeters, 0),
    [plannedSegments]
  )
  const plannedDurationS = useMemo(
    () => plannedSegments.reduce((total, segment) => total + (segment.durationSeconds ?? 0), 0),
    [plannedSegments]
  )

  useEffect(() => {
    if (!activeDraft || activeDraft.authoringMode === 'import') return
    if (activeDraft.geometryStatus === 'confirmed' || planStatus !== 'ready' || plannedGeometry.length < 2) return
    const current = activeDraft.geometryCandidate
    const first = plannedGeometry[0]
    const last = plannedGeometry[plannedGeometry.length - 1]
    const currentCoordinates = current?.geometry.coordinates
    const unchanged =
      current?.source === 'amap-planned' &&
      currentCoordinates?.length === plannedGeometry.length &&
      currentCoordinates[0]?.[0] === first[0] &&
      currentCoordinates[0]?.[1] === first[1] &&
      currentCoordinates[currentCoordinates.length - 1]?.[0] === last[0] &&
      currentCoordinates[currentCoordinates.length - 1]?.[1] === last[1]
    if (unchanged) return
    updateRouteDraft({
      ...activeDraft,
      geometryCandidate: {
        geometry: { type: 'LineString', coordinates: plannedGeometry },
        source: 'amap-planned',
        distanceM: Math.round(plannedDistanceM),
        durationS: plannedDurationS > 0 ? Math.round(plannedDurationS) : undefined,
        generatedAt: new Date().toISOString()
      },
      updatedAt: new Date().toISOString()
    })
  }, [activeDraft, planStatus, plannedDistanceM, plannedDurationS, plannedGeometry, updateRouteDraft])

  useEffect(() => {
    if (!draftsReady || !draftId) return
    const routedDraft = routeDrafts.find((draft) => draft.id === draftId)
    if (!routedDraft) {
      navigate('/create', { replace: true })
      return
    }
    if (activeDraftId !== routedDraft.id) {
      setActiveDraftId(routedDraft.id)
      setSnapToRoads(routedDraft.snapToRoads)
      setRecording(true)
      setComposer(null)
    }
  }, [activeDraftId, draftId, draftsReady, navigate, routeDrafts, setSnapToRoads])

  useEffect(() => {
    if (!draftsReady || activeDraftId) return
    let storedId: string | null = null
    try {
      storedId = window.localStorage.getItem(ACTIVE_DRAFT_KEY)
    } catch {
      return
    }
    const storedDraft = draftId ? undefined : routeDrafts.find((draft) => draft.id === storedId)
    if (storedDraft) {
      setActiveDraftId(storedDraft.id)
      setSnapToRoads(storedDraft.snapToRoads)
    }
  }, [activeDraftId, draftId, draftsReady, routeDrafts, setSnapToRoads])

  useEffect(() => {
    try {
      if (activeDraftId) window.localStorage.setItem(ACTIVE_DRAFT_KEY, activeDraftId)
      else window.localStorage.removeItem(ACTIVE_DRAFT_KEY)
    } catch {
      // The recorder remains usable in memory when localStorage is unavailable.
    }
  }, [activeDraftId])

  useEffect(() => {
    setMapSearch('')
    setMapSearchPhase('idle')
    setMapBounds(undefined)
    setMapSearchCity(undefined)
    setMapPlanningCandidate(null)
    setMapAddedIndex(undefined)
  }, [activeDraftId])

  useEffect(() => {
    if (mapAddedIndex == null) return
    const timer = window.setTimeout(() => setMapAddedIndex(undefined), 3500)
    return () => window.clearTimeout(timer)
  }, [mapAddedIndex])

  const patchDraft = (patch: Partial<RouteDraft>) => {
    if (!activeDraft) return
    updateRouteDraft({
      ...activeDraft,
      ...patch,
      updatedAt: new Date().toISOString()
    })
  }

  const invalidateGeometry = (): Pick<
    RouteDraft,
    'geometryStatus' | 'geometry' | 'geometrySource' | 'distanceM' | 'durationS' | 'metricsUpdatedAt'
  > => ({
    geometryStatus: 'missing',
    geometry: undefined,
    geometrySource: undefined,
    distanceM: undefined,
    durationS: undefined,
    metricsUpdatedAt: undefined
  })

  const invalidateGeometryAndCandidate = (): Partial<RouteDraft> => ({
    ...invalidateGeometry(),
    geometryCandidate: undefined,
    importSummary: activeDraft?.authoringMode === 'import' ? activeDraft.importSummary : undefined
  })

  const confirmPlannedGeometry = () => {
    if (!activeDraft) return
    const candidate = activeDraft.geometryCandidate
    if (!candidate || candidate.geometry.coordinates.length < 2) return
    patchDraft({
      geometryStatus: 'confirmed',
      geometry: candidate.geometry,
      geometrySource: candidate.source,
      distanceM: candidate.distanceM,
      durationS: candidate.durationS,
      metricsUpdatedAt: new Date().toISOString(),
      ...editedSubmissionState()
    })
  }

  const editedSubmissionState = (): Pick<RouteDraft, 'syncState' | 'remoteId' | 'rejectionReason'> => (
    activeDraft?.syncState === 'rejected' && activeDraft.remoteId
      ? {
          syncState: 'rejected',
          remoteId: activeDraft.remoteId,
          rejectionReason: activeDraft.rejectionReason
        }
      : { syncState: 'local', remoteId: undefined, rejectionReason: undefined }
  )

  const startNewDraft = (authoringMode: AuthoringMode) => {
    const now = new Date().toISOString()
    const draft: RouteDraft = createEmptyRouteDraft({
      id: `draft-${Date.now()}`,
      authoringMode,
      title: t('record.untitled'),
      note: '',
      snapToRoads,
      now
    })
    addRouteDraft(draft)
    setActiveDraftId(draft.id)
    setRecording(true)
    setSaved(false)
    navigate(`/create/${draft.id}`)
  }

  const continueDraft = (draft: RouteDraft) => {
    setActiveDraftId(draft.id)
    setSnapToRoads(draft.snapToRoads)
    setRecording(true)
    setComposer(null)
    setSaved(false)
    navigate(`/create/${draft.id}`)
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImportError('')
    setImporting(true)
    try {
      const { parseRouteImportFile } = await import('../lib/import/routeImport')
      const tracks = await parseRouteImportFile(file)
      if (tracks.length === 1) {
        await startImportedDraft(tracks[0])
      } else {
        setImportTracks(tracks)
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'invalid-file'
      setImportError(t(`record.importErrors.${code}`))
    } finally {
      setImporting(false)
    }
  }

  const startImportedDraft = async (track: RouteImportTrack) => {
    const now = new Date().toISOString()
    const draft = createEmptyRouteDraft({
      id: `draft-${Date.now()}`,
      authoringMode: 'import',
      title: track.name,
      snapToRoads: false,
      now
    })
    const imported: RouteDraft = {
      ...draft,
      points: track.points,
      geometryCandidate: track.geometryCandidate,
      importSummary: track.summary,
      updatedAt: now
    }
    const cityPatch = await automaticCityPatch(imported, track.points[0].final)
    addRouteDraft({ ...imported, ...cityPatch })
    setActiveDraftId(imported.id)
    setImportTracks([])
    setRecording(true)
    setSaved(false)
    navigate(`/create/${imported.id}`)
  }

  const beginAddPoint = () => {
    void requestNetrinHeadingPermission()
    const fail = () => {
      setLocateFailed(true)
      setLocating(false)
    }
    setLocateFailed(false)
    setLocating(true)
    if (!navigator.geolocation) {
      fail()
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const raw: Coordinate = [position.coords.longitude, position.coords.latitude]
        const accuracyMeters = position.coords.accuracy
        let final: Coordinate = raw
        let snapped = false
        if (snapToRoads) {
          const result = await snapPoint(raw, { accuracyMeters })
          final = result.final
          snapped = result.snapped
        }
        const nextPoint: RecordedPoint = {
          id: `point-${Date.now()}`,
          index: points.length + 1,
          raw,
          final,
          accuracy: accuracyMeters,
          snapped,
          text: '',
          media: []
        }
        setComposer({
          point: nextPoint,
          originalPhotoIds: [],
          isNew: true,
          pendingManualCorrection: false
        })
        setLocating(false)
      },
      fail,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
    )
  }

  const previewMapPoint = (coordinate: Coordinate) => {
    if (!activeDraft || activeDraft.authoringMode !== 'map' || composer) return
    setMapSearch('')
    setMapSearchPhase('idle')
    setMapPlanningCandidate({
      source: 'map-tap',
      coordinate: [coordinate[0], coordinate[1]]
    })
    setMapAddedIndex(undefined)
  }

  const previewAmapResult = (result: AmapSearchResult) => {
    if (
      result.kind === 'city' &&
      activeDraft?.authoringMode === 'map' &&
      !composer
    ) {
      setMapSearchCity({
        cityName: result.cityName || result.label,
        cityAdcode: result.cityAdcode
      })
      setMapPlanningCandidate(null)
      setMapAddedIndex(undefined)
      setMapSearch('')
      setMapSearchPhase('idle')
      if (result.bounds) mapRef.current?.focusBounds(result.bounds)
      else if (result.coordinate) mapRef.current?.focusCoordinate(result.coordinate, 10)
      return
    }
    if (
      !activeDraft ||
      activeDraft.authoringMode !== 'map' ||
      composer ||
      result.kind !== 'place' ||
      !result.coordinate
    ) return
    const candidate: MapPlanningCandidate = {
      source: 'amap-place',
      coordinate: [result.coordinate[0], result.coordinate[1]],
      label: result.label,
      address: result.address,
      cityName: result.cityName,
      cityAdcode: result.cityAdcode
    }
    setMapPlanningCandidate(candidate)
    setMapAddedIndex(undefined)
    mapRef.current?.focusCoordinate(candidate.coordinate)
  }

  const addMapPlanningCandidate = async () => {
    if (!activeDraft || activeDraft.authoringMode !== 'map' || !mapPlanningCandidate) return
    const { createMapPlanningPoint } =
      await import('./createMapPlanning')
    const nextIndex = points.length + 1
    const nextPoint = createMapPlanningPoint({
      candidate: mapPlanningCandidate,
      id: `point-${Date.now()}`,
      index: nextIndex
    })
    const cityCoordinate = points[0]?.final ?? mapPlanningCandidate.coordinate
    const cityPatch = await automaticCityPatch(
      activeDraft,
      cityCoordinate,
      points.length === 0
        ? {
            cityName: mapPlanningCandidate.cityName,
            cityAdcode: mapPlanningCandidate.cityAdcode
          }
        : undefined
    )
    patchDraft({
      points: [...points, nextPoint],
      ...cityPatch,
      ...invalidateGeometryAndCandidate(),
      ...editedSubmissionState()
    })
    setMapPlanningCandidate(null)
    setMapSearch('')
    setMapSearchPhase('idle')
    setMapAddedIndex(nextIndex)
  }

  const pickPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0 || !composer) return
    setMediaError(false)
    try {
      const remaining = MAX_POINT_MEDIA - composer.point.media.length
      const nextMedia = [...composer.point.media]
      for (const [index, file] of files.slice(0, remaining).entries()) {
        const blob = await compressImage(file)
        if (blob.size > MAX_ROUTE_MEDIA_BYTES) throw new Error('compressed-photo-too-large')
        const photoId = `route-photo-${Date.now()}-${index}`
        await saveMediaBlob(photoId, blob)
        nextMedia.push({ id: photoId, order: nextMedia.length + 1, photoId, mimeType: 'image/jpeg' })
      }
      setComposer({
        ...composer,
        point: { ...composer.point, media: nextMedia }
      })
    } catch {
      setMediaError(true)
    }
    event.target.value = ''
  }

  const removeComposerPhoto = async (photoId: string) => {
    if (!composer) return
    if (!composer.originalPhotoIds.includes(photoId)) {
      await removeMediaBlob(photoId)
    }
    const media = composer.point.media
      .filter((item) => item.photoId !== photoId)
      .map((item, index) => ({ ...item, order: index + 1 }))
    setComposer({ ...composer, point: { ...composer.point, media } })
  }

  const cancelComposer = async () => {
    if (composer) {
      await Promise.all(
        pointPhotoIds(composer.point)
          .filter((photoId) => !composer.originalPhotoIds.includes(photoId))
          .map(removeMediaBlob)
      )
    }
    setComposer(null)
  }

  const resetWorkspace = async () => {
    await cancelComposer()
    try {
      window.localStorage.removeItem(ACTIVE_DRAFT_KEY)
    } catch {
      // The in-memory reset still closes the workspace when localStorage is unavailable.
    }
    setActiveDraftId('')
    setRecording(false)
    setLocating(false)
    setLocateFailed(false)
    setSaved(false)
    setMediaError(false)
    navigate('/create')
  }

  const savePoint = async () => {
    if (!composer || !activeDraft) return
    const { composer: settled } = consumeManualCorrectionOnSave(composer)
    const existingIndex = points.findIndex((point) => point.id === settled.point.id)
    const nextPoints =
      existingIndex >= 0
        ? points.map((point) => (point.id === settled.point.id ? settled.point : point))
        : [...points, settled.point]
    const indexedPoints = reindex(nextPoints)
    const keptPhotoIds = new Set(pointPhotoIds(settled.point))
    await Promise.all(
      settled.originalPhotoIds
        .filter((photoId) => !keptPhotoIds.has(photoId))
        .map(removeMediaBlob)
    )
    const cityCoordinate = points[0]?.final ?? settled.point.final
    const cityPatch = await automaticCityPatch(activeDraft, cityCoordinate)
    patchDraft({
      points: indexedPoints,
      ...cityPatch,
      ...(settled.isNew && activeDraft.authoringMode !== 'import'
        ? invalidateGeometryAndCandidate()
        : {}),
      ...editedSubmissionState()
    })
    setComposer(null)
  }

  const useRawGpsForComposer = () => {
    if (!composer || !composer.point.snapped) return
    setComposer(applyUseRawGps(composer))
  }

  const editPoint = (point: RecordedPoint) => {
    setComposer({
      point: { ...point, media: point.media.map((item) => ({ ...item })) },
      originalPhotoIds: pointPhotoIds(point),
      isNew: false,
      pendingManualCorrection: false
    })
    setRecording(true)
  }

  const deletePoint = async (point: RecordedPoint) => {
    if (composer?.point.id === point.id) await cancelComposer()
    await Promise.all(pointPhotoIds(point).map(removeMediaBlob))
    const nextPoints = reindex(points.filter((item) => item.id !== point.id))
    patchDraft({
      points: nextPoints,
      ...(nextPoints.length === 0
        ? { cityName: undefined, cityAdcode: undefined }
        : {}),
      ...(activeDraft?.authoringMode === 'import' ? {} : invalidateGeometryAndCandidate()),
      ...editedSubmissionState()
    })
    if (composer?.point.id === point.id) setComposer(null)
  }

  const movePoint = (pointId: string, direction: -1 | 1) => {
    const index = points.findIndex((point) => point.id === pointId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= points.length) return
    const next = [...points]
    ;[next[index], next[target]] = [next[target], next[index]]
    const nextPoints = reindex(next)
    patchDraft({
      points: nextPoints,
      ...(activeDraft?.authoringMode === 'import' ? {} : invalidateGeometryAndCandidate()),
      ...editedSubmissionState()
    })
  }

  const removeDraft = async (draft: RouteDraft) => {
    if (composer && activeDraftId === draft.id) await cancelComposer()
    await discardRoutePublishAttempt(draft.id)
    await Promise.all(
      draft.points
        .flatMap(pointPhotoIds)
        .map(removeMediaBlob)
    )
    removeRouteDraft(draft.id)
    if (activeDraftId === draft.id) {
      setActiveDraftId('')
      setRecording(false)
      setComposer(null)
    }
  }

  if (!draftId) {
    return (
      <section className="screen create-entry" data-appearance-state={importError ? 'import-error' : importing ? 'importing' : importTracks.length > 1 ? 'track-choice' : 'entry'}>
        <header className="screen-heading" data-appearance-hook="top-bar">
          <h1>{t('record.createTitle')}</h1>
        </header>

        {aiRouteAvailable ? (
          <Panel variant="paper" shadow padding="14px">
            <div className="create-entry__card create-entry__card--ai">
              <PixelIcon name="zap" size={28} />
              <div>
                <b>{t('aiRoute.entryTitle')}</b>
                <p className="quiet">{t('aiRoute.entryHint')}</p>
              </div>
              <Button block variant="solid" icon="zap" onClick={() => navigate('/create/ai')}>
                {t('aiRoute.entryAction')}
              </Button>
            </div>
          </Panel>
        ) : null}

        <div className="create-entry__grid" data-appearance-hook="recorder-panel">
          <Panel variant="dark" padding="14px">
            <div className="create-entry__card">
              <PixelIcon name="directions" size={26} />
              <div><b>{t('record.mapPlanTitle')}</b><p className="quiet">{t('record.mapPlanHint')}</p></div>
              <Button block variant="solid" icon="plus" onClick={() => startNewDraft('map')}>{t('record.mapPlanAction')}</Button>
            </div>
          </Panel>
          <Panel variant="dark" padding="14px">
            <div className="create-entry__card">
              <PixelIcon name="gps" size={26} />
              <div><b>{t('record.fieldTitle')}</b><p className="quiet">{t('record.fieldHint')}</p></div>
              <Button block variant="solid" icon="play" onClick={() => startNewDraft('field')}>{t('record.fieldAction')}</Button>
            </div>
          </Panel>
          <Panel variant="dark" padding="14px">
            <div className="create-entry__card">
              <PixelIcon name="download" size={26} />
              <div><b>{t('record.importTitle')}</b><p className="quiet">{t('record.importHint')}</p></div>
              <label className="nbtn nbtn--solid nbtn--block kp-pick">
                <PixelIcon name="download" size={18} />
                <span>{importing ? t('record.importing') : t('record.importAction')}</span>
                <input type="file" accept=".gpx,.geojson,.json,application/gpx+xml,application/geo+json,application/json" hidden disabled={importing} onChange={(event) => void importFile(event)} />
              </label>
              {importError ? <p className="form-error">{importError}</p> : null}
            </div>
          </Panel>
        </div>

        {importTracks.length > 1 ? (
          <Panel variant="paper" shadow padding="14px">
            <div className="stack">
              <h2 className="section-title">{t('record.chooseTrack')}</h2>
              {importTracks.map((track) => (
                <Button key={track.id} block variant="dark" icon="directions" onClick={() => void startImportedDraft(track)}>
                  {track.name} · {track.summary.coordinateCount}
                </Button>
              ))}
              <Button block variant="ghost" icon="close" onClick={() => setImportTracks([])}>{t('common.cancel')}</Button>
            </div>
          </Panel>
        ) : null}

        <div className="stack">
          <h2 className="section-title">{t('record.latestDrafts')}</h2>
          {routeDrafts.length === 0 ? <p className="quiet">{t('common.empty')}</p> : routeDrafts.map((draft) => (
            <Panel key={draft.id} variant="dark" padding="12px">
              <div className="draft-row">
                <div className="draft-row__body">
                  <b>{draft.title || t('record.untitled')}</b>
                  <span>{t(`record.authoringModes.${draft.authoringMode}`)} · {t('record.draftSummary', { points: draft.points.length, photos: draft.points.reduce((total, point) => total + point.media.length, 0) })}</span>
                </div>
                <Button size="sm" variant="solid" icon="play" onClick={() => continueDraft(draft)}>{t('record.continue')}</Button>
                <Button size="sm" variant="ghost" icon="delete" aria-label={t('record.deleteDraft')} onClick={() => void removeDraft(draft)} />
              </div>
            </Panel>
          ))}
        </div>
      </section>
    )
  }

  if (!activeDraft) {
    return <section className="screen"><p className="quiet" role="status">{t('common.loading')}</p></section>
  }

  const isMapPlanning = activeDraft.authoringMode === 'map'
  const isFieldRecording = activeDraft.authoringMode === 'field'
  const isAiGenerated = activeDraft.authoringMode === 'ai'
  const screenTitle = isMapPlanning
    ? t('record.mapPlanTitle')
    : isFieldRecording
      ? t('record.fieldTitle')
      : isAiGenerated
        ? t('aiRoute.title')
        : t('record.importTitle')
  const screenSubtitle = isMapPlanning
    ? t('home.searchMapHint')
    : isFieldRecording
      ? t('record.subtitle')
      : isAiGenerated
        ? t('aiRoute.editorHint')
        : t('record.importEditHint')
  const appearanceState = isMapPlanning
    ? mapPlanningCandidate
      ? 'place-preview'
      : mapSearchPhase === 'loading'
        ? 'searching'
        : points.length > 0
          ? 'planning'
          : 'planning-idle'
    : mediaError
      ? 'media-error'
      : saved
        ? 'saved'
        : composer
          ? 'editing-point'
          : locating
            ? 'locating'
            : recording
              ? 'recording'
              : 'idle'
  const mapPanel = (
    <Panel variant="paper" shadow padding="0" style={{ overflow: 'hidden' }}>
      <div className={isMapPlanning ? 'map-planner__map' : 'route-editor__map'}>
        <NetrinMap
          ref={mapRef}
          route={activeDraft?.geometryStatus === 'confirmed'
            ? activeDraft.geometry?.coordinates ?? []
            : activeDraft?.geometryCandidate?.geometry.coordinates ?? []}
          routeSegments={activeDraft?.geometryStatus === 'confirmed' || activeDraft?.geometryCandidate ? [] : plannedSegments}
          stops={mapStops}
          onMapClick={isMapPlanning ? previewMapPoint : undefined}
          onBoundsChange={isMapPlanning ? setMapBounds : undefined}
          mapStyleId={appearanceSettings.mapStyleId}
          recenterControl
          recenterLabel={t('home.followLocation')}
          compassLabel={t('home.resetNorth')}
          compactControls
        />
      </div>
    </Panel>
  )

  return (
    <section
      className="screen"
      data-appearance-state={appearanceState}
    >
      <header className="screen-heading" data-appearance-hook="top-bar">
        <div className="screen-head-row">
          <div><h1>{screenTitle}</h1><p>{screenSubtitle}</p></div>
          <Button size="sm" variant="dark" icon="arrow-left" onClick={() => void resetWorkspace()}>{t('record.backToCreate')}</Button>
        </div>
      </header>

      {!composer ? (
        isMapPlanning ? (
          <Suspense fallback={<p className="quiet" role="status">{t('common.loading')}</p>}>
            <MapPlanningWorkspace
              search={mapSearch}
              city={
                mapSearchCity?.cityAdcode ||
                mapSearchCity?.cityName ||
                activeDraft.cityAdcode ||
                activeDraft.cityName
              }
              searchCityName={mapSearchCity?.cityName}
              bounds={mapBounds}
              candidate={mapPlanningCandidate}
              pointCount={points.length}
              addedIndex={mapAddedIndex}
              onSearchChange={(value) => {
                setMapSearch(value)
                if (!value.trim()) setMapPlanningCandidate(null)
              }}
              onSearchPhaseChange={setMapSearchPhase}
              onSelectSearchResult={previewAmapResult}
              onCancelCandidate={() => setMapPlanningCandidate(null)}
              onAddCandidate={addMapPlanningCandidate}
            >
              {mapPanel}
            </MapPlanningWorkspace>
          </Suspense>
        ) : mapPanel
      ) : null}

      <Panel variant="dark" padding="14px">
          <div className="record-controls" data-appearance-hook="recorder-panel">
          {activeDraft ? (
            <div className="route-mode-control" role="group" aria-label={t('record.travelMode')}>
              <span className="route-mode-control__label">{t('record.travelMode')}</span>
              <div className="rec-grid">
                <Button
                  variant={activeDraft.travelMode === 'walking' ? 'solid' : 'dark'}
                  icon="directions"
                  onClick={() => patchDraft({
                    travelMode: 'walking',
                    ...invalidateGeometryAndCandidate(),
                    ...editedSubmissionState()
                  })}
                >
                  {t('record.walkingMode')}
                </Button>
                <Button
                  variant={activeDraft.travelMode === 'cycling' ? 'solid' : 'dark'}
                  icon="directions"
                  onClick={() => patchDraft({
                    travelMode: 'cycling',
                    ...invalidateGeometryAndCandidate(),
                    ...editedSubmissionState()
                  })}
                >
                  {t('record.cyclingMode')}
                </Button>
              </div>
            </div>
          ) : null}

          {isFieldRecording ? (
            <div className={`rec-status ${recording ? 'rec-status--on' : ''}`.trim()}>
              <PixelIcon name={recording ? 'play' : 'clock'} size={22} />
              <span className="rec-status__text">
                <b>{recording ? t('record.recordingOn') : t('record.recordingOff')}</b>
                <span>{t('record.status', { points: points.length, photos: photoCount })}</span>
              </span>
            </div>
          ) : isMapPlanning ? (
            <div className="map-planner__progress" role="status">
              <PixelIcon name="directions" size={22} />
              <span className="rec-status__text">
                <b>{t('record.mapPointCount', { count: points.length })}</b>
                <span>{t('record.geometryNeedsPoints')}</span>
              </span>
            </div>
          ) : null}

          {composer ? (
            <div className="kp-composer">
              <div className="kp-composer__head">
                <span className="kp-composer__title">
                  {t('record.keyPoint')} {composer.point.index}
                </span>
                <span className="kp-coords">
                  {composer.point.final[0].toFixed(5)}, {composer.point.final[1].toFixed(5)}
                </span>
              </div>

              {isFieldRecording ? (
                <>
                  <div className="location-readout">
                    <span>
                      {composer.point.snapped ? t('record.snapped') : t('record.rawLocation')}
                    </span>
                    <span>
                      {t('record.accuracy', {
                        value: Math.round(composer.point.accuracy ?? 0)
                      })}
                    </span>
                  </div>
                  {composer.point.snapped ? (
                    <Button
                      block
                      size="sm"
                      variant="dark"
                      data-testid="use-raw-gps"
                      onClick={useRawGpsForComposer}
                    >
                      {t('record.useRawGps')}
                    </Button>
                  ) : null}
                  <p className="quiet">{t('record.editorMapHidden')}</p>
                </>
              ) : (
                <p className="quiet">
                  {isMapPlanning ? t('record.addPhotoDesc') : t('record.importEditHint')}
                </p>
              )}

              {composer.point.media.length > 0 ? (
                <div className="kp-preview-grid" data-appearance-hook="media-gallery">
                  {composer.point.media.map((item) =>
                    item.photoId ? (
                      <div className="kp-preview" key={item.id}>
                        <StoredPhoto
                          photoId={item.photoId}
                          alt={t('record.photo')}
                          className=""
                        />
                        <button
                          type="button"
                          className="kp-preview__remove"
                          aria-label={t('record.removePhoto')}
                          onClick={() => void removeComposerPhoto(item.photoId!)}
                        >
                          <PixelIcon name="close" size={16} />
                        </button>
                      </div>
                    ) : null
                  )}
                </div>
              ) : null}
              {composer.point.media.length < MAX_POINT_MEDIA ? (
                <label className="nbtn nbtn--dark nbtn--block kp-pick">
                  <PixelIcon name="camera" size={18} />
                  <span>{t('record.addPhoto')} ({composer.point.media.length}/{MAX_POINT_MEDIA})</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    hidden
                    onChange={(event) => void pickPhoto(event)}
                  />
                </label>
              ) : null}
              {mediaError ? <p className="quiet">{t('record.photoUnavailable')}</p> : null}

              <TextField
                label={t('record.pointDesc')}
                value={composer.point.text}
                onChange={(text) =>
                  setComposer({
                    ...composer,
                    point: { ...composer.point, text }
                  })
                }
                multiline
                rows={2}
              />
              <TextField
                label={t('record.highlightTitle')}
                value={composer.point.highlightTitle ?? ''}
                onChange={(highlightTitle) =>
                  setComposer({
                    ...composer,
                    point: {
                      ...composer.point,
                      highlightTitle
                    }
                  })
                }
              />
              <TextField
                label={t('record.highlightCategory')}
                value={composer.point.category ?? ''}
                maxLength={80}
                onChange={(category) => setComposer({
                  ...composer,
                  point: { ...composer.point, category: category.trim() || undefined }
                })}
              />
              <div className="rec-grid">
                <Button variant="dark" icon="close" onClick={() => void cancelComposer()}>
                  {t('record.cancel')}
                </Button>
                <Button variant="solid" icon="check" onClick={() => void savePoint()}>
                  {t('record.saveKeyPoint')}
                </Button>
              </div>
            </div>
          ) : isFieldRecording && recording ? (
            <>
              <Button block icon="gps" disabled={locating} onClick={beginAddPoint}>
                {locating ? t('record.locating') : t('record.markKeyPoint')}
              </Button>
              {locateFailed ? <p className="quiet">{t('record.locateUnavailable')}</p> : null}
              <Button
                block
                variant="dark"
                icon="flag"
                onClick={() => void resetWorkspace()}
              >
                {t('record.stop')}
              </Button>
            </>
          ) : isFieldRecording ? (
            <Button block icon="play" onClick={() => setRecording(true)}>
              {t('record.resume')}
            </Button>
          ) : isMapPlanning ? (
            null
          ) : (
            <p className="quiet">{isAiGenerated ? t('aiRoute.editorHint') : t('record.importEditHint')}</p>
          )}

          {activeDraft.authoringMode === 'field' ? (
            <div className="rec-snap rec-snap--gps">
              <PixelIcon name="directions" size={22} />
              <span className="rec-snap__text">
                <b>{t('record.snap')}</b>
                <span>{snapToRoads ? t('record.snapOn') : t('record.snapOff')}</span>
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                  {t('record.snapAttribution')}
                </a>
              </span>
              <Switch
                checked={snapToRoads}
                onChange={(enabled) => {
                  setSnapToRoads(enabled)
                  patchDraft({ snapToRoads: enabled })
                }}
                label={t('record.snap')}
              />
            </div>
          ) : null}

          {activeDraft.importSummary ? (
            <div className="route-import-summary">
              <b>{activeDraft.importSummary.fileName}</b>
              <span>{t('record.importSummary', {
                before: activeDraft.importSummary.originalCoordinateCount,
                after: activeDraft.importSummary.coordinateCount
              })}</span>
              <span>{t('record.importPrivacy')}</span>
            </div>
          ) : null}

          {activeDraft ? (
            <div className="route-plan-confirm" data-appearance-hook="route-plan-confirmation">
              <div className="route-plan-confirm__copy">
                <b>{t('record.routeGeometry')}</b>
                {activeDraft.geometryStatus === 'confirmed' ? (
                  <span>{t('record.geometryConfirmed', {
                    distance: Math.round(activeDraft.distanceM ?? 0),
                    duration: Math.round((activeDraft.durationS ?? 0) / 60)
                  })}</span>
                ) : points.length < 2 ? (
                  <span>{t('record.geometryNeedsPoints')}</span>
                ) : activeDraft.geometryCandidate ? (
                  <span>{t('record.geometryReady', {
                    distance: Math.round(activeDraft.geometryCandidate.distanceM ?? 0),
                    duration: Math.round((activeDraft.geometryCandidate.durationS ?? 0) / 60)
                  })}</span>
                ) : planStatus === 'loading' ? (
                  <span>{t('record.geometryPlanning')}</span>
                ) : planStatus === 'error' ? (
                  <span>{t('record.geometryUnavailable')}</span>
                ) : planStatus === 'ready' ? (
                  <span>{t('record.geometryReady', {
                    distance: Math.round(plannedDistanceM),
                    duration: Math.round(plannedDurationS / 60)
                  })}</span>
                ) : (
                  <span>{t('record.geometryNeedsPoints')}</span>
                )}
              </div>
              {activeDraft.geometryStatus === 'confirmed' ? (
                <Button
                  size="sm"
                  variant="dark"
                  icon="reload"
                  onClick={() => patchDraft({
                    ...(activeDraft.authoringMode === 'import' ? invalidateGeometry() : invalidateGeometryAndCandidate()),
                    ...editedSubmissionState()
                  })}
                >
                  {t('record.replanGeometry')}
                </Button>
              ) : planStatus === 'error' ? (
                <Button size="sm" variant="dark" icon="reload" onClick={retryPlan}>
                  {t('common.retry')}
                </Button>
              ) : activeDraft.geometryCandidate ? (
                <Button size="sm" variant="solid" icon="check" onClick={confirmPlannedGeometry}>
                  {t('record.confirmGeometry')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Panel>

      <div className="stack">
        <h2 className="section-title">
          {isMapPlanning || isAiGenerated ? t('record.mapOrderedPoints') : t('record.recorded')}
        </h2>
        {points.length === 0 ? (
          <p className="quiet">
            {isMapPlanning ? t('record.mapPlanHint') : t('record.noPoints')}
          </p>
        ) : (
          <div className="timeline">
            {points.map((point, index) => (
              <div className="tl-item" key={point.id}>
                <div className="tl-rail">
                  <span className="tl-node">{point.index}</span>
                </div>
                <div className="tl-card" data-appearance-hook="route-point-card">
                  {isMapPlanning ? (
                    <span className="map-planner__point-role">
                      {t(`record.mapPointRoles.${
                        index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'via'
                      }`)}
                    </span>
                  ) : null}
                  {point.media[0]?.photoId ? (
                    <StoredPhoto
                      photoId={point.media[0].photoId!}
                      alt={t('record.photo')}
                      className="tl-photo"
                    />
                  ) : null}
                  {point.highlightTitle ? (
                    <span className="tl-species">{point.highlightTitle}</span>
                  ) : isMapPlanning ? (
                    <span className="tl-species">{t('record.keyPoint')}</span>
                  ) : null}
                  {point.text ? <p className="tl-text">{point.text}</p> : null}
                  <span className="tl-coords">
                    {point.final[0].toFixed(5)}, {point.final[1].toFixed(5)}
                    {point.snapped ? ` · ${t('record.snappedShort')}` : ''}
                  </span>
                  <div className="point-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="chevron-up"
                      disabled={index === 0}
                      aria-label={t('record.moveUp')}
                      onClick={() => void movePoint(point.id, -1)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="chevron-down"
                      disabled={index === points.length - 1}
                      aria-label={t('record.moveDown')}
                      onClick={() => void movePoint(point.id, 1)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="feather"
                      aria-label={t('record.editPoint')}
                      onClick={() => editPoint(point)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="delete"
                      aria-label={t('record.deletePoint')}
                      onClick={() => void deletePoint(point)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeDraft ? (
        <Panel variant="dark" padding="14px">
          <div className="record-meta">
            <TextField
              label={t('record.routeTitle')}
              value={activeDraft.title}
              onChange={(title) => patchDraft({ title, ...editedSubmissionState() })}
              placeholder={t('record.untitled')}
            />
            <TextField
              label={t('record.note')}
              value={activeDraft.note}
              onChange={(note) => patchDraft({ note, ...editedSubmissionState() })}
              multiline
              rows={2}
              className="record-meta__note"
            />
            <label className="nfield">
              <span className="nfield__label">{t('record.difficulty')}</span>
              <select
                value={activeDraft.difficulty ?? ''}
                onChange={(event) => patchDraft({
                  difficulty: event.target.value
                    ? event.target.value as RouteDraft['difficulty']
                    : undefined,
                  ...editedSubmissionState()
                })}
              >
                <option value="">{t('record.difficultyUnset')}</option>
                <option value="easy">{t('record.difficulties.easy')}</option>
                <option value="moderate">{t('record.difficulties.moderate')}</option>
                <option value="hard">{t('record.difficulties.hard')}</option>
              </select>
            </label>
            <TextField
              label={t('record.tags')}
              value={(activeDraft.tags ?? []).join(', ')}
              placeholder={t('record.tagsHint')}
              onChange={(value) => patchDraft({
                tags: value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 10),
                ...editedSubmissionState()
              })}
            />
            <div className="rec-snap">
              <PixelIcon name="reload" size={22} />
              <span className="rec-snap__text"><b>{t('record.isLoop')}</b><span>{activeDraft.isLoop ? t('common.yes') : t('common.no')}</span></span>
              <Switch checked={activeDraft.isLoop === true} onChange={(isLoop) => patchDraft({ isLoop, ...editedSubmissionState() })} label={t('record.isLoop')} />
            </div>
            {points.some((point) => point.media.length > 0) ? (
              <div className="record-cover-picker">
                <b>{t('record.cover')}</b>
                <div className="record-cover-picker__options">
                  {points.flatMap((point) => point.media).map((media, index) => (
                    <Button
                      key={media.id}
                      size="sm"
                      variant={activeDraft.coverMediaId === media.id ? 'solid' : 'dark'}
                      icon={activeDraft.coverMediaId === media.id ? 'check' : 'image'}
                      onClick={() => patchDraft({ coverMediaId: media.id, ...editedSubmissionState() })}
                    >
                      {t('record.coverOption', { index: index + 1 })}
                    </Button>
                  ))}
                  {activeDraft.coverMediaId ? <Button size="sm" variant="ghost" icon="close" onClick={() => patchDraft({ coverMediaId: undefined, ...editedSubmissionState() })}>{t('common.clear')}</Button> : null}
                </div>
              </div>
            ) : null}
            <Button
              block
              variant="solid"
              icon="check"
              onClick={() => {
                patchDraft(editedSubmissionState())
                setSaved(true)
              }}
            >
              {t('record.saveDraft')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {saved ? <p className="save-message">{t('record.saved')}</p> : null}

      <div className="stack">
        <h2 className="section-title">{t('record.latestDrafts')}</h2>
        {routeDrafts.length === 0 ? (
          <p className="quiet">{t('common.empty')}</p>
        ) : (
          <div className="draft-list">
            {routeDrafts.map((draft) => (
              <Panel key={draft.id} variant="dark" padding="12px">
                <div className="draft-row">
                  <div className="draft-row__body">
                    <b>{draft.title || t('record.untitled')}</b>
                    <span>
                      {t('record.draftSummary', {
                        points: draft.points.length,
                        photos: draft.points.reduce((total, point) => total + point.media.length, 0)
                      })}
                    </span>
                  </div>
                  <Button size="sm" variant="solid" icon="play" onClick={() => continueDraft(draft)}>
                    {t('record.continue')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="delete"
                    aria-label={t('record.deleteDraft')}
                    onClick={() => void removeDraft(draft)}
                  />
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
