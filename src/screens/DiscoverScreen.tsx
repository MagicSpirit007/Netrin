import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../components/core/Button'
import { AmapNetrinMap as NetrinMap } from '../components/domain/AmapNetrinMap'
import { RouteCard } from '../components/domain/RouteCard'
import { RouteCatalogFilters } from '../components/forms/RouteCatalogFilters'
import { SearchField } from '../components/forms/SearchField'
import { PixelIcon } from '../components/icons/PixelIcon'
import { Panel } from '../components/surfaces/Panel'
import {
  buildLocalRouteCatalog,
  filterLocalRouteCatalog,
  type LocalRouteSummary
} from '../data/localRouteCatalog'
import { textFor } from '../data/nature'
import type { RouteBounds } from '../data/types'
import { useNetrinState } from '../state/NetrinState'
import {
  cityParamsForPath,
  legacyWorkshopParams,
  pathWithParams,
  readCityFilter,
  readRouteCatalogQuery
} from './routeCatalogParams'

function distanceLabel(meters: number | undefined): string | undefined {
  if (meters == null) return undefined
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

function durationLabel(seconds: number | undefined): string | undefined {
  return seconds == null ? undefined : `${Math.max(1, Math.round(seconds / 60))} min`
}

export function DiscoverScreen() {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const {
    activeRouteId,
    appearanceSettings,
    downloadedRoutes,
    downloadsReady,
    draftsReady,
    routeDrafts,
    setActiveRouteId
  } = useNetrinState()
  const [selectedId, setSelectedId] = useState('')
  const [pendingBounds, setPendingBounds] = useState<RouteBounds>()

  const view = params.get('view') === 'map' ? 'map' : 'list'
  const search = params.get('q') ?? ''
  const cityFilter = readCityFilter(params)
  const workshopUrl = pathWithParams('/workshop', cityParamsForPath(params))
  const legacyWorkshop = legacyWorkshopParams(params)
  const routes = useMemo(
    () => buildLocalRouteCatalog(downloadedRoutes, routeDrafts),
    [downloadedRoutes, routeDrafts]
  )
  const phase = draftsReady && downloadsReady ? 'ready' : 'loading'
  const query = useMemo(() => readRouteCatalogQuery(params), [params])

  const updateParams = (updates: Record<string, string | undefined>, replace = true) => {
    const next = new URLSearchParams(params)
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    setParams(next, { replace })
  }

  const visibleRoutes = useMemo(() => {
    const filtered = filterLocalRouteCatalog(routes, query, cityFilter?.name)
    const needle = search.trim().toLowerCase()
    if (!needle) return filtered
    return filtered.filter((route) => [
      textFor(route.title, i18n.language),
      textFor(route.description, i18n.language),
      route.author,
      route.cityName,
      ...route.tags
    ].join(' ').toLowerCase().includes(needle))
  }, [cityFilter?.name, i18n.language, query, routes, search])

  const mapStops = useMemo(() => visibleRoutes.flatMap((route, index) => {
    if (!route.bounds) return []
    return [{
      id: route.id,
      location: [
        (route.bounds.minLng + route.bounds.maxLng) / 2,
        (route.bounds.minLat + route.bounds.maxLat) / 2
      ] as [number, number],
      index: index + 1,
      label: textFor(route.title, i18n.language)
    }]
  }), [i18n.language, visibleRoutes])

  const selected = visibleRoutes.find((route) => route.id === selectedId)
  const openRoute = (id: string) => navigate(`/route/${id}`)
  const toggleRouteSelection = (id: string) => {
    setActiveRouteId(activeRouteId === id ? '' : id)
  }

  const applyBounds = () => {
    if (!pendingBounds) return
    updateParams({
      minLng: pendingBounds.minLng.toFixed(6),
      minLat: pendingBounds.minLat.toFixed(6),
      maxLng: pendingBounds.maxLng.toFixed(6),
      maxLat: pendingBounds.maxLat.toFixed(6)
    })
  }

  const sourceFor = (route: LocalRouteSummary) => t(`routes.sources.${route.localSource}`)

  if (legacyWorkshop) {
    return <Navigate to={pathWithParams('/workshop', legacyWorkshop)} replace />
  }

  return (
    <section className="screen discover-screen" data-appearance-state={phase === 'loading' ? 'loading' : visibleRoutes.length ? 'ready' : 'empty'}>
      <header className="screen-heading" data-appearance-hook="top-bar">
        <h1>{t('routes.title')}</h1>
        <div className="discover-toolbar">
          <Button size="sm" variant="solid" icon="cloud" onClick={() => navigate(workshopUrl)}>{t('routes.workshop')}</Button>
          <div className="discover-view-toggle">
            <Button size="sm" variant={view === 'list' ? 'solid' : 'dark'} icon="book-open" onClick={() => updateParams({ view: undefined })}>{t('routes.listView')}</Button>
            <Button size="sm" variant={view === 'map' ? 'solid' : 'dark'} icon="globe" onClick={() => updateParams({ view: 'map' })}>{t('routes.mapView')}</Button>
          </div>
        </div>
      </header>

      <SearchField value={search} onChange={(value) => updateParams({ q: value || undefined })} onClear={() => updateParams({ q: undefined })} placeholder={t('routes.search')} clearLabel={t('common.clear')} />

      <RouteCatalogFilters
        params={params}
        onChange={(next) => setParams(next, { replace: true })}
      />

      {phase === 'loading' ? <p className="quiet" role="status">{t('routes.loading')}</p> : null}

      {phase === 'ready' && view === 'map' ? (
        <>
          <Panel variant="paper" shadow padding="0" style={{ overflow: 'hidden' }}>
            <div className="discover-map"><NetrinMap route={[]} stops={mapStops} activeStopId={selectedId || undefined} onSelectStop={setSelectedId} onBoundsChange={setPendingBounds} mapStyleId={appearanceSettings.mapStyleId} compassLabel={t('home.resetNorth')} /></div>
          </Panel>
          <Button block variant="dark" icon="search" disabled={!pendingBounds} onClick={applyBounds}>{t('routes.searchThisArea')}</Button>
          {selected ? <RouteCard routeId={selected.id} title={textFor(selected.title, i18n.language)} description={textFor(selected.description, i18n.language)} photoUrl={selected.coverUrl} distance={distanceLabel(selected.distanceM)} duration={durationLabel(selected.durationS)} pointCount={selected.pointCount} season={sourceFor(selected)} active={activeRouteId === selected.id} chooseLabel={t('routes.selectRoute')} selectedLabel={t('routes.cancelSelection')} selectedIcon="close" openLabel={t('routes.openRouteDetail', { title: textFor(selected.title, i18n.language) })} onOpen={() => openRoute(selected.id)} onSelect={() => toggleRouteSelection(selected.id)} /> : null}
        </>
      ) : null}

      {phase === 'ready' && view === 'list' ? (
        <div className="discover-list">
          {visibleRoutes.map((route) => <RouteCard key={route.id} routeId={route.id} title={textFor(route.title, i18n.language)} description={textFor(route.description, i18n.language)} photoUrl={route.coverUrl} distance={distanceLabel(route.distanceM)} duration={durationLabel(route.durationS)} pointCount={route.pointCount} season={sourceFor(route)} active={activeRouteId === route.id} chooseLabel={t('routes.selectRoute')} selectedLabel={t('routes.cancelSelection')} selectedIcon="close" openLabel={t('routes.openRouteDetail', { title: textFor(route.title, i18n.language) })} onOpen={() => openRoute(route.id)} onSelect={() => toggleRouteSelection(route.id)} />)}
        </div>
      ) : null}

      {phase === 'ready' && visibleRoutes.length === 0 ? (
        <Panel variant="dark">
          <div className="empty-state">
            <PixelIcon name="leaf" size={28} />
            <h2 className="section-title">{t('routes.emptyTitle')}</h2>
            <p className="quiet">{t('routes.emptyHint')}</p>
            <Button icon="cloud" onClick={() => navigate(workshopUrl)}>{t('routes.emptyCta')}</Button>
          </div>
        </Panel>
      ) : null}
    </section>
  )
}
