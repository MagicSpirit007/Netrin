import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { installAppearanceCatalogItem } from '../appearance/catalog'
import { localAppearanceRepository } from '../appearance/repository'
import type { AppearancePackage } from '../appearance/types'
import { Button } from '../components/core/Button'
import { RouteCard } from '../components/domain/RouteCard'
import { RouteCatalogFilters } from '../components/forms/RouteCatalogFilters'
import { SearchField } from '../components/forms/SearchField'
import { PixelIcon } from '../components/icons/PixelIcon'
import { Panel } from '../components/surfaces/Panel'
import { fetchAppearanceCatalog, type AppearanceCatalogItem } from '../data/moderation'
import { fetchDiscoveryRoutes, fetchRecommendedRoutes } from '../data/routeLibrary'
import { textFor } from '../data/nature'
import type { DiscoveryCursor, DiscoveryQuery, RouteSummary } from '../data/types'
import { useNetrinState } from '../state/NetrinState'
import {
  cityParamsForPath,
  pathWithParams,
  readCityFilter,
  readRouteCatalogQuery,
  routeMatchesCatalogQuery
} from './routeCatalogParams'

type WorkshopPhase = 'loading' | 'ready' | 'error'

function optionalNumber(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function distanceLabel(meters: number | undefined): string | undefined {
  if (meters == null) return undefined
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

function durationLabel(seconds: number | undefined): string | undefined {
  return seconds == null ? undefined : `${Math.max(1, Math.round(seconds / 60))} min`
}

export function WorkshopScreen() {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { appearanceSettings, isDownloaded, setActiveRouteId, updateAppearanceSettings } = useNetrinState()
  const [routes, setRoutes] = useState<RouteSummary[]>([])
  const [appearanceCatalog, setAppearanceCatalog] = useState<AppearanceCatalogItem[]>([])
  const [installedAppearances, setInstalledAppearances] = useState<AppearancePackage[]>([])
  const [nextCursor, setNextCursor] = useState<DiscoveryCursor>()
  const [phase, setPhase] = useState<WorkshopPhase>('loading')
  const [error, setError] = useState<'unconfigured' | 'network' | 'invalid'>()
  const [loadingMore, setLoadingMore] = useState(false)
  const [installingAppearanceId, setInstallingAppearanceId] = useState('')
  const [appearanceNotice, setAppearanceNotice] = useState('')
  const [locationNotice, setLocationNotice] = useState('')
  const requestId = useRef(0)

  const catalog = params.get('catalog') === 'appearance' ? 'appearance' : 'routes'
  const search = params.get('q') ?? ''
  const cityFilter = readCityFilter(params)
  const recommendation = params.get('recommend') === 'nearby'
    ? 'nearby'
    : params.get('recommend') === 'popular'
      ? 'popular'
      : 'new'
  const nearLng = optionalNumber(params.get('nearLng'))
  const nearLat = optionalNumber(params.get('nearLat'))
  const discoveryQuery = useMemo<DiscoveryQuery>(() => ({
    ...readRouteCatalogQuery(params),
    limit: 20,
  }), [params])
  const queryKey = JSON.stringify({
    catalog,
    query: discoveryQuery,
    nearLat,
    nearLng,
    recommendation,
    refresh: params.get('refresh')
  })

  useEffect(() => {
    const currentRequest = ++requestId.current
    if (catalog === 'appearance') {
      setPhase('loading')
      setRoutes([])
      setNextCursor(undefined)
      setError(undefined)
      void Promise.all([fetchAppearanceCatalog(), localAppearanceRepository.list()]).then(([result, installed]) => {
        if (requestId.current !== currentRequest) return
        setInstalledAppearances(installed)
        if (!result.ok) {
          setAppearanceCatalog([])
          setError('network')
          setPhase('error')
          return
        }
        setAppearanceCatalog(result.data)
        setPhase('ready')
      })
      return
    }
    setPhase('loading')
    setError(undefined)
    setRoutes([])
    setNextCursor(undefined)

    const request =
      recommendation === 'nearby' && nearLng != null && nearLat != null
        ? fetchRecommendedRoutes({
            basis: 'nearby',
            cityAdcode: cityFilter?.adcode,
            location: [nearLng, nearLat]
          })
        : recommendation === 'popular'
          ? fetchRecommendedRoutes({ basis: 'popular', cityAdcode: cityFilter?.adcode })
        : fetchDiscoveryRoutes(discoveryQuery)

    void request.then((result) => {
      if (requestId.current !== currentRequest) return
      if (!result.ok) {
        setError(result.error)
        setPhase('error')
        return
      }
      setRoutes(result.routes)
      setNextCursor(recommendation === 'new' ? result.nextCursor : undefined)
      setPhase('ready')
    })
  // Serialized inputs prevent URLSearchParams identity changes from repeating the request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey])

  const updateParams = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params)
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    setParams(next, { replace: true })
  }

  const chooseRoutes = () => {
    updateParams({
      recommend: undefined,
      nearLng: undefined,
      nearLat: undefined
    })
    setLocationNotice('')
  }

  const choosePopular = () => {
    updateParams({ recommend: 'popular', nearLng: undefined, nearLat: undefined })
    setLocationNotice('')
  }

  const chooseCatalog = (nextCatalog: 'routes' | 'appearance') => {
    updateParams({ catalog: nextCatalog === 'appearance' ? 'appearance' : undefined })
    setLocationNotice('')
  }

  const useNearby = () => {
    if (!navigator.geolocation) {
      setLocationNotice(t('routes.locationUnavailable'))
      return
    }
    setLocationNotice(t('routes.locating'))
    navigator.geolocation.getCurrentPosition((position) => {
      updateParams({
        recommend: 'nearby',
        nearLng: position.coords.longitude.toFixed(4),
        nearLat: position.coords.latitude.toFixed(4)
      })
      setLocationNotice('')
    }, () => {
      setLocationNotice(t('routes.locationDenied'))
      updateParams({
        recommend: undefined,
        nearLng: undefined,
        nearLat: undefined
      })
    }, {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 300000
    })
  }

  const loadMore = async () => {
    if (!nextCursor || loadingMore || recommendation !== 'new') return
    setLoadingMore(true)
    const result = await fetchDiscoveryRoutes({ ...discoveryQuery, cursor: nextCursor })
    setLoadingMore(false)
    if (!result.ok) return
    setRoutes((current) => {
      const known = new Set(current.map((route) => route.id))
      return [...current, ...result.routes.filter((route) => !known.has(route.id))]
    })
    setNextCursor(result.nextCursor)
  }

  const visibleRoutes = useMemo(() => {
    const filtered = routes.filter((route) => routeMatchesCatalogQuery(route, discoveryQuery))
    const needle = search.trim().toLowerCase()
    if (!needle) return filtered
    return filtered.filter((route) => [
      textFor(route.title, i18n.language),
      textFor(route.description, i18n.language),
      route.author,
      route.cityName,
      ...route.tags
    ].join(' ').toLowerCase().includes(needle))
  }, [discoveryQuery, i18n.language, routes, search])

  const visibleAppearances = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return appearanceCatalog
    return appearanceCatalog.filter((appearance) => [
      appearance.displayName,
      appearance.packageId,
      appearance.summary,
      appearance.declaredAuthor,
      appearance.license
    ].join(' ').toLowerCase().includes(needle))
  }, [appearanceCatalog, search])

  const reasonFor = (route: RouteSummary) => {
    const reason = route.recommendationReason ?? (
      cityFilter?.adcode && route.cityName ? 'city' : recommendation
    )
    if (reason === 'city' && route.cityName) {
      return t('routes.cityReason', { city: route.cityName })
    }
    return t(`routes.${reason}Reason`)
  }

  const openRoute = (routeId: string) => {
    setActiveRouteId(routeId)
    navigate(`/route/${routeId}`)
  }

  const installAppearance = async (item: AppearanceCatalogItem) => {
    setInstallingAppearanceId(item.id)
    setAppearanceNotice(t('workshop.appearanceDownloading', { name: item.displayName }))
    const result = await installAppearanceCatalogItem(item)
    setInstallingAppearanceId('')
    if (!result.ok) {
      setAppearanceNotice(t(`workshop.appearanceInstallErrors.${result.error}`))
      return
    }
    setInstalledAppearances(await localAppearanceRepository.list())
    setAppearanceNotice(t('workshop.appearanceInstalled', { name: item.displayName }))
  }

  const activateAppearance = async (item: AppearanceCatalogItem) => {
    if (!await localAppearanceRepository.setActive(item.packageId)) return
    updateAppearanceSettings({ appearanceId: item.packageId })
    setAppearanceNotice(t('workshop.appearanceActivated', { name: item.displayName }))
  }

  const backUrl = pathWithParams('/discover', cityParamsForPath(params))

  return (
    <section
      className="screen workshop-screen"
      data-appearance-state={phase === 'error' ? 'error' : (catalog === 'appearance' ? visibleAppearances.length : visibleRoutes.length) ? 'ready' : 'empty'}
    >
      <header className="screen-heading" data-appearance-hook="top-bar">
        <div className="screen-head-row">
          <div>
            <h1>{t('workshop.title')}</h1>
          </div>
          <Button variant="dark" size="sm" icon="arrow-left" onClick={() => navigate(backUrl)}>
            {t('workshop.backToRoutes')}
          </Button>
        </div>
      </header>

      <div className="workshop-catalog-tabs" aria-label={t('workshop.catalogTypes')}>
        <Button
          block
          variant={catalog === 'routes' ? 'solid' : 'dark'}
          icon="book-open"
          aria-pressed={catalog === 'routes'}
          onClick={() => chooseCatalog('routes')}
        >
          {t('workshop.tourRoutes')}
        </Button>
        <Button
          block
          variant={catalog === 'appearance' ? 'solid' : 'dark'}
          icon="eye"
          aria-pressed={catalog === 'appearance'}
          onClick={() => chooseCatalog('appearance')}
        >
          {t('workshop.appearanceSets')}
        </Button>
      </div>

      {catalog === 'routes' ? (
        <>
          <SearchField
            value={search}
            onChange={(value) => updateParams({ q: value || undefined })}
            onClear={() => updateParams({ q: undefined })}
            placeholder={t('workshop.search')}
            clearLabel={t('common.clear')}
          />

          <div className="chip-row workshop-route-subnav" aria-label={t('workshop.routeSubnav')}>
            <Button size="sm" variant={recommendation === 'new' ? 'solid' : 'dark'} icon="calendar" onClick={chooseRoutes}>{t('routes.newRecommendation')}</Button>
            <Button size="sm" variant={recommendation === 'nearby' ? 'solid' : 'dark'} icon="gps" onClick={useNearby}>{t('routes.nearbyRecommendation')}</Button>
            <Button size="sm" variant={recommendation === 'popular' ? 'solid' : 'dark'} icon="download" onClick={choosePopular}>{t('routes.popularRecommendation')}</Button>
          </div>
          {locationNotice ? <p className="quiet" role="status">{locationNotice}</p> : null}

          <RouteCatalogFilters
            params={params}
            onChange={(next) => setParams(next, { replace: true })}
          />
        </>
      ) : (
        <>
          <SearchField
            value={search}
            onChange={(value) => updateParams({ q: value || undefined })}
            onClear={() => updateParams({ q: undefined })}
            placeholder={t('workshop.searchAppearances')}
            clearLabel={t('common.clear')}
          />
          <p className="quiet workshop-appearance-intro">{t('workshop.appearanceCatalogHint')}</p>
          {appearanceNotice ? <p className="save-message" role="status" data-appearance-hook="toast">{appearanceNotice}</p> : null}
        </>
      )}

      {phase === 'loading' ? <p className="quiet" data-appearance-hook="loading-state" role="status">{t(catalog === 'appearance' ? 'workshop.appearanceLoading' : 'workshop.loading')}</p> : null}

      {phase === 'error' ? (
        <Panel variant="dark">
          <div className="empty-state" data-appearance-hook="error-state">
            <PixelIcon name="cloud" size={28} />
            <h2 className="section-title">
              {error === 'unconfigured' ? t('workshop.unconfiguredTitle') : t(catalog === 'appearance' ? 'workshop.appearanceErrorTitle' : 'workshop.errorTitle')}
            </h2>
            <p className="quiet">
              {error === 'unconfigured' ? t('workshop.unconfiguredHint') : t(catalog === 'appearance' ? 'workshop.appearanceErrorHint' : 'workshop.errorHint')}
            </p>
            <Button icon="reload" onClick={() => updateParams({ refresh: String(Date.now()) })}>
              {t('workshop.retry')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {catalog === 'appearance' && phase === 'ready' && visibleAppearances.length > 0 ? (
        <div className="stack" data-appearance-slot="catalog-list">
          {visibleAppearances.map((item) => {
            const installed = installedAppearances.find((appearance) => appearance.manifest.id === item.packageId)
            const currentVersionInstalled = installed?.manifest.version === item.packageVersion
            const active = appearanceSettings.appearanceId === item.packageId
            const installing = installingAppearanceId === item.id
            return (
              <div data-appearance-hook="card" key={item.id}>
              <Panel className={`workshop-appearance-card ${active ? 'workshop-appearance-card--active' : ''}`} variant="panel" shadow>
                <div className="screen-head-row">
                  <div>
                    <span className="eyeline">{item.packageId}</span>
                    <h2>{item.displayName}</h2>
                  </div>
                  <span className="profile-pill">
                    {active
                      ? t('workshop.appearanceActive')
                      : currentVersionInstalled
                        ? t('workshop.appearanceInstalledBadge')
                        : installed
                          ? t('workshop.appearanceUpdateBadge')
                          : t('workshop.appearanceApproved')}
                  </span>
                </div>
                {item.summary ? <p>{item.summary}</p> : null}
                <dl className="appearance-metadata">
                  <div><dt>{t('workshop.appearanceVersion')}</dt><dd>{item.packageVersion}</dd></div>
                  <div><dt>{t('workshop.appearanceAuthor')}</dt><dd>{item.declaredAuthor}</dd></div>
                  <div><dt>{t('workshop.appearanceLicense')}</dt><dd>{item.license}</dd></div>
                  <div><dt>{t('workshop.appearanceSize')}</dt><dd>{Math.max(1, Math.round(item.bytes / 1024))} KiB</dd></div>
                </dl>
                <div className="appearance-package__actions">
                  {!currentVersionInstalled ? (
                    <Button block icon="download" disabled={installing} onClick={() => void installAppearance(item)}>
                      {installing
                        ? t('workshop.appearanceInstalling')
                        : installed
                          ? t('workshop.appearanceUpdate')
                          : t('workshop.appearanceInstall')}
                    </Button>
                  ) : (
                    <Button block variant={active ? 'solid' : 'dark'} icon={active ? 'check' : 'reload'} disabled={active} onClick={() => void activateAppearance(item)}>
                      {active ? t('workshop.appearanceInUse') : t('workshop.appearanceActivate')}
                    </Button>
                  )}
                </div>
              </Panel>
              </div>
            )
          })}
        </div>
      ) : null}

      {catalog === 'appearance' && phase === 'ready' && visibleAppearances.length === 0 ? (
        <Panel variant="dark">
          <div className="empty-state" data-appearance-hook="empty-state">
            <PixelIcon name="eye" size={28} />
            <h2 className="section-title">{t(search ? 'workshop.appearanceSearchEmptyTitle' : 'workshop.appearanceEmptyTitle')}</h2>
            <p className="quiet">{t(search ? 'workshop.appearanceSearchEmptyHint' : 'workshop.appearanceEmptyHint')}</p>
          </div>
        </Panel>
      ) : null}

      {catalog === 'routes' && phase === 'ready' && visibleRoutes.length > 0 ? (
        <div className="discover-list">
          {visibleRoutes.map((route) => {
            const downloaded = isDownloaded(route.id)
            return (
              <RouteCard
                key={route.id}
                title={textFor(route.title, i18n.language)}
                description={textFor(route.description, i18n.language)}
                photoUrl={route.coverUrl}
                distance={distanceLabel(route.distanceM)}
                duration={durationLabel(route.durationS)}
                pointCount={route.pointCount}
                season={reasonFor(route)}
                active={downloaded}
                chooseLabel={t('workshop.openAndDownload')}
                selectedLabel={t('workshop.openDownloaded')}
                chooseIcon="download"
                selectedIcon="check"
                onSelect={() => openRoute(route.id)}
              />
            )
          })}
        </div>
      ) : null}

      {catalog === 'routes' && phase === 'ready' && visibleRoutes.length === 0 ? (
        <Panel variant="dark">
          <div className="empty-state" data-appearance-hook="empty-state">
            <PixelIcon name="cloud" size={28} />
            <h2 className="section-title">{t('workshop.emptyTitle')}</h2>
            <p className="quiet">{t('workshop.emptyHint')}</p>
          </div>
        </Panel>
      ) : null}

      {catalog === 'routes' && phase === 'ready' && nextCursor ? (
        <Button block variant="dark" icon="chevron-down" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? t('workshop.loading') : t('routes.loadMore')}
        </Button>
      ) : null}
    </section>
  )
}

export default WorkshopScreen
