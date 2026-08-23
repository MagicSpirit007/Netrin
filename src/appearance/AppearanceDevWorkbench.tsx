import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { REQUIRED_APPEARANCE_COMPONENTS, REQUIRED_APPEARANCE_SCREENS, STABLE_APPEARANCE_SLOTS } from './contract'
import { parseAppearanceArchive } from './packageFormat'
import type { AppearanceCoverageItem, AppearanceCoverageReport, AppearancePackage, AppearancePackageAuditReport } from './types'
import { AppearancePreview } from './AppearancePreview'
import './AppearanceDevWorkbench.css'

type DevStatus = { revision: number; sourceDirectory: string; report: AppearancePackageAuditReport }

function cssTargets(css: string, attribute: string, id: string) {
  return new RegExp(`\\[${attribute}\\s*=\\s*["']${id}["']\\]`).test(css)
}

export function createAppearanceCoverage(appearance: AppearancePackage | null): AppearanceCoverageReport {
  const css = appearance?.sanitizedCss ?? ''
  const source = (attribute: string, id: string): AppearanceCoverageItem['styledBy'] => (
    cssTargets(css, attribute, id) ? 'css' : appearance?.compiledTokens ? 'token' : 'inherited'
  )
  return {
    screens: REQUIRED_APPEARANCE_SCREENS.map((id) => ({ id, rendered: true, styledBy: source('data-appearance-screen', id) })),
    components: REQUIRED_APPEARANCE_COMPONENTS.map((id) => ({ id, rendered: true, styledBy: source('data-appearance-hook', id) })),
    slots: STABLE_APPEARANCE_SLOTS.map((id) => ({ id, rendered: true, styledBy: source('data-appearance-slot', id) }))
  }
}

export function AppearanceDevWorkbench() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<DevStatus | null>(null)
  const [appearance, setAppearance] = useState<AppearancePackage | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const statusResponse = await fetch('/__netrin/appearance-dev/status', { cache: 'no-store' })
      if (statusResponse.status === 404) return
      const nextStatus = await statusResponse.json() as DevStatus & { error?: string }
      if (!statusResponse.ok || nextStatus.error) throw new Error(nextStatus.error ?? `HTTP ${statusResponse.status}`)
      setStatus(nextStatus)
      const packageResponse = await fetch('/__netrin/appearance-dev/package', { cache: 'no-store' })
      if (packageResponse.ok) {
        const parsed = await parseAppearanceArchive(new Uint8Array(await packageResponse.arrayBuffer()))
        setAppearance(parsed.package ?? null)
      } else setAppearance(null)
      setError('')
    } catch (nextError) {
      setAppearance(null)
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    void refresh()
    const handler = () => void refresh()
    import.meta.hot?.on('netrin:appearance-dev-update', handler)
    return () => import.meta.hot?.off('netrin:appearance-dev-update', handler)
  }, [refresh])

  const coverage = useMemo(() => createAppearanceCoverage(appearance), [appearance])
  const coverageRows = (items: AppearanceCoverageReport['screens'], kind: string) => (
    <div className="appearance-dev-coverage" data-appearance-coverage={kind}>
      {items.map((item) => (
        <p key={item.id} data-appearance-coverage-source={item.styledBy}>
          <code>{item.id}</code><br />
          <span>{t('appearanceStudio.devWorkbench.rendered')} · {t(`appearanceStudio.devWorkbench.sources.${item.styledBy}`)}</span>
        </p>
      ))}
    </div>
  )

  if (!status && !error) return null
  return (
    <section className="appearance-dev-workbench" data-appearance-hook="panel">
      <header>
        <p className="eyeline">appearance:dev · <span className="appearance-dev-source-path">{status?.sourceDirectory}</span></p>
        <h2>{t('appearanceStudio.devWorkbench.title')}</h2>
      </header>
      {error ? <p data-appearance-hook="error-state">{error}</p> : null}
      {status ? <p className="appearance-dev-source-hash">{t('appearanceStudio.devWorkbench.sourceSha')}: <code>{status.report.packageSha256 ?? t('appearanceStudio.devWorkbench.invalidSource')}</code> · {t('appearanceStudio.devWorkbench.revision')} {status.revision}</p> : null}
      {appearance ? <AppearancePreview packageId={appearance.manifest.id} appearance={appearance} /> : null}
      <details><summary>{t('appearanceStudio.devWorkbench.diagnostics')}</summary>
        <pre>{JSON.stringify(appearance?.manifest ?? status?.report, null, 2)}</pre>
        {status?.report.diagnostics.map((diagnostic, index) => (
          <p className="appearance-dev-diagnostic" key={`${diagnostic.code}-${index}`}>
            <code>{diagnostic.file}:{diagnostic.line}:{diagnostic.column}</code> {diagnostic.code} · <code>{diagnostic.tokenPath ?? diagnostic.selector}</code> · {diagnostic.message}
          </p>
        ))}
      </details>
      <details><summary>{t('appearanceStudio.devWorkbench.screenFamilies', { count: REQUIRED_APPEARANCE_SCREENS.length })}</summary>{coverageRows(coverage.screens, 'screens')}</details>
      <details><summary>{t('appearanceStudio.devWorkbench.componentFixtures', { count: REQUIRED_APPEARANCE_COMPONENTS.length })}</summary>{coverageRows(coverage.components, 'components')}</details>
      <details open><summary>{t('appearanceStudio.devWorkbench.brandSlots', { count: STABLE_APPEARANCE_SLOTS.length })}</summary>{coverageRows(coverage.slots, 'slots')}</details>
      <p>{t('appearanceStudio.devWorkbench.evidence')} <code>.netrin-review.json</code>.</p>
    </section>
  )
}
