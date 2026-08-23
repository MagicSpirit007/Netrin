import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/core/Button'
import {
  PlaceSearchPicker,
  type PlaceSearchPhase
} from '../components/forms/PlaceSearchPicker'
import { Panel } from '../components/surfaces/Panel'
import type { AmapSearchResult } from '../lib/amap/search'
import type { RouteBounds } from '../data/types'
import type { MapPlanningCandidate } from './createMapPlanning'

type MapPlanningWorkspaceProps = {
  search: string
  city?: string
  searchCityName?: string
  bounds?: RouteBounds
  candidate: MapPlanningCandidate | null
  pointCount: number
  addedIndex?: number
  children: ReactNode
  onSearchChange: (value: string) => void
  onSearchPhaseChange: (phase: PlaceSearchPhase) => void
  onSelectSearchResult: (result: AmapSearchResult) => void
  onCancelCandidate: () => void
  onAddCandidate: () => void
}

export function MapPlanningWorkspace({
  search,
  city,
  searchCityName,
  bounds,
  candidate,
  pointCount,
  addedIndex,
  children,
  onSearchChange,
  onSearchPhaseChange,
  onSelectSearchResult,
  onCancelCandidate,
  onAddCandidate
}: MapPlanningWorkspaceProps) {
  const { t } = useTranslation()

  return (
    <>
      <div className="map-planner__search">
        <PlaceSearchPicker
          value={search}
          city={city}
          bounds={bounds}
          label={t('home.searchMap')}
          placeholder={t('record.mapSearchPlaceholder')}
          loadingLabel={t('home.searching')}
          emptyLabel={t('home.searchEmpty')}
          errorLabel={t('record.mapSearchError')}
          retryLabel={t('common.retry')}
          clearLabel={t('common.clear')}
          cityResultLabel={t('routes.cityName')}
          onChange={onSearchChange}
          onSelect={onSelectSearchResult}
          onPhaseChange={onSearchPhaseChange}
        />
        <p className="quiet map-planner__search-hint">
          {searchCityName
            ? `${t('routes.selectedCity')}: ${searchCityName} · ${t('record.mapTapHint')}`
            : t('record.mapTapHint')}
        </p>
      </div>

      {children}

      {candidate ? (
        <Panel variant="dark" padding="14px" className="map-planner__candidate">
          <div className="map-planner__candidate-copy">
            <span className="eyeline">{t('home.stopPreview')}</span>
            <b>{candidate.label || t('record.keyPoint')}</b>
            {candidate.address || candidate.cityName ? (
              <span>{[candidate.address, candidate.cityName].filter(Boolean).join(' · ')}</span>
            ) : null}
            <small className="kp-coords">
              {candidate.coordinate[0].toFixed(5)}, {candidate.coordinate[1].toFixed(5)}
            </small>
          </div>
          <div className="rec-grid">
            <Button variant="dark" icon="close" onClick={onCancelCandidate}>
              {t('common.cancel')}
            </Button>
            <Button variant="solid" icon="plus" onClick={onAddCandidate}>
              {t('record.addAsKeyPoint', { index: pointCount + 1 })}
            </Button>
          </div>
        </Panel>
      ) : null}

      {addedIndex != null ? (
        <p className="save-message" role="status">
          {t('record.mapPointAdded', { index: addedIndex })}
        </p>
      ) : null}
    </>
  )
}

export default MapPlanningWorkspace
