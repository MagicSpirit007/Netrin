import { lazy, Suspense, useEffect, useMemo, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppearanceAuthoringGuide } from '../appearance/AppearanceAuthoringGuide'
import { installAppearanceCatalogItem } from '../appearance/catalog'
import { AppearancePreview } from '../appearance/AppearancePreview'
import { localAppearanceRepository } from '../appearance/repository'
import type { AppearancePackage, AppearancePackageAuditReport, AppearanceReviewReport, LegacyAppearanceRecord } from '../appearance/types'
import { classifyAppearanceFiles, reviewMatchesCurrentPackage } from '../appearance/workbenchFlow'
import { useAuth } from '../auth/AuthProvider'
import { Button } from '../components/core/Button'
import { PixelIcon } from '../components/icons/PixelIcon'
import { Panel } from '../components/surfaces/Panel'
import {
  fetchAppearanceCatalog,
  fetchMyAppearanceSubmissions,
  submitAppearancePackage,
  adminFailureText,
  type AppearanceCatalogItem,
  type AppearanceSubmission
} from '../data/moderation'
import { useNetrinState } from '../state/NetrinState'
import './AppearanceStudioScreen.css'

const AppearanceDevWorkbench = import.meta.env.DEV
  ? lazy(() => import('../appearance/AppearanceDevWorkbench').then((module) => ({ default: module.AppearanceDevWorkbench })))
  : null
const ISOLATED_APPEARANCE_DEV = import.meta.env.DEV && import.meta.env.NETRIN_APPEARANCE_DEV_ISOLATED === '1'

export function AppearanceStudioScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') === 'guide' ? 'guide' : 'workbench'

  const selectTab = (tab: 'workbench' | 'guide') => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }

  const moveTabFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    if (!tabs.length) return
    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : event.key === 'ArrowLeft'
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length
    tabs[nextIndex]?.click()
    tabs[nextIndex]?.focus()
  }

  return (
    <section className="appearance-studio-screen" data-appearance-state={activeTab}>
      <header className="appearance-studio-header" data-appearance-hook="top-bar">
        <div>
          <p className="eyeline">{t('appearanceStudio.eyeline')}</p>
          <h1>{t('appearanceStudio.title')}</h1>
          <p>{t('appearanceStudio.hint')}</p>
        </div>
        <Button variant="dark" icon="arrow-left" onClick={() => navigate('/profile')}>
          {t('appearanceStudio.backToApp')}
        </Button>
      </header>

      <div
        className="appearance-studio-tabs"
        role="tablist"
        aria-label={t('appearanceStudio.sections')}
        data-appearance-slot="tabs"
        onKeyDown={moveTabFocus}
      >
        <Button
          variant={activeTab === 'workbench' ? 'solid' : 'dark'}
          role="tab"
          aria-selected={activeTab === 'workbench'}
          aria-controls="appearance-studio-workbench"
          tabIndex={activeTab === 'workbench' ? 0 : -1}
          onClick={() => selectTab('workbench')}
        >
          {t('appearanceStudio.tabs.workbench')}
        </Button>
        <Button
          variant={activeTab === 'guide' ? 'solid' : 'dark'}
          role="tab"
          aria-selected={activeTab === 'guide'}
          aria-controls="appearance-studio-guide"
          tabIndex={activeTab === 'guide' ? 0 : -1}
          onClick={() => selectTab('guide')}
        >
          {t('appearanceStudio.tabs.guide')}
        </Button>
      </div>

      {activeTab === 'guide' ? (
        <div id="appearance-studio-guide" role="tabpanel">
          <AppearanceAuthoringGuide />
        </div>
      ) : (
        <div id="appearance-studio-workbench" role="tabpanel">
          <AppearanceStudioWorkbench />
        </div>
      )}
    </section>
  )
}

function AppearanceStudioWorkbench() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, isAnonymous } = useAuth()
  const { appearanceSettings, updateAppearanceSettings } = useNetrinState()
  const [appearancePackages, setAppearancePackages] = useState<AppearancePackage[]>([])
  const [appearanceAudit, setAppearanceAudit] = useState<AppearancePackageAuditReport | null>(null)
  const [selectedAppearanceId, setSelectedAppearanceId] = useState(appearanceSettings.appearanceId)
  const [appearanceFileInfo, setAppearanceFileInfo] = useState<{ name: string; bytes: number } | null>(null)
  const [appearanceDragActive, setAppearanceDragActive] = useState(false)
  const [cloudAppearances, setCloudAppearances] = useState<AppearanceSubmission[]>([])
  const [appearanceCatalog, setAppearanceCatalog] = useState<AppearanceCatalogItem[]>([])
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [notice, setNotice] = useState('')
  const [reviewFile, setReviewFile] = useState<File | null>(null)
  const [reviewReport, setReviewReport] = useState<AppearanceReviewReport | null>(null)
  const [legacyAppearances, setLegacyAppearances] = useState<LegacyAppearanceRecord[]>([])

  const selectedAppearance = useMemo(
    () => appearancePackages.find((appearance) => appearance.manifest.id === selectedAppearanceId),
    [appearancePackages, selectedAppearanceId]
  )
  const reviewMatches = reviewMatchesCurrentPackage(
    reviewReport,
    appearanceAudit,
    selectedAppearance?.manifest.id,
    selectedAppearance?.manifest.version,
    selectedAppearance?.manifest.interfaceContractVersion
  )
  const submitSteps = t('appearanceStudio.submitSteps', { returnObjects: true }) as string[]

  useEffect(() => {
    if (ISOLATED_APPEARANCE_DEV) return
    let active = true
    void Promise.all([localAppearanceRepository.list(), localAppearanceRepository.listLegacy()]).then(([packages, legacy]) => {
      if (!active) return
      setAppearancePackages(packages)
      setLegacyAppearances(legacy)
      setSelectedAppearanceId((current) => (
        packages.some((appearance) => appearance.manifest.id === current)
          ? current
          : appearanceSettings.appearanceId
      ))
    })
    return () => { active = false }
  }, [appearanceSettings.appearanceId])

  useEffect(() => {
    if (ISOLATED_APPEARANCE_DEV) return
    let active = true
    setAppearanceAudit(null)
    void localAppearanceRepository.export(selectedAppearanceId)
      .then((exported) => exported ? localAppearanceRepository.inspect(exported.blob) : null)
      .then((result) => {
        if (active) setAppearanceAudit(result?.report ?? null)
      })
      .catch(() => {
        if (active) setAppearanceAudit(null)
      })
    return () => { active = false }
  }, [selectedAppearance, selectedAppearanceId])

  const loadCloudAppearances = async () => {
    setCatalogStatus('loading')
    const [catalogResult, submissionsResult] = await Promise.all([
      fetchAppearanceCatalog(),
      user && !isAnonymous ? fetchMyAppearanceSubmissions() : Promise.resolve({ ok: true as const, data: [] })
    ])
    if (catalogResult.ok) {
      setAppearanceCatalog(catalogResult.data)
      setCatalogStatus(catalogResult.data.length ? 'ready' : 'empty')
    } else setCatalogStatus('error')
    if (submissionsResult.ok) setCloudAppearances(submissionsResult.data)
  }

  useEffect(() => {
    if (ISOLATED_APPEARANCE_DEV) return
    void loadCloudAppearances()
  // Authentication identity is the intended refresh boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnonymous, user])

  const importAppearanceFile = async (file?: File) => {
    if (!file) return
    setReviewFile(null)
    setReviewReport(null)
    setAppearanceFileInfo({ name: file.name, bytes: file.size })
    const result = await localAppearanceRepository.import(file)
    setAppearanceAudit(result.report)
    setAppearancePackages(await localAppearanceRepository.list())
    if (result.package) setSelectedAppearanceId(result.package.manifest.id)
  }

  const importAppearance = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length) await importFiles(files)
  }

  const importFiles = async (files: FileList | File[]) => {
    const classified = await classifyAppearanceFiles(files)
    if (!classified.ok) {
      setNotice(`${t('appearanceStudio.invalidReview')} (${classified.error})`)
      return
    }
    if (classified.files.packageFile) await importAppearanceFile(classified.files.packageFile)
    if (classified.files.reviewFile && classified.files.reviewReport) {
      setReviewFile(classified.files.reviewFile)
      setReviewReport(classified.files.reviewReport)
      setNotice('')
    }
  }

  const importReview = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length) await importFiles(files)
  }

  const dropAppearance = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setAppearanceDragActive(false)
    await importFiles(event.dataTransfer.files)
  }

  const activateAppearance = async (id: string) => {
    if (await localAppearanceRepository.setActive(id)) {
      setSelectedAppearanceId(id)
      updateAppearanceSettings({ appearanceId: id })
    }
  }

  const exportAppearance = async () => {
    const exported = await localAppearanceRepository.export(selectedAppearanceId)
    if (!exported) return
    const url = URL.createObjectURL(exported.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = exported.fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const deleteAppearance = async (id: string) => {
    if (!await localAppearanceRepository.remove(id)) return
    if (appearanceSettings.appearanceId === id) {
      updateAppearanceSettings({ appearanceId: 'field-guide-phenotype' })
    }
    setSelectedAppearanceId('field-guide-phenotype')
    setAppearancePackages(await localAppearanceRepository.list())
  }

  const exportLegacyAppearance = async (id: string) => {
    const exported = await localAppearanceRepository.exportLegacy(id)
    if (!exported) return
    const url = URL.createObjectURL(exported.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = exported.fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const deleteLegacyAppearance = async (id: string) => {
    if (await localAppearanceRepository.removeLegacy(id)) setLegacyAppearances(await localAppearanceRepository.listLegacy())
  }

  const submitSelectedAppearance = async () => {
    if (!user || isAnonymous) {
      navigate('/auth?next=/appearance-studio')
      return
    }
    if (!selectedAppearance || selectedAppearance.manifest.type !== 'skin' || !reviewFile || !reviewReport) return
    const exported = await localAppearanceRepository.export(selectedAppearance.manifest.id)
    if (!exported) return
    setNotice(t('profile.appearanceSubmitting'))
    const liveInspection = await localAppearanceRepository.inspect(exported.blob)
    if (!reviewMatchesCurrentPackage(
      reviewReport,
      liveInspection.report,
      liveInspection.package?.manifest.id,
      liveInspection.package?.manifest.version,
      liveInspection.package?.manifest.interfaceContractVersion
    )) {
      setAppearanceAudit(liveInspection.report)
      setNotice(t('appearanceStudio.reviewMismatch'))
      return
    }
    const file = new File([exported.blob], exported.fileName, { type: exported.blob.type })
    const result = await submitAppearancePackage(file, reviewFile)
    setNotice(result.ok ? t('profile.appearanceSubmitted') : adminFailureText(result.error))
    if (result.ok) {
      const submissions = await fetchMyAppearanceSubmissions()
      if (submissions.ok) setCloudAppearances(submissions.data)
    }
  }

  const installCatalogAppearance = async (item: AppearanceCatalogItem) => {
    setNotice(t('profile.appearanceDownloading'))
    const result = await installAppearanceCatalogItem(item)
    if (result.ok) {
      setSelectedAppearanceId(result.appearance.manifest.id)
      setAppearanceAudit(result.report)
      setAppearancePackages(await localAppearanceRepository.list())
      setNotice(t('profile.appearanceInstalled'))
    } else {
      setNotice(t('profile.appearanceInstallFailed'))
    }
  }

  return (
    <div className="appearance-studio-workspace">
          <aside className="appearance-studio-column appearance-studio-column--source">
            <Panel variant="dark" padding="16px">
              <div className="appearance-lab">
                <h2>{t('appearanceStudio.authoringTitle')}</h2>
                <ol className="appearance-studio-steps">
                  <li>{t('appearanceStudio.steps.format')}</li>
                  <li>{t('appearanceStudio.steps.skin')}</li>
                  <li>{t('appearanceStudio.steps.phenotype')}</li>
                  <li>{t('appearanceStudio.steps.map')}</li>
                </ol>
                <label
                  className={`appearance-dropzone ${appearanceDragActive ? 'appearance-dropzone--active' : ''}`}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setAppearanceDragActive(true)
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setAppearanceDragActive(false)}
                  onDrop={(event) => void dropAppearance(event)}
                >
                  <PixelIcon name="plus" size={22} />
                  <b>{t('profile.importAppearance')}</b>
                  <span>{t('profile.dropAppearance')}</span>
                  <input
                    type="file"
                    accept=".netrin-appearance,application/zip,application/vnd.netrin.appearance+zip"
                    hidden
                    onChange={(event) => void importAppearance(event)}
                  />
                </label>
                {appearanceFileInfo ? (
                  <p className="appearance-file-info">
                    {appearanceFileInfo.name} · {Math.max(1, Math.round(appearanceFileInfo.bytes / 1024))} KiB
                  </p>
                ) : null}
              </div>
            </Panel>

            <Panel variant="dark" padding="16px">
              <div className="appearance-lab">
                <h2>{t('appearanceStudio.localSets')}</h2>
                <div className="appearance-package-list">
                  {appearancePackages.map((appearance) => {
                    const active = appearanceSettings.appearanceId === appearance.manifest.id
                    const selected = selectedAppearanceId === appearance.manifest.id
                    const activatable = appearance.manifest.type === 'skin' || appearance.manifest.id === 'field-guide-phenotype'
                    return (
                      <div
                        className={`appearance-package ${selected ? 'appearance-package--selected' : ''}`}
                        data-appearance-package-id={appearance.manifest.id}
                        key={appearance.manifest.id}
                      >
                        <button type="button" onClick={() => {
                          setSelectedAppearanceId(appearance.manifest.id)
                          setReviewFile(null)
                          setReviewReport(null)
                          setAppearanceAudit(null)
                        }}>
                          <b>{appearance.manifest.displayName}</b>
                          <small>{appearance.manifest.type} · {appearance.manifest.version}</small>
                        </button>
                        <div className="appearance-package__actions">
                          <Button
                            size="sm"
                            variant={active ? 'solid' : 'dark'}
                            icon={active ? 'check' : 'reload'}
                            disabled={!activatable || active}
                            onClick={() => void activateAppearance(appearance.manifest.id)}
                          >
                            {active ? t('profile.appearanceActive') : activatable ? t('profile.activateAppearance') : t('profile.releaseRequired')}
                          </Button>
                          {appearance.manifest.id !== 'field-guide-phenotype' ? (
                            <Button size="sm" variant="ghost" icon="delete" onClick={() => void deleteAppearance(appearance.manifest.id)}>
                              {t('profile.deleteAppearance')}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {legacyAppearances.length ? <div className="appearance-package-list">
                  <h3>{t('appearanceStudio.legacyUnsupported')}</h3>
                  {legacyAppearances.map((appearance) => <div className="appearance-package" key={`${appearance.source}-${appearance.id}`}>
                    <span><b>{appearance.id}</b><small>{appearance.source} · {appearance.bytes} bytes · unsupported</small></span>
                    <div className="appearance-package__actions">
                      <Button size="sm" variant="dark" icon="download" onClick={() => void exportLegacyAppearance(appearance.id)}>{t('profile.exportSelectedAppearance')}</Button>
                      <Button size="sm" variant="ghost" icon="delete" onClick={() => void deleteLegacyAppearance(appearance.id)}>{t('profile.deleteAppearance')}</Button>
                    </div>
                  </div>)}
                </div> : null}
              </div>
            </Panel>
          </aside>

          <main className="appearance-studio-preview-column">
            {AppearanceDevWorkbench ? <Suspense fallback={null}><AppearanceDevWorkbench /></Suspense> : null}
            <Panel variant="paper" padding="16px">
              <div className="appearance-preview" aria-label={t('profile.appearancePreview')}>
                <div className="appearance-preview__heading">
                  <div>
                    <p className="eyeline">390 × 844</p>
                    <h2>{t('profile.appearancePreview')}</h2>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedAppearanceId(appearanceSettings.appearanceId)}>
                    {t('profile.cancelAppearancePreview')}
                  </Button>
                </div>
                <p className="quiet">{t('profile.appearancePreviewStates')}</p>
                <AppearancePreview packageId={selectedAppearanceId} />
              </div>
            </Panel>
          </main>

          <aside className="appearance-studio-column appearance-studio-column--review">
            <Panel variant="dark" padding="16px">
              <div className="appearance-lab">
                <h2>{t('appearanceStudio.reviewAndSubmit')}</h2>
                <ol className="appearance-studio-steps" data-testid="appearance-submit-steps">
                  {submitSteps.map((step, index) => <li key={step}>{index + 1}. {step}</li>)}
                </ol>
                {selectedAppearance ? (
                  <dl className="appearance-metadata">
                    <div><dt>{t('profile.appearanceAuthor')}</dt><dd>{selectedAppearance.manifest.author}</dd></div>
                    <div><dt>{t('profile.appearanceLicense')}</dt><dd>{selectedAppearance.manifest.license}</dd></div>
                    <div><dt>{t('profile.appearanceCompatibility')}</dt><dd>{selectedAppearance.manifest.compatibility.minAppVersion} – {selectedAppearance.manifest.compatibility.maxAppVersion ?? '∞'}</dd></div>
                    <div><dt>{t('profile.appearanceAssets')}</dt><dd>{selectedAppearance.manifest.assets.length}</dd></div>
                  </dl>
                ) : null}
                {appearanceAudit ? (
                  <div
                    className={`appearance-audit ${appearanceAudit.valid ? 'appearance-audit--valid' : ''}`}
                    data-appearance-hook={appearanceAudit.valid ? 'toast' : 'error-state'}
                  >
                    <b>{appearanceAudit.valid ? t('profile.appearanceAuditPassed') : t('profile.appearanceAuditFailed')}</b>
                    {appearanceAudit.diagnostics.map((issue) => (
                      <p key={`${issue.code}-${issue.message}`}>{t('profile.appearanceIssue', { code: issue.code, message: issue.message })}</p>
                    ))}
                    <ul>
                      {Object.entries(appearanceAudit.checks).map(([check, status]) => (
                        <li key={check}>{t(`profile.appearanceChecks.${check}`)} · {t(`profile.appearanceCheckStatus.${status}`)}</li>
                      ))}
                    </ul>
                  </div>
                ) : <p className="quiet" data-appearance-hook="empty-state">{t('appearanceStudio.auditEmpty')}</p>}
                <label className="admin-file-button">
                  <span>{reviewFile ? reviewFile.name : t('appearanceStudio.selectReview')}</span>
                  <input type="file" accept=".netrin-review.json,application/json" hidden onChange={(event) => void importReview(event)} />
                </label>
                {reviewReport ? <p className="quiet">review SHA-256 · {reviewReport.packageSha256} · {t(reviewMatches ? 'appearanceStudio.reviewMatched' : 'appearanceStudio.reviewNotMatched')}</p> : null}
                <div className="appearance-studio-actions">
                  <Button variant="dark" icon="download" disabled={!selectedAppearance} onClick={() => void exportAppearance()}>
                    {t('profile.exportSelectedAppearance')}
                  </Button>
                  <Button
                    variant="solid"
                    icon="send"
                    disabled={!selectedAppearance || selectedAppearance.manifest.type !== 'skin' || !reviewFile || !reviewReport || !reviewMatches}
                    onClick={() => void submitSelectedAppearance()}
                  >
                    {user && !isAnonymous ? t('profile.submitAppearance') : t('appearanceStudio.signInToSubmit')}
                  </Button>
                </div>
                {notice ? <p className="save-message" role="status" data-appearance-hook="toast">{notice}</p> : null}
              </div>
            </Panel>

            <Panel variant="dark" padding="16px">
              <div className="appearance-lab">
                <h2>{t('profile.appearanceCatalog')}</h2>
                {catalogStatus === 'loading' ? <p className="quiet" role="status" data-appearance-hook="loading-state">{t('common.loading')}</p> : null}
                {catalogStatus === 'error' ? <div data-appearance-hook="error-state"><p className="form-error">{t('workshop.appearanceErrorHint')}</p><Button size="sm" variant="dark" icon="reload" onClick={() => void loadCloudAppearances()}>{t('workshop.retry')}</Button></div> : null}
                {appearanceCatalog.length ? (
                  <div className="appearance-cloud-list">
                    {appearanceCatalog.map((item) => (
                      <p key={item.id}>
                        <b>{item.displayName}</b>
                        <span>{item.packageVersion} · {item.declaredAuthor}</span>
                        {item.summary ? <small>{item.summary}</small> : null}
                        <Button size="sm" variant="dark" icon="download" onClick={() => void installCatalogAppearance(item)}>
                          {t('profile.installAppearance')}
                        </Button>
                      </p>
                    ))}
                  </div>
                ) : catalogStatus === 'empty' ? <p className="quiet" data-appearance-hook="empty-state">{t('appearanceStudio.catalogEmpty')}</p> : null}
              </div>
            </Panel>

            {user && !isAnonymous ? (
              <Panel variant="dark" padding="16px">
                <div className="appearance-lab">
                  <h2>{t('profile.cloudAppearanceSubmissions')}</h2>
                  {cloudAppearances.length ? (
                    <div className="appearance-cloud-list">
                      {cloudAppearances.map((submission) => (
                        <p key={submission.id}>
                          <b>{submission.displayName}</b>
                          <span>{submission.packageVersion} · {t(`moderation.${submission.status}`)}</span>
                          {submission.rejectionReason ? <small>{submission.rejectionReason}</small> : null}
                        </p>
                      ))}
                    </div>
                  ) : <p className="quiet" data-appearance-hook="empty-state">{t('appearanceStudio.submissionsEmpty')}</p>}
                </div>
              </Panel>
            ) : null}
          </aside>
        </div>
  )
}
