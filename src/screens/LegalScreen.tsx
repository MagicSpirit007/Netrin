import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/core/Button'
import { Panel } from '../components/surfaces/Panel'

const DISCLOSURE_SECTIONS = ['service', 'privacy', 'thirdParty', 'routeData', 'licensing', 'accounts'] as const

export function LegalScreen() {
  const navigate = useNavigate()
  const { t } = useTranslation('legal')

  return (
    <section className="screen legal-screen">
      <header className="screen-heading">
        <div className="screen-head-row">
          <div>
            <h1>{t('title')}</h1>
            <p>{t('subtitle')}</p>
          </div>
          <Button size="sm" variant="dark" icon="arrow-left" onClick={() => navigate('/profile')}>
            {t('back')}
          </Button>
        </div>
      </header>
      <Panel variant="paper" shadow>
        <p className="legal-notice">{t('notice')}</p>
      </Panel>
      <div className="stack">
        {DISCLOSURE_SECTIONS.map((section) => (
          <Panel key={section} variant="paper" shadow>
            <article className="legal-disclosure">
              <h2>{t(`sections.${section}.title`)}</h2>
              <p>{t(`sections.${section}.body`)}</p>
            </article>
          </Panel>
        ))}
      </div>
    </section>
  )
}
