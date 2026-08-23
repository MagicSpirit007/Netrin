import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/core/Button'
import { TextField } from '../components/forms/TextField'
import { AmapNetrinMap as NetrinMap } from '../components/domain/AmapNetrinMap'
import { PixelIcon, type PixelIconName } from '../components/icons/PixelIcon'
import { Panel } from '../components/surfaces/Panel'
import {
  discardRoutePublishAttempt,
  fetchOwnedRouteSubmissions,
  publishRouteDraft,
  type PublishResult
} from '../data/routeLibrary'
import { removeMediaBlob } from '../data/drafts'
import { textFor } from '../data/nature'
import { MAP_STYLE_IDS } from '../data/types'
import type {
  Coordinate,
  DownloadedRoute,
  DownloadedStop,
  RouteDraft
} from '../data/types'
import { NETRIN_LANGUAGE_KEY } from '../i18n'
import { useAmapRoutePreview } from '../lib/amap/useRoutePreview'
import { routeLineFromSegments } from '../lib/routing/routeSegments'
import { useNetrinState } from '../state/NetrinState'
import { localAppearanceRepository } from '../appearance/repository'
import type { AppearancePackage } from '../appearance/types'
import { useAuth } from '../auth/AuthProvider'
import { maskChinaPhone } from '../auth/phone'
import type { OwnedRouteSubmission } from '../data/types'

const ACTIVE_DRAFT_KEY = 'netrin.activeRouteDraft'

type ProfileView = 'menu' | 'language' | 'downloads' | 'downloadDetail' | 'offline' | 'submissions' | 'appearance' | 'readme'
type UploadNotice = Exclude<PublishResult, { ok: true }>['error'] | 'success'

const README_SECTION_IDS = ['project', 'map', 'routes', 'appearance', 'privacy', 'rules'] as const
type ReadmeSectionId = (typeof README_SECTION_IDS)[number]

const README_SECTION_ICONS: Record<ReadmeSectionId, PixelIconName> = {
  project: 'info-box',
  map: 'globe',
  routes: 'directions',
  appearance: 'eye',
  privacy: 'lock',
  rules: 'book-open'
}

function getPhotoCount(draft: RouteDraft) {
  return draft.points.reduce((total, point) => total + point.media.length, 0)
}

function getCurrentLanguage(language: string) {
  return language.startsWith('en') ? 'en' : 'zh-CN'
}

function uploadNoticeKey(notice: UploadNotice) {
  return `profile.upload.${notice}`
}

function localizedFromInput(value: string) {
  return { 'zh-CN': value, en: value }
}

function cloneDownloadedRoute(route: DownloadedRoute): DownloadedRoute {
  return {
    ...route,
    title: { ...route.title },
    description: { ...route.description },
    stops: route.stops.map((stop) => ({
      ...stop,
      location: [...stop.location] as Coordinate,
      title: { ...stop.title },
      description: { ...stop.description },
      media: stop.media.map((item) => ({ ...item }))
    }))
  }
}

function reindexStops(stops: DownloadedStop[]): DownloadedStop[] {
  return stops.map((stop, index) => ({ ...stop, order: index + 1 }))
}

export function ProfileScreen() {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const { user, profile, isAnonymous, isAdmin } = useAuth()
  const {
    activeRouteId,
    appearanceSettings,
    downloadedRoutes,
    removeDownload,
    removeRouteDraft,
    routeDrafts,
    setActiveRouteId,
    setSnapToRoads,
    updateAppearanceSettings,
    updateDownloadedRoute,
    updateRouteDraft
  } = useNetrinState()
  const [view, setView] = useState<ProfileView>('menu')
  const [uploadNotices, setUploadNotices] = useState<Record<string, UploadNotice>>({})
  const [selectedDownloadId, setSelectedDownloadId] = useState<string | null>(null)
  const [editingDownload, setEditingDownload] = useState(false)
  const [downloadEditDraft, setDownloadEditDraft] = useState<DownloadedRoute | null>(null)
  const [appearancePackages, setAppearancePackages] = useState<AppearancePackage[]>([])
  const [routeSubmissions, setRouteSubmissions] = useState<OwnedRouteSubmission[]>([])
  const [selectedReadmeSection, setSelectedReadmeSection] = useState<ReadmeSectionId | null>(null)

  const currentLanguage = getCurrentLanguage(i18n.language)
  const selectedDownload = useMemo(
    () => downloadedRoutes.find((route) => route.id === selectedDownloadId),
    [downloadedRoutes, selectedDownloadId]
  )
  const visibleDownload = editingDownload && downloadEditDraft ? downloadEditDraft : selectedDownload
  const hasPersistedDownloadGeometry = Boolean(
    visibleDownload?.geometry?.type === 'LineString' &&
    Array.isArray(visibleDownload.geometry.coordinates) &&
    visibleDownload.geometry.coordinates.length >= 2
  )
  // Prefer persisted WGS-84 geometry offline; only call AMap when geometry is missing.
  const { segments: downloadPreviewSegments } = useAmapRoutePreview(
    visibleDownload?.stops ?? [],
    visibleDownload?.travelMode ?? 'walking',
    view === 'downloadDetail' && !hasPersistedDownloadGeometry
  )

  useEffect(() => {
    if (view !== 'downloadDetail' || !selectedDownloadId || selectedDownload) return
    setView('downloads')
    setSelectedDownloadId(null)
    setEditingDownload(false)
    setDownloadEditDraft(null)
  }, [selectedDownload, selectedDownloadId, view])

  useEffect(() => {
    if (view !== 'appearance') return
    let active = true
    void localAppearanceRepository.list().then((packages) => {
      if (!active) return
      setAppearancePackages(packages)
    })
    return () => {
      active = false
    }
  }, [view, appearanceSettings.appearanceId])

  useEffect(() => {
    if ((view !== 'offline' && view !== 'submissions') || !user || isAnonymous) return
    let active = true
    void fetchOwnedRouteSubmissions().then((submissions) => {
      if (!active) return
      setRouteSubmissions(submissions)
      const byId = new Map(submissions.map((submission) => [submission.id, submission]))
      routeDrafts.forEach((draft) => {
        if (!draft.remoteId) return
        const remote = byId.get(draft.remoteId)
        if (!remote || (
          draft.syncState === remote.moderationStatus &&
          draft.rejectionReason === remote.rejectionReason
        )) return
        updateRouteDraft({
          ...draft,
          syncState: remote.moderationStatus,
          rejectionReason: remote.rejectionReason,
          updatedAt: remote.updatedAt
        })
      })
    })
    return () => { active = false }
  }, [isAnonymous, routeDrafts, updateRouteDraft, user, view])

  const continueDraft = (draft: RouteDraft) => {
    try {
      window.localStorage.setItem(ACTIVE_DRAFT_KEY, draft.id)
    } catch {
      // The Create screen can still open with its in-memory state.
    }
    setSnapToRoads(draft.snapToRoads)
    navigate('/create')
  }

  const deleteDraft = async (draft: RouteDraft) => {
    await discardRoutePublishAttempt(draft.id)
    await Promise.all(
      draft.points
        .flatMap((point) => point.media.flatMap((item) => (item.photoId ? [item.photoId] : [])))
        .map(removeMediaBlob)
    )
    removeRouteDraft(draft.id)
    setUploadNotices((current) => {
      const next = { ...current }
      delete next[draft.id]
      return next
    })
    try {
      if (window.localStorage.getItem(ACTIVE_DRAFT_KEY) === draft.id) {
        window.localStorage.removeItem(ACTIVE_DRAFT_KEY)
      }
    } catch {
      // Ignore localStorage failures; the in-memory draft list is already updated.
    }
  }


  const changeLanguage = (language: 'zh-CN' | 'en') => {
    void i18n.changeLanguage(language)
    try {
      window.localStorage.setItem(NETRIN_LANGUAGE_KEY, language)
    } catch {
      // Language still changes for this session.
    }
  }

  const activateDownloadedRoute = (id: string) => {
    setActiveRouteId(id)
    navigate('/')
  }

  const deleteDownloadedRoute = (id: string) => {
    removeDownload(id)
    if (activeRouteId === id) setActiveRouteId('')
    if (selectedDownloadId === id) {
      setSelectedDownloadId(null)
      setEditingDownload(false)
      setDownloadEditDraft(null)
      setView('downloads')
    }
  }

  const openDownloadDetail = (id: string) => {
    setSelectedDownloadId(id)
    setEditingDownload(false)
    setDownloadEditDraft(null)
    setView('downloadDetail')
  }

  const startDownloadEdit = () => {
    if (!selectedDownload) return
    setDownloadEditDraft(cloneDownloadedRoute(selectedDownload))
    setEditingDownload(true)
  }

  const cancelDownloadEdit = () => {
    setEditingDownload(false)
    setDownloadEditDraft(null)
  }

  const saveDownloadEdit = () => {
    if (!selectedDownload || !downloadEditDraft) return
    updateDownloadedRoute(selectedDownload.id, {
      title: downloadEditDraft.title,
      description: downloadEditDraft.description,
      stops: reindexStops(downloadEditDraft.stops)
    })
    setEditingDownload(false)
    setDownloadEditDraft(null)
  }

  const updateDownloadDraft = (updater: (route: DownloadedRoute) => DownloadedRoute) => {
    setDownloadEditDraft((current) => (current ? updater(current) : current))
  }

  const updateDownloadStop = (
    stopId: string,
    updater: (stop: DownloadedStop) => DownloadedStop
  ) => {
    updateDownloadDraft((route) => ({
      ...route,
      stops: route.stops.map((stop) => (stop.id === stopId ? updater(stop) : stop))
    }))
  }

  const moveDownloadStop = (stopId: string, direction: -1 | 1) => {
    updateDownloadDraft((route) => {
      const index = route.stops.findIndex((stop) => stop.id === stopId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= route.stops.length) return route
      const stops = [...route.stops]
      const [stop] = stops.splice(index, 1)
      stops.splice(target, 0, stop)
      return { ...route, stops: reindexStops(stops) }
    })
  }

  const deleteDownloadStop = (stopId: string) => {
    updateDownloadDraft((route) => ({
      ...route,
      stops: reindexStops(route.stops.filter((stop) => stop.id !== stopId))
    }))
  }

  const handleBack = () => {
    if (view === 'downloadDetail') {
      if (editingDownload) {
        cancelDownloadEdit()
        return
      }
      setView('downloads')
      setSelectedDownloadId(null)
      return
    }
    if (view === 'readme' && selectedReadmeSection) {
      setSelectedReadmeSection(null)
      return
    }
    setView('menu')
  }

  const uploadDraft = async (draft: RouteDraft) => {
    if (!user || isAnonymous) {
      navigate('/auth?next=/profile')
      return
    }
    if (draft.points.length < 2) {
      setUploadNotices((current) => ({ ...current, [draft.id]: 'invalid' }))
      return
    }

    const now = new Date().toISOString()
    updateRouteDraft({ ...draft, syncState: 'uploading', updatedAt: now })
    setUploadNotices((current) => {
      const next = { ...current }
      delete next[draft.id]
      return next
    })

    const result = await publishRouteDraft(draft, t('record.untitled'))
    if (result.ok) {
      updateRouteDraft({
        ...draft,
        syncState: 'pending',
        remoteId: result.id,
        rejectionReason: undefined,
        updatedAt: new Date().toISOString()
      })
      setUploadNotices((current) => ({ ...current, [draft.id]: 'success' }))
    } else {
      updateRouteDraft({
        ...draft,
        syncState: 'failed',
        updatedAt: new Date().toISOString()
      })
      setUploadNotices((current) => ({ ...current, [draft.id]: result.error }))
    }
  }

  const activateAppearance = async (id: string) => {
    if (await localAppearanceRepository.setActive(id)) {
      updateAppearanceSettings({ appearanceId: id })
    }
  }

  const renderHeader = (title: string, subtitle?: string) => (
    <header className="screen-heading" data-appearance-hook="top-bar">
      <div className="screen-head-row">
        <h1>{title}</h1>
        {view !== 'menu' ? (
          <Button variant="dark" size="sm" icon="arrow-left" onClick={handleBack}>
            {t('profile.back')}
          </Button>
        ) : null}
      </div>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  )

  if (view === 'language') {
    return (
      <section className="screen" data-appearance-state="language">
        {renderHeader(t('profile.language'), t('profile.languageHint'))}
        <Panel variant="dark" padding="12px">
          <div className="profile-choice-list">
            <Button
              block
              variant={currentLanguage === 'zh-CN' ? 'solid' : 'dark'}
              icon={currentLanguage === 'zh-CN' ? 'check' : 'languages'}
              onClick={() => changeLanguage('zh-CN')}
            >
              {t('profile.languageChinese')}
            </Button>
            <Button
              block
              variant={currentLanguage === 'en' ? 'solid' : 'dark'}
              icon={currentLanguage === 'en' ? 'check' : 'languages'}
              onClick={() => changeLanguage('en')}
            >
              {t('profile.languageEnglish')}
            </Button>
          </div>
        </Panel>
      </section>
    )
  }

  if (view === 'downloads') {
    return (
      <section className="screen" data-appearance-state="downloads">
        {renderHeader(t('profile.downloadedRoutes'), t('profile.downloadRoutesHint'))}
        {downloadedRoutes.length === 0 ? (
          <Panel variant="dark">
            <p className="quiet">{t('profile.noDownloads')}</p>
          </Panel>
        ) : (
          <div className="profile-asset-list">
            {downloadedRoutes.map((route) => (
              <Panel key={route.id} variant="dark" padding="12px">
                  <div className="profile-asset">
                  <button
                    type="button"
                    className="profile-asset__head profile-asset__open"
                    onClick={() => openDownloadDetail(route.id)}
                  >
                    <span className="profile-asset__icon">
                      <PixelIcon name="download" size={22} />
                    </span>
                    <span className="profile-asset__body">
                      <b>{textFor(route.title, i18n.language)}</b>
                      <span>
                        {t('profile.routeSummary', {
                          stops: route.stops.length,
                          author: route.author || t('profile.unknownAuthor')
                        })}
                      </span>
                    </span>
                    <PixelIcon name="chevron-right" size={18} />
                  </button>
                  <div className="profile-asset__actions profile-asset__actions--three">
                    <Button
                      size="sm"
                      variant="solid"
                      icon="home"
                      onClick={() => activateDownloadedRoute(route.id)}
                    >
                      {t('profile.setCurrentRoute')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="delete"
                      onClick={() => void deleteDownloadedRoute(route.id)}
                    >
                      {t('profile.removeDownload')}
                    </Button>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </section>
    )
  }

  if (view === 'downloadDetail') {
    const route = visibleDownload
    const routeTitle = route ? textFor(route.title, i18n.language) : t('profile.downloadDetail')
    const routeDescription = route ? textFor(route.description, i18n.language) : ''

    return (
      <section className="screen" data-appearance-state="download-detail">
        {renderHeader(t('profile.downloadDetail'), routeTitle)}
        {!route ? (
          <Panel variant="dark">
            <p className="quiet">{t('profile.noDownloads')}</p>
          </Panel>
        ) : (
          <div className="profile-detail">
            <Panel variant="dark" padding="12px">
              <div className="profile-detail__head">
                <div>
                  <span className="profile-pill">
                    {route.isLocalEdited ? t('profile.downloadLocalBadge') : t('profile.downloadCloudBadge')}
                  </span>
                  <h2>{routeTitle}</h2>
                  {routeDescription ? <p>{routeDescription}</p> : null}
                </div>
              </div>
              <div className="profile-detail__meta">
                <span>{t('profile.downloadStops', { stops: route.stops.length })}</span>
                <span>{route.author || t('profile.unknownAuthor')}</span>
              </div>
              <div className="profile-asset__actions profile-asset__actions--three">
                {editingDownload ? (
                  <>
                    <Button size="sm" variant="solid" icon="check" onClick={saveDownloadEdit}>
                      {t('profile.saveDownloadEdit')}
                    </Button>
                    <Button size="sm" variant="dark" icon="close" onClick={cancelDownloadEdit}>
                      {t('profile.cancelEdit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="delete"
                      onClick={() => void deleteDownloadedRoute(route.id)}
                    >
                      {t('profile.removeDownload')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="solid"
                      icon="home"
                      onClick={() => activateDownloadedRoute(route.id)}
                    >
                      {t('profile.useEditedRoute')}
                    </Button>
                    <Button size="sm" variant="dark" icon="feather" onClick={startDownloadEdit}>
                      {t('profile.editDownload')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="delete"
                      onClick={() => void deleteDownloadedRoute(route.id)}
                    >
                      {t('profile.removeDownload')}
                    </Button>
                  </>
                )}
              </div>
            </Panel>

            <div className="profile-map-preview" aria-label={t('profile.routePreview')}>
              <NetrinMap
                route={
                  hasPersistedDownloadGeometry && route.geometry
                    ? route.geometry.coordinates
                    : routeLineFromSegments(downloadPreviewSegments)
                }
                routeSegments={hasPersistedDownloadGeometry ? undefined : downloadPreviewSegments}
                stops={route.stops.map((stop, index) => ({
                  id: stop.id,
                  location: stop.location,
                  index: index + 1,
                  label: textFor(stop.title, i18n.language)
                }))}
                activeStopId={route.stops[0]?.id}
                framed
                interactive={false}
                locate={false}
                recenterControl={false}
                showCompass={false}
                mapStyleId={appearanceSettings.mapStyleId}
              />
            </div>

            {editingDownload ? (
              <Panel variant="dark" padding="12px">
                <div className="profile-editor">
                  <TextField
                    label={t('profile.routeTitle')}
                    value={routeTitle}
                    onChange={(value) =>
                      updateDownloadDraft((draft) => ({ ...draft, title: localizedFromInput(value) }))
                    }
                  />
                  <TextField
                    label={t('profile.routeDescription')}
                    value={routeDescription}
                    multiline
                    rows={3}
                    onChange={(value) =>
                      updateDownloadDraft((draft) => ({
                        ...draft,
                        description: localizedFromInput(value)
                      }))
                    }
                  />
                </div>
              </Panel>
            ) : null}

            <div className="profile-stop-list">
              {route.stops.map((stop, index) => {
                const stopTitle = textFor(stop.title, i18n.language)
                const stopDescription = textFor(stop.description, i18n.language)
                return (
                  <div key={stop.id} className="profile-stop" data-appearance-hook="route-point-card">
                    <div className="profile-stop__head">
                      <span className="profile-stop__index">{index + 1}</span>
                      <b>{stopTitle}</b>
                    </div>
                    {stop.media.some((item) => item.url) ? (
                      <div className="profile-stop__media" data-appearance-hook="media-gallery">
                        {stop.media.map((item, mediaIndex) =>
                          item.url ? (
                            <img
                              key={item.id}
                              className="profile-stop__photo"
                              src={item.url}
                              alt={t('home.stopPhotoNumber', {
                                title: stopTitle,
                                number: mediaIndex + 1
                              })}
                              loading="lazy"
                            />
                          ) : null
                        )}
                      </div>
                    ) : null}
                    {editingDownload ? (
                      <>
                        <TextField
                          label={t('profile.stopNote')}
                          value={stopDescription}
                          multiline
                          rows={2}
                          onChange={(value) =>
                            updateDownloadStop(stop.id, (current) => ({
                              ...current,
                              description: localizedFromInput(value)
                            }))
                          }
                        />
                        <TextField
                          label={t('profile.highlightTitle')}
                          value={stop.highlightTitle ?? ''}
                          onChange={(value) =>
                            updateDownloadStop(stop.id, (current) => ({
                              ...current,
                              highlightTitle: value.trim() || undefined
                            }))
                          }
                        />
                        <div className="profile-stop__actions">
                          <Button
                            size="sm"
                            variant="dark"
                            icon="chevron-up"
                            disabled={index === 0}
                            onClick={() => moveDownloadStop(stop.id, -1)}
                          >
                            {t('profile.moveStopUp')}
                          </Button>
                          <Button
                            size="sm"
                            variant="dark"
                            icon="chevron-down"
                            disabled={index === route.stops.length - 1}
                            onClick={() => moveDownloadStop(stop.id, 1)}
                          >
                            {t('profile.moveStopDown')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="delete"
                            onClick={() => deleteDownloadStop(stop.id)}
                          >
                            {t('profile.deleteStop')}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        {stop.highlightTitle ? (
                          <p className="profile-stop__species">
                            <span>{t('profile.highlightTitle')}</span>
                            <b>{stop.highlightTitle}</b>
                          </p>
                        ) : null}
                        {stopDescription ? <p>{stopDescription}</p> : null}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>
    )
  }

  if (view === 'offline') {
    return (
      <section className="screen" data-appearance-state="offline-drafts">
        {renderHeader(t('profile.offline'), t('profile.offlineHint'))}
        {routeDrafts.length === 0 ? (
          <Panel variant="dark">
            <p className="quiet">{t('profile.noDrafts')}</p>
          </Panel>
        ) : (
          <div className="profile-asset-list">
            {routeDrafts.map((draft) => {
              const notice = uploadNotices[draft.id]
              return (
                <Panel key={draft.id} variant="dark" padding="12px">
                  <div className="profile-asset">
                    <div className="profile-asset__head">
                      <span className="profile-asset__icon">
                        <PixelIcon name="directions" size={22} />
                      </span>
                      <span className="profile-asset__body">
                        <b>{draft.title || t('record.untitled')}</b>
                        <span>
                          {t('profile.draftSummary', {
                            points: draft.points.length,
                            photos: getPhotoCount(draft)
                          })}
                        </span>
                      </span>
                      <span className="profile-pill">{t(`profile.sync.${draft.syncState}`)}</span>
                    </div>
                    <div className="profile-asset__actions profile-asset__actions--three">
                      <Button
                        size="sm"
                        variant="dark"
                        icon="feather"
                        disabled={draft.syncState === 'uploading' || draft.syncState === 'pending' || draft.syncState === 'approved'}
                        onClick={() => continueDraft(draft)}
                      >
                        {t('profile.continueDraft')}
                      </Button>
                      <Button
                        size="sm"
                        variant="solid"
                        icon="cloud"
                        disabled={
                          draft.syncState === 'uploading' ||
                          draft.syncState === 'pending' ||
                          draft.syncState === 'approved' ||
                          draft.points.length < 2
                        }
                        onClick={() => void uploadDraft(draft)}
                      >
                        {draft.syncState === 'uploading'
                          ? t('workshop.uploading')
                          : draft.syncState === 'failed'
                            ? t('workshop.retryUpload')
                            : draft.syncState === 'rejected'
                              ? t('profile.resubmitDraft')
                              : t('profile.uploadDraft')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="delete"
                        onClick={() => void deleteDraft(draft)}
                      >
                        {t('profile.deleteDraft')}
                      </Button>
                    </div>
                    {notice ? (
                      <p className={notice === 'success' ? 'save-message' : 'quiet'}>
                        {t(uploadNoticeKey(notice))}
                      </p>
                    ) : null}
                    {draft.syncState === 'rejected' && draft.rejectionReason ? (
                      <p className="form-error">{t('profile.rejectionReason', { reason: draft.rejectionReason })}</p>
                    ) : null}
                  </div>
                </Panel>
              )
            })}
          </div>
        )}
      </section>
    )
  }

  if (view === 'submissions') {
    return (
      <section className="screen" data-appearance-state="submissions">
        {renderHeader(t('profile.mySubmissions'))}
        {!user || isAnonymous ? (
          <Panel variant="dark" padding="12px">
            <p className="quiet">{t('profile.signInForSubmissions')}</p>
            <Button block variant="solid" icon="login" onClick={() => navigate('/auth?next=/profile')}>{t('auth.signIn')}</Button>
          </Panel>
        ) : routeSubmissions.length === 0 ? (
          <Panel variant="dark"><p className="quiet">{t('profile.noSubmissions')}</p></Panel>
        ) : (
          <div className="profile-asset-list">
            {routeSubmissions.map((submission) => (
              <Panel key={submission.id} variant="dark" padding="12px">
                <div className="profile-asset">
                  <div className="profile-asset__head">
                    <span className="profile-asset__icon"><PixelIcon name="send" size={22} /></span>
                    <span className="profile-asset__body"><b>{textFor(submission.title, i18n.language)}</b><span>{new Date(submission.updatedAt).toLocaleString(i18n.language)}</span></span>
                    <span className="profile-pill">{t(`moderation.${submission.moderationStatus}`)}</span>
                  </div>
                  {submission.rejectionReason ? <p className="form-error">{t('profile.rejectionReason', { reason: submission.rejectionReason })}</p> : null}
                </div>
              </Panel>
            ))}
          </div>
        )}
      </section>
    )
  }

  if (view === 'appearance') {
    return (
      <section className="screen" data-appearance-state="appearance">
        {renderHeader(t('profile.appearance'), t('profile.appearanceHint'))}
        <div className="profile-settings-list">
          <Panel variant="dark" padding="12px">
            <div className="profile-settings-group">
              <h2>{t('profile.mapStyle')}</h2>
              <div className="profile-option-grid">
                {MAP_STYLE_IDS.map((option) => (
                  <Button
                    key={option}
                    variant={appearanceSettings.mapStyleId === option ? 'solid' : 'dark'}
                    icon={appearanceSettings.mapStyleId === option ? 'check' : 'eye'}
                    onClick={() => updateAppearanceSettings({ mapStyleId: option })}
                  >
                    {t(`profile.mapStyles.${option}`)}
                  </Button>
                ))}
              </div>
            </div>
          </Panel>
          <Panel variant="dark" padding="12px">
            <div className="profile-settings-group">
              <h2>{t('profile.appearanceGroup')}</h2>
              <div className="profile-choice-list">
                {appearancePackages
                  .filter((appearance) => appearance.manifest.type === 'skin' || appearance.manifest.id === 'field-guide-phenotype')
                  .map((appearance) => {
                    const active = appearanceSettings.appearanceId === appearance.manifest.id
                    const displayName = appearance.manifest.id === 'field-guide-phenotype'
                      ? t('profile.defaultAppearanceGroup')
                      : appearance.manifest.displayName
                    return (
                      <Button
                        block
                        key={appearance.manifest.id}
                        variant={active ? 'solid' : 'dark'}
                        icon={active ? 'check' : 'eye'}
                        disabled={active}
                        onClick={() => void activateAppearance(appearance.manifest.id)}
                      >
                        {displayName}
                      </Button>
                    )
                  })}
              </div>
            </div>
          </Panel>
        </div>
      </section>
    )
  }


  if (view === 'readme') {
    return (
      <section className="screen" data-appearance-state="readme">
        {renderHeader(
          selectedReadmeSection
            ? t(`profile.readmeSections.${selectedReadmeSection}.title`)
            : t('profile.readme')
        )}
        {selectedReadmeSection ? (
          <div
            className="readme-sections"
            data-appearance-slot="statement-detail"
            data-appearance-state={`readme-${selectedReadmeSection}`}
          >
            <Panel variant="dark" padding="16px">
              <article className="readme-section">
                <p>{t(`profile.readmeSections.${selectedReadmeSection}.body`)}</p>
                {selectedReadmeSection === 'appearance' ? (
                  <Button variant="solid" icon="external-link" onClick={() => navigate('/appearance-studio')}>
                    {t('profile.openAppearanceStudio')}
                  </Button>
                ) : null}
              </article>
            </Panel>
          </div>
        ) : (
          <div
            className="profile-menu"
            data-appearance-slot="statement-menu"
            data-appearance-state="readme-menu"
          >
            {README_SECTION_IDS.map((section) => (
              <Button
                block
                key={section}
                size="lg"
                variant="paper"
                icon={README_SECTION_ICONS[section]}
                onClick={() => setSelectedReadmeSection(section)}
              >
                {t(`profile.readmeSections.${section}.title`)}
              </Button>
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="screen" data-appearance-state="menu">
      {renderHeader(t('profile.title'))}
      <Panel variant="dark" padding="12px">
        <div className="profile-account-card">
          <span className="profile-asset__icon"><PixelIcon name="user" size={22} /></span>
          <span className="profile-asset__body">
            <b>{profile?.displayName || t(user && isAnonymous ? 'profile.anonymousAccount' : 'profile.guest')}</b>
            {user && !isAnonymous ? <span>{maskChinaPhone(user.phone)}</span> : null}
          </span>
          <Button size="sm" variant="dark" icon="login" onClick={() => navigate('/auth?next=/profile')}>{t('profile.account')}</Button>
        </div>
      </Panel>
      <div className="profile-menu">
        <Button block size="lg" variant="paper" icon="languages" onClick={() => setView('language')}>
          {t('profile.language')}
        </Button>
        <Button block size="lg" variant="paper" icon="download" onClick={() => setView('downloads')}>
          {t('profile.downloadRoutes')}
        </Button>
        <Button block size="lg" variant="paper" icon="lock" onClick={() => setView('offline')}>
          {t('profile.offline')}
        </Button>
        <Button block size="lg" variant="paper" icon="eye" onClick={() => setView('appearance')}>
          {t('profile.appearance')}
        </Button>
        <Button block size="lg" variant="paper" icon="send" onClick={() => setView('submissions')}>
          {t('profile.mySubmissions')}
        </Button>
        <Button block size="lg" variant="paper" icon="book-open" onClick={() => navigate('/legal')}>{t('profile.legal')}</Button>
        <Button
          block
          size="lg"
          variant="paper"
          icon="book-open"
          onClick={() => {
            setSelectedReadmeSection(null)
            setView('readme')
          }}
        >
          {t('profile.readme')}
        </Button>
        {isAdmin ? (
          <Button block size="lg" variant="solid" icon="lock" onClick={() => navigate('/admin')}>
            {t('profile.adminPanel')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
