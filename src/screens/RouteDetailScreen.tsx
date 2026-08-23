import { lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/core/Button'
import { AmapNetrinMap as NetrinMap } from '../components/domain/AmapNetrinMap'
import { RouteStopPhoto } from '../components/domain/RouteStopPhoto'
import { Panel } from '../components/surfaces/Panel'
import { textFor } from '../data/nature'
import { useRouteDetail } from '../data/useRouteDetail'
import { useNetrinState } from '../state/NetrinState'

const RouteDetailOfflinePackage = lazy(async () => {
  const mod = await import('./routeDetailOfflinePackage')
  return { default: mod.RouteDetailOfflinePackage }
})

function formatDistance(meters: number | undefined): string | undefined {
  if (meters == null) return undefined
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}
export function RouteDetailScreen() {
  const { routeId } = useParams()
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const { appearanceSettings, downloadRoute, downloadedRoutes, isDownloaded } = useNetrinState()
  const { state, remoteRoute, remoteStatus, retry } = useRouteDetail(routeId)
  const [selectedStopId, setSelectedStopId] = useState('')
  const [shareNotice, setShareNotice] = useState('')

  const existingDownload = useMemo(
    () => (routeId ? downloadedRoutes.find((route) => route.id === routeId) : undefined),
    [downloadedRoutes, routeId]
  )



  const mapStops = useMemo(() => state.phase === 'ready'
    ? state.route.stops.map((stop, index) => ({
        id: stop.id,
        location: stop.location,
        index: index + 1,
        label: textFor(stop.title, i18n.language)
      }))
    : [], [i18n.language, state])

  if (state.phase === 'loading') {
    return <section className="screen"><p className="quiet">{t('routeDetail.loading')}</p></section>
  }
  if (state.phase === 'error') {
    return (
      <section className="screen">
        <header className="screen-heading"><h1>{t('routeDetail.title')}</h1></header>
        <Panel variant="dark">
          <div className="empty-state">
            <h2 className="section-title">{t('routeDetail.unavailableTitle')}</h2>
            <p className="quiet">{t(`routeDetail.errors.${state.error}`)}</p>
            <Button icon="reload" onClick={retry}>{t('common.retry')}</Button>
          </div>
        </Panel>
      </section>
    )
  }

  const route = state.route
  const selectedStop = route.stops.find((stop) => stop.id === selectedStopId)
  const distance = formatDistance(route.distanceM)
  const durationMinutes = route.durationS == null ? undefined : Math.max(1, Math.round(route.durationS / 60))
  const coverUrl = route.coverMediaId
    ? route.stops.flatMap((stop) => stop.media).find((media) => media.id === route.coverMediaId)?.url
    : undefined

  const shareRoute = async () => {
    const url = new URL(`/route/${route.id}`, window.location.origin).toString()
    const title = textFor(route.title, i18n.language)
    try {
      if (navigator.share) {
        await navigator.share({ title, url })
        setShareNotice(t('routeDetail.shared'))
        return
      }
      await navigator.clipboard.writeText(url)
      setShareNotice(t('routeDetail.copied'))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setShareNotice(t('routeDetail.copyFailed'))
    }
  }

  return (
    <section className="screen route-detail" data-appearance-state="ready">
      <header className="screen-heading" data-appearance-hook="top-bar">
        <div className="screen-head-row">
          <div>
            <p className="route-detail__eyebrow">{t(`routeDetail.modes.${route.travelMode}`)}</p>
            <h1>{textFor(route.title, i18n.language)}</h1>
          </div>
          <Button variant="dark" size="sm" icon="arrow-left" onClick={() => navigate('/discover')}>
            {t('routeDetail.back')}
          </Button>
        </div>
        {route.author ? <p>{t('routeDetail.byAuthor', { author: route.author })}</p> : null}
      </header>

      <Panel variant="paper" shadow padding="0" style={{ overflow: 'hidden' }}>
        {coverUrl ? <img className="route-detail__cover" src={coverUrl} alt="" /> : null}
        <div className="route-detail__map">
          <NetrinMap
            route={route.geometry?.coordinates ?? []}
            stops={mapStops}
            activeStopId={selectedStopId || undefined}
            onSelectStop={setSelectedStopId}
            mapStyleId={appearanceSettings.mapStyleId}
            compassLabel={t('home.resetNorth')}
          />
        </div>
      </Panel>


      <Panel variant="dark" padding="14px">
        <div className="route-detail__stats">
          {distance ? <span><b>{distance}</b>{t('routeDetail.distance')}</span> : null}
          {durationMinutes ? <span><b>{durationMinutes} min</b>{t('routeDetail.duration')}</span> : null}
          <span><b>{route.stops.length}</b>{t('routeDetail.highlights')}</span>
          <Button
            className="route-detail__stat-share"
            variant="dark"
            icon="share"
            onClick={() => void shareRoute()}
          >
            {t('routeDetail.share')}
          </Button>
        </div>
        {shareNotice ? <p className="quiet route-detail__share-notice" role="status">{shareNotice}</p> : null}
        <p>{textFor(route.description, i18n.language)}</p>
        <div className="chip-row">
          {route.cityName ? <span className="nchip">{route.cityName}</span> : null}
          {route.difficulty ? <span className="nchip nchip--selected">{t(`record.difficulties.${route.difficulty}`)}</span> : null}
          {route.isLoop ? <span className="nchip nchip--selected">{t('record.isLoop')}</span> : null}
          {(route.tags ?? []).map((tag) => <span className="nchip" key={tag}>{tag}</span>)}
        </div>
        <Suspense fallback={<p className="quiet">{t('routeDetail.loading')}</p>}>
          <RouteDetailOfflinePackage
            route={route}
            remoteRoute={remoteRoute}
            remoteStatus={remoteStatus}
            existingDownload={existingDownload}
            isDownloaded={isDownloaded(route.id)}
            onDownload={downloadRoute}
            onStartGuide={() => navigate(`/guide/${route.id}`)}
          />
        </Suspense>
      </Panel>

      {selectedStop ? (
        <Panel variant="paper" shadow padding="14px">
          <h2 className="section-title">{textFor(selectedStop.title, i18n.language)}</h2>
          <RouteStopPhoto
            stop={selectedStop}
            className="route-detail__selected-photo"
            alt={textFor(selectedStop.title, i18n.language)}
          />
          <p>{textFor(selectedStop.description, i18n.language)}</p>
        </Panel>
      ) : null}

      <div className="stack">
        <h2 className="section-title">{t('routeDetail.highlightList')}</h2>
        {route.stops.map((stop, index) => (
          <button
            type="button"
            className="route-detail__highlight"
            key={stop.id}
            onClick={() => setSelectedStopId(stop.id)}
          >
            <span className="route-detail__highlight-index">{index + 1}</span>
            <span>
              <b>{textFor(stop.title, i18n.language)}</b>
              <small>{textFor(stop.description, i18n.language)}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
