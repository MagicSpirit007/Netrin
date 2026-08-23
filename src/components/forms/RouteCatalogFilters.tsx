import { useTranslation } from 'react-i18next'
import { clearRouteCatalogFilters, hasRouteCatalogFilters, readCityFilter, writeCityFilter } from '../../screens/routeCatalogParams'
import { Button } from '../core/Button'
import { PixelIcon } from '../icons/PixelIcon'
import { CitySearchFilter } from './CitySearchFilter'

type RouteCatalogFiltersProps = {
  params: URLSearchParams
  onChange: (params: URLSearchParams) => void
}

function updateParams(
  params: URLSearchParams,
  updates: Record<string, string | undefined>
): URLSearchParams {
  const next = new URLSearchParams(params)
  Object.entries(updates).forEach(([key, value]) => {
    if (value) next.set(key, value)
    else next.delete(key)
  })
  return next
}

export function RouteCatalogFilters({ params, onChange }: RouteCatalogFiltersProps) {
  const { t } = useTranslation()
  const cityFilter = readCityFilter(params)
  const update = (updates: Record<string, string | undefined>) => {
    onChange(updateParams(params, updates))
  }

  return (
    <details
      className="discover-filters"
      data-route-catalog-filters
      open={hasRouteCatalogFilters(params)}
    >
      <summary><PixelIcon name="filter" size={18} />{t('routes.filters')}</summary>
      <div className="discover-filters__grid">
        <CitySearchFilter
          value={cityFilter}
          label={t('routes.cityName')}
          placeholder={t('routes.citySearchPlaceholder')}
          loadingLabel={t('routes.citySearchLoading')}
          emptyLabel={t('routes.citySearchEmpty')}
          errorLabel={t('routes.citySearchError')}
          selectedFallback={t('routes.selectedCity')}
          clearLabel={t('common.clear')}
          onChange={(city) => onChange(writeCityFilter(params, city))}
        />
        <label className="nfield">
          <span className="nfield__label">{t('routes.mode')}</span>
          <select value={params.get('mode') ?? ''} onChange={(event) => update({ mode: event.target.value || undefined })}>
            <option value="">{t('routes.any')}</option>
            <option value="walking">{t('routeDetail.modes.walking')}</option>
            <option value="cycling">{t('routeDetail.modes.cycling')}</option>
          </select>
        </label>
        <label className="nfield">
          <span className="nfield__label">{t('routes.distanceFilter')}</span>
          <select
            value={`${params.get('minDistanceM') ?? ''}-${params.get('maxDistanceM') ?? ''}`}
            onChange={(event) => {
              const [min, max] = event.target.value.split('-')
              update({ minDistanceM: min || undefined, maxDistanceM: max || undefined })
            }}
          >
            <option value="-">{t('routes.any')}</option>
            <option value="-3000">≤ 3 km</option>
            <option value="3000-10000">3–10 km</option>
            <option value="10000-">≥ 10 km</option>
          </select>
        </label>
        <label className="nfield">
          <span className="nfield__label">{t('routes.durationFilter')}</span>
          <select
            value={`${params.get('minDurationS') ?? ''}-${params.get('maxDurationS') ?? ''}`}
            onChange={(event) => {
              const [min, max] = event.target.value.split('-')
              update({ minDurationS: min || undefined, maxDurationS: max || undefined })
            }}
          >
            <option value="-">{t('routes.any')}</option>
            <option value="-3600">≤ 60 min</option>
            <option value="3600-10800">1–3 h</option>
            <option value="10800-">≥ 3 h</option>
          </select>
        </label>
        <label className="nfield">
          <span className="nfield__label">{t('routes.difficulty')}</span>
          <select value={params.get('difficulty') ?? ''} onChange={(event) => update({ difficulty: event.target.value || undefined })}>
            <option value="">{t('routes.any')}</option>
            <option value="easy">{t('record.difficulties.easy')}</option>
            <option value="moderate">{t('record.difficulties.moderate')}</option>
            <option value="hard">{t('record.difficulties.hard')}</option>
          </select>
        </label>
      </div>
      <Button size="sm" variant="ghost" icon="close" onClick={() => onChange(clearRouteCatalogFilters(params))}>
        {t('routes.clearFilters')}
      </Button>
    </details>
  )
}

export default RouteCatalogFilters
