import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { maskChinaPhone } from '../auth/phone'
import { Button } from '../components/core/Button'
import { TextField } from '../components/forms/TextField'
import { Panel } from '../components/surfaces/Panel'
import { AmapNetrinMap as NetrinMap } from '../components/domain/AmapNetrinMap'
import {
  callAdmin,
  adminFailureText,
  confirmAdminRouteGeometry,
  fetchAdminRoutes,
  fetchAdminUsers,
  fetchAppearanceSubmissions,
  fetchModerationEvents,
  reviewAppearance,
  reviewRoute,
  submitAppearancePackage,
  type AdminRoute,
  type AdminUser,
  type AppearanceSubmission,
  type ModerationEvent
  ,type AdminFailure
} from '../data/moderation'
import type { RoutePublicV2PointRow } from '../data/types'
import { compressImage } from '../lib/image'
import { supabase } from '../lib/supabase'
import { useAmapRoutePreview } from '../lib/amap/useRoutePreview'
import { routeLineFromSegments } from '../lib/routing/routeSegments'


type AdminTab = 'queue' | 'routes' | 'appearance' | 'accounts' | 'audit'
type AdminSectionKey = 'routes' | 'appearances' | 'accounts' | 'audit'
type AdminSectionView = { status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'; error: AdminFailure | null }

const INITIAL_ADMIN_SECTIONS: Record<AdminSectionKey, AdminSectionView> = {
  routes: { status: 'idle', error: null },
  appearances: { status: 'idle', error: null },
  accounts: { status: 'idle', error: null },
  audit: { status: 'idle', error: null },
}

function AdminSectionError({ label, failure, onRetry }: { label: string; failure: AdminFailure | null; onRetry: () => void }) {
  const { t } = useTranslation()
  if (!failure) return null
  return <div className="admin-section-error" data-appearance-hook="error-state" role="alert"><span>{label}: {adminFailureText(failure)}</span><Button size="sm" variant="dark" icon="reload" onClick={onRetry}>{t('admin.retrySection')}</Button></div>
}

function cloneRoute(route: AdminRoute): AdminRoute {
  return {
    ...route,
    title: { ...route.title },
    description: { ...route.description },
    points: route.points.map((point) => ({
      ...point,
      media: (point.media ?? []).map((media) => ({ ...media }))
    }))
  }
}

function reindexPoints(points: RoutePublicV2PointRow[]): RoutePublicV2PointRow[] {
  return points.map((point, index) => ({
    ...point,
    order: index + 1,
    media: (point.media ?? []).map((media, mediaIndex) => ({ ...media, order: mediaIndex + 1 }))
  }))
}

function dateLabel(value: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return value
  }
}

function GeometryReviewPanel({ route, reason, onCancel, onDone }: {
  route: AdminRoute
  reason: string
  onCancel: () => void
  onDone: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [travelMode, setTravelMode] = useState(route.travelMode)
  const [cityAdcode, setCityAdcode] = useState(route.cityAdcode ?? '')
  const [cityName, setCityName] = useState(route.cityName ?? '')
  const [difficulty, setDifficulty] = useState(route.difficulty ?? '')
  const [tags, setTags] = useState(route.tags.join(', '))
  const [isLoop, setIsLoop] = useState(route.isLoop === true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const previewPoints = useMemo(() => route.points.map((point) => ({ id: point.id, location: [point.lng, point.lat] as [number, number] })), [route.points])
  const { segments, status, retry } = useAmapRoutePreview(previewPoints, travelMode, !route.geometry)
  const coordinates = route.geometry?.coordinates ?? routeLineFromSegments(segments)
  const ready = Boolean(route.geometry) || status === 'ready'
  const mapStops = previewPoints.map((point, index) => ({ ...point, index: index + 1 }))

  const conclude = async (navigable: boolean) => {
    if (!reason.trim()) {
      setNotice(t('admin.reasonRequired'))
      return
    }
    if (navigable && (!ready || coordinates.length < 2)) {
      setNotice(t('admin.geometryCandidateRequired'))
      return
    }
    setBusy(true)
    const result = await confirmAdminRouteGeometry({
      routeId: route.id,
      navigable,
      reason,
      travelMode: navigable ? travelMode : undefined,
      geometrySource: navigable ? (route.geometrySource ?? 'amap-planned') : undefined,
      geometry: navigable ? { type: 'LineString', coordinates } : undefined,
      meta: navigable ? {
        cityAdcode: cityAdcode.trim() || null,
        cityName: cityName.trim() || null,
        distanceM: route.distanceM ?? Math.round(segments.reduce((total, segment) => total + segment.distanceMeters, 0)),
        durationS: route.durationS ?? Math.round(segments.reduce((total, segment) => total + (segment.durationSeconds ?? 0), 0)),
        difficulty: difficulty || null,
        isLoop,
        tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 10),
        coverMediaId: route.coverMediaId ?? null
      } : {}
    })
    setBusy(false)
    if (!result.ok) {
      setNotice(adminFailureText(result.error))
      return
    }
    await onDone()
  }

  return (
    <section className="screen admin-screen" data-appearance-state="geometry-review">
      <header className="screen-heading"><div className="screen-head-row"><div><h1>{t('admin.geometryReview')}</h1><p>{route.title['zh-CN'] || route.title.en}</p></div><Button size="sm" variant="dark" icon="close" onClick={onCancel}>{t('profile.cancelEdit')}</Button></div></header>
      <Panel variant="paper" shadow padding="0" style={{ overflow: 'hidden' }}><div style={{ height: 280 }}><NetrinMap route={coordinates} routeSegments={route.geometry ? [] : segments} stops={mapStops} framed compassLabel={t('home.resetNorth')} /></div></Panel>
      <Panel variant="dark" padding="12px"><div className="admin-form">
        <p className="quiet">{status === 'loading' ? t('record.geometryPlanning') : status === 'error' ? t('record.geometryUnavailable') : t('admin.geometryReviewHint')}</p>
        {status === 'error' ? <Button size="sm" variant="dark" icon="reload" onClick={retry}>{t('common.retry')}</Button> : null}
        <label className="nfield"><span className="nfield__label">{t('record.travelMode')}</span><select value={travelMode} onChange={(event) => setTravelMode(event.target.value === 'cycling' ? 'cycling' : 'walking')}><option value="walking">{t('record.walkingMode')}</option><option value="cycling">{t('record.cyclingMode')}</option></select></label>
        <div className="rec-grid"><TextField label={t('record.cityName')} value={cityName} onChange={setCityName} /><TextField label={t('record.cityAdcode')} value={cityAdcode} onChange={setCityAdcode} /></div>
        <label className="nfield"><span className="nfield__label">{t('record.difficulty')}</span><select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="">{t('record.difficultyUnset')}</option><option value="easy">{t('record.difficulties.easy')}</option><option value="moderate">{t('record.difficulties.moderate')}</option><option value="hard">{t('record.difficulties.hard')}</option></select></label>
        <TextField label={t('record.tags')} value={tags} onChange={setTags} />
        <label className="admin-inline-check"><input type="checkbox" checked={isLoop} onChange={(event) => setIsLoop(event.target.checked)} />{t('record.isLoop')}</label>
        {notice ? <p className="form-error" role="status">{notice}</p> : null}
        <div className="admin-card-actions"><Button variant="solid" icon="check" disabled={busy || !ready} onClick={() => void conclude(true)}>{t('admin.confirmNavigable')}</Button><Button variant="dark" icon="close" disabled={busy} onClick={() => void conclude(false)}>{t('admin.confirmNotNavigable')}</Button></div>
      </div></Panel>
    </section>
  )
}

export function AdminScreen() {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const { loading: authLoading, isAdmin, user } = useAuth()
  const [tab, setTab] = useState<AdminTab>('queue')
  const [routes, setRoutes] = useState<AdminRoute[]>([])
  const [appearances, setAppearances] = useState<AppearanceSubmission[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [events, setEvents] = useState<ModerationEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string>('')
  const [editingRoute, setEditingRoute] = useState<AdminRoute | null>(null)
  const [newRoutePaths, setNewRoutePaths] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [editingAppearance, setEditingAppearance] = useState<AppearanceSubmission | null>(null)
  const [appearanceReviewFile, setAppearanceReviewFile] = useState<File | null>(null)
  const [replacementPackageFile, setReplacementPackageFile] = useState<File | null>(null)
  const [geometryRoute, setGeometryRoute] = useState<AdminRoute | null>(null)
  const [sectionStates, setSectionStates] = useState(INITIAL_ADMIN_SECTIONS)

  const refresh = useCallback(async (only?: AdminSectionKey) => {
    if (!isAdmin) return
    setLoading(true)
    const keys = only ? [only] : Object.keys(INITIAL_ADMIN_SECTIONS) as AdminSectionKey[]
    setSectionStates((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [
      key,
      keys.includes(key as AdminSectionKey) ? { ...value, status: 'loading', error: null } : value
    ])) as Record<AdminSectionKey, AdminSectionView>)
    const settle = (key: AdminSectionKey, length: number, error: AdminFailure | null) => {
      setSectionStates((current) => ({
        ...current,
        [key]: { status: error ? 'error' : length > 0 ? 'ready' : 'empty', error }
      }))
    }
    await Promise.all(keys.map(async (key) => {
      if (key === 'routes') {
        const result = await fetchAdminRoutes()
        if (result.ok) setRoutes(result.data)
        settle(key, result.ok ? result.data.length : 0, result.ok ? null : result.error)
      } else if (key === 'appearances') {
        const result = await fetchAppearanceSubmissions()
        if (result.ok) setAppearances(result.data)
        settle(key, result.ok ? result.data.length : 0, result.ok ? null : result.error)
      } else if (key === 'accounts') {
        const result = await fetchAdminUsers()
        if (result.ok) setUsers(result.data.users)
        settle(key, result.ok ? result.data.users.length : 0, result.ok ? null : result.error)
      } else if (key === 'audit') {
        const result = await fetchModerationEvents()
        if (result.ok) setEvents(result.data)
        settle(key, result.ok ? result.data.length : 0, result.ok ? null : result.error)
      }
    }))
    setLoading(false)
  }, [isAdmin])

  useEffect(() => { void refresh() }, [refresh])

  const pendingRoutes = useMemo(() => routes.filter((route) => route.status === 'pending' || route.needsGeometryReview), [routes])
  const pendingAppearances = useMemo(() => appearances.filter((appearance) => appearance.status === 'pending'), [appearances])

  const decideRoute = async (route: AdminRoute, decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && !reason.trim()) {
      setNotice(t('admin.reasonRequired'))
      return
    }
    setLoading(true)
    const result = await reviewRoute(route.id, decision, reason)
    setNotice(result.ok ? t(`admin.routeDecision.${decision}`) : adminFailureText(result.error))
    if (result.ok) {
      setReason('')
      await refresh()
    } else setLoading(false)
  }

  const updatePoint = (pointId: string, patch: Partial<RoutePublicV2PointRow>) => {
    setEditingRoute((current) => current ? {
      ...current,
      points: current.points.map((point) => point.id === pointId ? { ...point, ...patch } : point)
    } : current)
  }

  const movePoint = (pointId: string, direction: -1 | 1) => {
    setEditingRoute((current) => {
      if (!current) return current
      const index = current.points.findIndex((point) => point.id === pointId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.points.length) return current
      const points = [...current.points]
      const [point] = points.splice(index, 1)
      points.splice(target, 0, point)
      return { ...current, points: reindexPoints(points) }
    })
  }

  const addPoint = () => {
    setEditingRoute((current) => {
      if (!current) return current
      const previous = current.points[current.points.length - 1]
      return {
        ...current,
        points: reindexPoints([...current.points, {
          id: crypto.randomUUID(), order: current.points.length + 1,
          lng: previous?.lng ?? 119.72, lat: previous?.lat ?? 30.26,
          title: '', text: '', highlightTitle: '', media: []
        }])
      }
    })
  }

  const removePoint = (pointId: string) => {
    setEditingRoute((current) => current ? {
      ...current, points: reindexPoints(current.points.filter((point) => point.id !== pointId))
    } : current)
  }

  const uploadPointMedia = async (event: ChangeEvent<HTMLInputElement>, pointId: string) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editingRoute || !supabase) return
    const point = editingRoute.points.find((item) => item.id === pointId)
    const media = point?.media ?? []
    if (!point || media.length >= 8) return
    setLoading(true)
    let jpeg: Blob
    try {
      jpeg = await compressImage(file)
    } catch {
      setNotice(t('admin.uploadFailed'))
      setLoading(false)
      return
    }
    const { data, error } = await supabase.functions.invoke('netrin-admin', {
      body: jpeg,
      headers: {
        'content-type': 'application/octet-stream',
        'x-admin-action': 'upload-route-media',
        'x-route-id': editingRoute.id,
        'x-point-id': pointId,
        'x-media-order': String(media.length + 1)
      }
    })
    if (error || data?.error || !data?.path) {
      setNotice(data?.error ?? error?.message ?? t('admin.uploadFailed'))
      setLoading(false)
      return
    }
    setNewRoutePaths((current) => [...current, data.path])
    updatePoint(pointId, {
      media: [...media, {
        id: crypto.randomUUID(), order: media.length + 1, storagePath: data.path,
        mimeType: 'image/jpeg'
      }]
    })
    setLoading(false)
  }

  const removePointMedia = (pointId: string, mediaId: string) => {
    const point = editingRoute?.points.find((item) => item.id === pointId)
    if (!point) return
    updatePoint(pointId, {
      media: (point.media ?? []).filter((media) => media.id !== mediaId)
        .map((media, index) => ({ ...media, order: index + 1 }))
    })
  }

  const cancelRouteEdit = async () => {
    if (editingRoute && newRoutePaths.length) {
      await callAdmin({ action: 'cleanup-route-media', targetId: editingRoute.id, paths: newRoutePaths })
    }
    setEditingRoute(null)
    setNewRoutePaths([])
  }

  const saveRoute = async () => {
    if (!editingRoute) return
    if (editingRoute.points.length < 2) {
      setNotice(t('admin.twoPointsRequired'))
      return
    }
    setLoading(true)
    const result = await callAdmin<{ ok: boolean }>({
      action: 'save-route', targetId: editingRoute.id,
      route: {
        id: editingRoute.id, title: editingRoute.title, description: editingRoute.description,
        author: editingRoute.author, status: editingRoute.status,
        points: editingRoute.points.map((point, index) => ({
          id: point.id, order: index + 1, lng: Number(point.lng), lat: Number(point.lat),
          title: point.title ?? '',
          text: point.text ?? '',
          highlightTitle: point.highlightTitle ?? '',
          category: point.category ?? undefined,
          media: (point.media ?? []).map((media, mediaIndex) => ({
            id: media.id, order: mediaIndex + 1, storagePath: media.storagePath,
            mimeType: media.mimeType, width: media.width, height: media.height
          }))
        }))
      }
    })
    setNotice(result.ok ? t('admin.routeSaved') : adminFailureText(result.error))
    if (result.ok) {
      setEditingRoute(null)
      setNewRoutePaths([])
      await refresh()
    } else setLoading(false)
  }

  const deleteRoute = async (route: AdminRoute) => {
    if (!window.confirm(t('admin.confirmDeleteRoute', { title: route.title['zh-CN'] || route.title.en }))) return
    setLoading(true)
    const result = await callAdmin<{ ok: boolean }>({ action: 'delete-route', targetId: route.id, reason })
    setNotice(result.ok ? t('admin.routeDeleted') : adminFailureText(result.error))
    if (result.ok) await refresh()
    else setLoading(false)
  }

  const decideAppearance = async (decision: 'approved' | 'rejected') => {
    if (!editingAppearance) return
    if (decision === 'rejected' && !reason.trim()) {
      setNotice(t('admin.reasonRequired'))
      return
    }
    setLoading(true)
    if (decision === 'approved') {
      if (!appearanceReviewFile) {
        setNotice(t('appearanceStudio.selectReview'))
        setLoading(false)
        return
      }
    }
    const result = await reviewAppearance(
      editingAppearance.id, decision, reason,
      editingAppearance.displayName, editingAppearance.summary,
      decision === 'approved' ? appearanceReviewFile ?? undefined : undefined
    )
    setNotice(result.ok ? t(`admin.appearanceDecision.${decision}`) : adminFailureText(result.error))
    if (result.ok) {
      setEditingAppearance(null)
      setReason('')
      await refresh()
    } else setLoading(false)
  }

  const replaceAppearance = async () => {
    if (!replacementPackageFile || !appearanceReviewFile || !editingAppearance) return
    setLoading(true)
    const result = await submitAppearancePackage(replacementPackageFile, appearanceReviewFile, editingAppearance.id)
    setNotice(result.ok ? t('admin.appearanceReplaced') : adminFailureText(result.error))
    if (result.ok) await refresh()
    else setLoading(false)
  }

  const deleteAppearance = async (appearance: AppearanceSubmission) => {
    if (!window.confirm(t('admin.confirmDeleteAppearance', { title: appearance.displayName }))) return
    setLoading(true)
    const result = await callAdmin<{ ok: boolean }>({ action: 'delete-appearance', targetId: appearance.id, reason })
    setNotice(result.ok ? t('admin.appearanceDeleted') : adminFailureText(result.error))
    if (result.ok) {
      setEditingAppearance(null)
      await refresh()
    } else setLoading(false)
  }

  const accountAction = async (account: AdminUser, action: 'suspend-user' | 'reactivate-user' | 'delete-user') => {
    if (action === 'delete-user' && !window.confirm(t('admin.confirmDeleteAccount', { identity: account.phone || account.id.slice(0, 8) }))) return
    setLoading(true)
    const result = await callAdmin<{ ok: boolean }>({ action, targetId: account.id, reason })
    setNotice(result.ok ? t(`admin.accountDone.${action}`) : adminFailureText(result.error))
    if (result.ok) await refresh()
    else setLoading(false)
  }

  if (authLoading) return <section className="screen" data-appearance-state="loading"><p role="status" data-appearance-hook="loading-state">{t('common.loading')}</p></section>
  if (!isAdmin) {
    return (
      <section className="screen" data-appearance-state="denied">
        <header className="screen-heading" data-appearance-hook="top-bar"><h1>{t('admin.deniedTitle')}</h1><p>{t('admin.deniedHint')}</p></header>
        <Button variant="paper" icon="arrow-left" onClick={() => navigate('/profile')}>{t('profile.back')}</Button>
      </section>
    )
  }

  if (geometryRoute) {
    return <GeometryReviewPanel route={geometryRoute} reason={reason} onCancel={() => setGeometryRoute(null)} onDone={async () => { setGeometryRoute(null); setReason(''); await refresh() }} />
  }

  if (editingRoute) {
    return (
      <section className="screen admin-screen" data-appearance-state="route-edit">
        <header className="screen-heading" data-appearance-hook="top-bar"><div className="screen-head-row"><h1>{t('admin.editRoute')}</h1><Button size="sm" variant="dark" icon="close" onClick={() => void cancelRouteEdit()}>{t('profile.cancelEdit')}</Button></div></header>
        <Panel variant="dark" padding="12px"><div className="admin-form">
          <TextField label={t('admin.titleZh')} value={editingRoute.title['zh-CN']} onChange={(value) => setEditingRoute({ ...editingRoute, title: { ...editingRoute.title, 'zh-CN': value } })} />
          <TextField label={t('admin.titleEn')} value={editingRoute.title.en} onChange={(value) => setEditingRoute({ ...editingRoute, title: { ...editingRoute.title, en: value } })} />
          <TextField label={t('admin.descriptionZh')} multiline value={editingRoute.description['zh-CN']} onChange={(value) => setEditingRoute({ ...editingRoute, description: { ...editingRoute.description, 'zh-CN': value } })} />
          <TextField label={t('admin.descriptionEn')} multiline value={editingRoute.description.en} onChange={(value) => setEditingRoute({ ...editingRoute, description: { ...editingRoute.description, en: value } })} />
          <TextField label={t('admin.author')} value={editingRoute.author} onChange={(value) => setEditingRoute({ ...editingRoute, author: value })} />
          <label className="nfield"><span className="nfield__label">{t('admin.status')}</span><select value={editingRoute.status} onChange={(event) => setEditingRoute({ ...editingRoute, status: event.target.value as AdminRoute['status'] })}><option value="pending">{t('moderation.pending')}</option><option value="approved">{t('moderation.approved')}</option><option value="rejected">{t('moderation.rejected')}</option></select></label>
        </div></Panel>
        <div className="admin-point-list">
          {editingRoute.points.map((point, index) => (
            <Panel key={point.id} variant="dark" padding="12px"><div className="admin-point" data-appearance-hook="route-point-card">
              <div className="admin-card-head"><b>{t('admin.pointNumber', { index: index + 1 })}</b><span>{point.id.slice(0, 8)}</span></div>
              <div className="admin-coordinates"><TextField type="number" label="WGS-84 LNG" value={String(point.lng)} onChange={(value) => updatePoint(point.id, { lng: Number(value) })} /><TextField type="number" label="WGS-84 LAT" value={String(point.lat)} onChange={(value) => updatePoint(point.id, { lat: Number(value) })} /></div>
              <TextField label={t('admin.pointTitle')} value={point.title ?? ''} onChange={(value) => updatePoint(point.id, { title: value })} />
              <TextField
                label={t('profile.highlightTitle')}
                value={point.highlightTitle ?? ''}
                onChange={(value) => updatePoint(point.id, { highlightTitle: value })}
              />
              <TextField label={t('profile.stopNote')} multiline value={point.text ?? ''} onChange={(value) => updatePoint(point.id, { text: value })} />
              <div className="admin-media-grid" data-appearance-hook="media-gallery">{(point.media ?? []).map((media) => <div key={media.id} className="admin-media">{media.url ? <img src={media.url} alt="" /> : null}<Button size="sm" variant="ghost" icon="delete" onClick={() => removePointMedia(point.id, media.id)}>{t('common.clear')}</Button></div>)}</div>
              {(point.media ?? []).length < 8 ? <label className="admin-file-button"><span>{t('admin.addPhoto')}</span><input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => void uploadPointMedia(event, point.id)} /></label> : null}
              <div className="admin-card-actions"><Button size="sm" variant="dark" icon="chevron-up" disabled={index === 0} onClick={() => movePoint(point.id, -1)}>{t('profile.moveStopUp')}</Button><Button size="sm" variant="dark" icon="chevron-down" disabled={index === editingRoute.points.length - 1} onClick={() => movePoint(point.id, 1)}>{t('profile.moveStopDown')}</Button><Button size="sm" variant="ghost" icon="delete" onClick={() => removePoint(point.id)}>{t('profile.deleteStop')}</Button></div>
            </div></Panel>
          ))}
        </div>
        <Button block variant="dark" icon="plus" onClick={addPoint}>{t('admin.addPoint')}</Button>
        {notice ? <p className="form-error" role="status">{notice}</p> : null}
        <Button block variant="solid" icon="check" disabled={loading} onClick={() => void saveRoute()}>{t('common.save')}</Button>
      </section>
    )
  }

  const routeList = tab === 'queue' ? pendingRoutes : routes
  const appearanceList = tab === 'queue' ? pendingAppearances : appearances

  return (
    <section className="screen admin-screen" data-appearance-state={loading ? 'busy' : tab}>
      <header className="screen-heading" data-appearance-hook="top-bar"><div className="screen-head-row"><div><h1>{t('admin.title')}</h1><p>{t('admin.signedInAs', { phone: maskChinaPhone(user?.phone) })}</p></div><Button size="sm" variant="dark" icon="reload" disabled={loading} onClick={() => void refresh()}>{t('admin.refresh')}</Button></div></header>
      <nav className="admin-tabs" aria-label={t('admin.sections')} data-appearance-slot="tabs">
        {(['queue', 'routes', 'appearance', 'accounts', 'audit'] as AdminTab[]).map((item) => <Button key={item} size="sm" variant={tab === item ? 'solid' : 'dark'} onClick={() => setTab(item)}>{t(`admin.tabs.${item}`)}</Button>)}
      </nav>
      {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
      {Object.entries(sectionStates).filter(([, state]) => state.status === 'loading').map(([key]) => (
        <p className="quiet" role="status" data-appearance-hook="loading-state" key={key}>{key}: {t('common.loading')}</p>
      ))}

      {(tab === 'queue' || tab === 'routes') ? <div className="admin-list"><AdminSectionError label={t('admin.routesHeading', { count: routeList.length })} failure={sectionStates.routes.error} onRetry={() => void refresh('routes')} /><TextField label={t('admin.reviewReason')} value={reason} onChange={setReason} /><h2>{t('admin.routesHeading', { count: routeList.length })}</h2>{routeList.map((route) => <Panel key={route.id} variant="dark" padding="12px"><div className="admin-card"><div className="admin-card-head"><span><b>{route.title['zh-CN'] || route.title.en}</b><small>{route.author || t('profile.unknownAuthor')} · {route.points.length} · {dateLabel(route.updatedAt, i18n.language)}</small></span><span className="profile-pill">{route.needsGeometryReview ? t('admin.needsGeometryReview') : t(`moderation.${route.status}`)}</span></div>{route.rejectionReason ? <p className="form-error">{route.rejectionReason}</p> : null}<div className="admin-card-actions"><Button size="sm" variant="dark" icon="feather" onClick={() => { setEditingRoute(cloneRoute(route)); setNewRoutePaths([]) }}>{t('admin.edit')}</Button>{route.needsGeometryReview ? <Button size="sm" variant="solid" icon="directions" onClick={() => setGeometryRoute(route)}>{t('admin.reviewGeometry')}</Button> : null}{route.status === 'pending' ? <Button size="sm" variant="solid" icon="check" onClick={() => void decideRoute(route, 'approved')}>{t('admin.approve')}</Button> : null}<Button size="sm" variant="dark" icon="close" onClick={() => void decideRoute(route, 'rejected')}>{t('admin.reject')}</Button><Button size="sm" variant="ghost" icon="delete" onClick={() => void deleteRoute(route)}>{t('admin.delete')}</Button></div></div></Panel>)}</div> : null}

      {(tab === 'queue' || tab === 'appearance') ? <div className="admin-list"><AdminSectionError label={t('admin.appearanceHeading', { count: appearanceList.length })} failure={sectionStates.appearances.error} onRetry={() => void refresh('appearances')} /><h2>{t('admin.appearanceHeading', { count: appearanceList.length })}</h2>{appearanceList.map((appearance) => <Panel key={appearance.id} variant="dark" padding="12px"><div className="admin-card"><div className="admin-card-head"><span><b>{appearance.displayName}</b><small>{appearance.packageId} · {appearance.packageVersion} · {Math.ceil(appearance.bytes / 1024)} KiB</small></span><span className="profile-pill">{t(`moderation.${appearance.status}`)}</span></div><Button variant="dark" icon="feather" onClick={() => { setEditingAppearance({ ...appearance }); setReason(appearance.rejectionReason ?? ''); setAppearanceReviewFile(null); setReplacementPackageFile(null) }}>{t('admin.openReview')}</Button></div></Panel>)}</div> : null}

      {editingAppearance ? <Panel variant="paper" padding="12px"><div className="admin-form"><h2>{t('admin.appearanceReview')}</h2><TextField label={t('admin.catalogName')} value={editingAppearance.displayName} onChange={(value) => setEditingAppearance({ ...editingAppearance, displayName: value })} /><TextField label={t('admin.catalogSummary')} multiline value={editingAppearance.summary} onChange={(value) => setEditingAppearance({ ...editingAppearance, summary: value })} /><TextField label={t('admin.reviewReason')} multiline value={reason} onChange={setReason} /><dl className="appearance-metadata"><div><dt>SHA-256</dt><dd>{editingAppearance.sha256}</dd></div><div><dt>{t('profile.appearanceAuthor')}</dt><dd>{editingAppearance.declaredAuthor}</dd></div><div><dt>{t('profile.appearanceLicense')}</dt><dd>{editingAppearance.license}</dd></div></dl><label className="admin-file-button"><span>{replacementPackageFile?.name ?? t('admin.replacePackage')}</span><input type="file" accept=".netrin-appearance,application/zip" hidden onChange={(event) => { setReplacementPackageFile(event.target.files?.[0] ?? null); event.target.value = '' }} /></label><label className="admin-file-button"><span>{appearanceReviewFile?.name ?? t('appearanceStudio.selectReview')}</span><input type="file" accept=".netrin-review.json,application/json" hidden onChange={(event) => { setAppearanceReviewFile(event.target.files?.[0] ?? null); event.target.value = '' }} /></label><div className="admin-card-actions"><Button size="sm" variant="dark" icon="reload" disabled={!replacementPackageFile || !appearanceReviewFile} onClick={() => void replaceAppearance()}>{t('admin.replacePackage')}</Button><Button size="sm" variant="solid" icon="check" disabled={!appearanceReviewFile} onClick={() => void decideAppearance('approved')}>{t('admin.approve')}</Button><Button size="sm" variant="dark" icon="close" onClick={() => void decideAppearance('rejected')}>{t('admin.reject')}</Button><Button size="sm" variant="ghost" icon="delete" onClick={() => void deleteAppearance(editingAppearance)}>{t('admin.delete')}</Button><Button size="sm" variant="ghost" onClick={() => setEditingAppearance(null)}>{t('profile.cancelEdit')}</Button></div></div></Panel> : null}

      {tab === 'accounts' ? <div className="admin-list"><AdminSectionError label={t('admin.accountsHeading', { count: users.length })} failure={sectionStates.accounts.error} onRetry={() => void refresh('accounts')} /><TextField label={t('admin.reviewReason')} value={reason} onChange={setReason} /><h2>{t('admin.accountsHeading', { count: users.length })}</h2>{users.map((account) => <Panel key={account.id} variant="dark" padding="12px"><div className="admin-card"><div className="admin-card-head"><span><b>{account.displayName || account.phone || account.id.slice(0, 8)}</b><small>{account.phone || t('admin.anonymousLegacy')} · {account.role} · {dateLabel(account.createdAt, i18n.language)}</small></span><span className="profile-pill">{t(`auth.statusValues.${account.status}`)}</span></div><div className="admin-card-actions">{account.status === 'active' ? <Button size="sm" variant="dark" icon="lock" disabled={account.id === user?.id} onClick={() => void accountAction(account, 'suspend-user')}>{t('admin.suspend')}</Button> : <Button size="sm" variant="solid" icon="reload" onClick={() => void accountAction(account, 'reactivate-user')}>{t('admin.reactivate')}</Button>}<Button size="sm" variant="ghost" icon="delete" disabled={account.id === user?.id} onClick={() => void accountAction(account, 'delete-user')}>{t('admin.hardDelete')}</Button></div></div></Panel>)}</div> : null}

      {tab === 'audit' ? (
        <div className="admin-list">
          <AdminSectionError label={t('admin.auditHeading')} failure={sectionStates.audit.error} onRetry={() => void refresh('audit')} />
          <h2>{t('admin.auditHeading')}</h2>
          {events.map((event) => (
            <Panel key={event.id} variant="dark" padding="12px">
              <div className="admin-event">
                <b>{event.action}</b>
                <span>
                  {event.subjectType} · {event.subjectId}
                </span>
                <small>
                  {dateLabel(event.createdAt, i18n.language)}
                  {event.note ? ` · ${event.note}` : ''}
                </small>
              </div>
            </Panel>
          ))}
        </div>
      ) : null}
    </section>
  )
}
