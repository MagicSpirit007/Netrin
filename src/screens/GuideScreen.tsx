import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/core/Button'
import { Panel } from '../components/surfaces/Panel'
import { useRouteDetail } from '../data/useRouteDetail'
import { HomeScreen } from './HomeScreen'

export function GuideScreen() {
  const { routeId } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { state, retry } = useRouteDetail(routeId)

  if (state.phase === 'ready' && state.route.geometry) {
    return (
      <div className="guide-route">
        <HomeScreen routeOverride={state.route} />
        <Button
          className="guide-route__back"
          variant="paper"
          size="sm"
          icon="arrow-left"
          onClick={() => navigate(`/route/${state.route.id}`)}
        >
          {t('guide.backToDetail')}
        </Button>
      </div>
    )
  }

  return (
    <section className="screen guide-route__state">
      <Panel variant="dark">
        <div className="empty-state">
          <h1 className="section-title">
            {state.phase === 'loading' ? t('guide.loading') : t('guide.unavailableTitle')}
          </h1>
          {state.phase === 'error' ? <p className="quiet">{t(`routeDetail.errors.${state.error}`)}</p> : null}
          {state.phase === 'ready' && !state.route.geometry ? <p className="quiet">{t('routeDetail.geometryPending')}</p> : null}
          {state.phase === 'error' ? <Button icon="reload" onClick={retry}>{t('common.retry')}</Button> : null}
          <Button variant="dark" icon="arrow-left" onClick={() => navigate(`/route/${routeId ?? ''}`)}>
            {t('guide.backToDetail')}
          </Button>
        </div>
      </Panel>
    </section>
  )
}
