import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Button } from '../components/core/Button'
import { AmapNetrinMap } from '../components/domain/AmapNetrinMap'
import { TextField } from '../components/forms/TextField'
import { Panel } from '../components/surfaces/Panel'
import type {
  AiInputKind,
  AiProviderRequest,
  AnalyzeCandidate,
  AnalyzeResponse,
  PlanResponse,
  ProviderCapabilities,
  ProviderModelDescriptor,
  TravelMode
} from '../lib/ai-route/contracts'
import {
  AiRouteClientError,
  analyzeAiRoute,
  loadAiRouteProviders,
  loadProviderModelCatalog,
  probeCustomProvider,
  planAiRoute
} from '../lib/ai-route/client'
import {
  deleteCustomProviderPreset,
  loadCustomProviderPresets,
  saveCustomProviderPreset,
  type CustomProviderPreset
} from '../lib/ai-route/customProviderStore'
import { createAiRouteDraft } from '../lib/ai-route/draftAdapter'
import { aiRouteErrorMessageKey } from '../lib/ai-route/errors'
import { preprocessAiFiles, type FileProcessingProgress } from '../lib/ai-route/filePreprocess'
import { AiFileInputError } from '../lib/ai-route/fileValidation'
import '../lib/ai-route/i18n'
import {
  clearAllProviderSessionData,
  clearProviderSessionKey,
  loadProviderSessionKey,
  saveProviderSessionKey,
  type ProviderSessionIdentity
} from '../lib/ai-route/providerSession'
import { useNetrinState } from '../state/NetrinState'
import { moveAiCandidate, removeAiCandidate } from './aiRouteReview'

type Phase = 'input' | 'analyzing' | 'review' | 'planning' | 'planned'
type ProviderRegistryStatus = 'loading' | 'ready' | 'unavailable'

const DURATION_OPTIONS = ['30', '45', '60', '90', '120', '180', '240', '360', '480'] as const
const MAXIMUM_STOP_OPTIONS = ['2', '3', '4', '5', '6', '7', '8', '9', '10'] as const

export function AiRouteCreateScreen() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const auth = useAuth()
  const { addRouteDraft, appearanceSettings } = useNetrinState()
  const activeController = useRef<AbortController>()
  const [providers, setProviders] = useState<ProviderCapabilities[]>([])
  const [providerRegistryStatus, setProviderRegistryStatus] =
    useState<ProviderRegistryStatus>('loading')
  const [providerRetryKey, setProviderRetryKey] = useState(0)
  const [supportedInputKinds, setSupportedInputKinds] = useState<AiInputKind[]>(['prompt'])
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [providerModels, setProviderModels] = useState<ProviderModelDescriptor[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [customProviderEnabled, setCustomProviderEnabled] = useState(false)
  const [customPresets, setCustomPresets] = useState<CustomProviderPreset[]>([])
  const [customPresetId, setCustomPresetId] = useState('')
  const [customName, setCustomName] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customAcknowledged, setCustomAcknowledged] = useState(false)
  const [capabilityToken, setCapabilityToken] = useState('')
  const [prompt, setPrompt] = useState('')
  const [inputKind, setInputKind] = useState<AiInputKind>('prompt')
  const [files, setFiles] = useState<File[]>([])
  const [fileProgress, setFileProgress] = useState<FileProcessingProgress>()
  const [fileWarnings, setFileWarnings] = useState<string[]>([])
  const [region, setRegion] = useState('')
  const [travelMode, setTravelMode] = useState<TravelMode>('walking')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [maximumStops, setMaximumStops] = useState('')
  const [roundTrip, setRoundTrip] = useState(false)
  const [mustInclude, setMustInclude] = useState('')
  const [avoid, setAvoid] = useState('')
  const [preferences, setPreferences] = useState('')
  const [phase, setPhase] = useState<Phase>('input')
  const [errorCode, setErrorCode] = useState('')
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResponse>()
  const [candidates, setCandidates] = useState<AnalyzeCandidate[]>([])
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [planResult, setPlanResult] = useState<PlanResponse>()

  useEffect(() => {
    const controller = new AbortController()
    setProviderRegistryStatus('loading')
    setErrorCode('')
    void loadAiRouteProviders(controller.signal)
      .then(async (result) => {
        const first = result.providers[0]
        const storedKey = first
          ? await loadProviderSessionKey({ providerId: first.providerId })
          : ''
        if (controller.signal.aborted) return
        setProviders(result.providers)
        setCustomProviderEnabled(result.customProviderPolicy?.enabled === true)
        setSupportedInputKinds(result.supportedInputKinds)
        setInputKind((current) => result.supportedInputKinds.includes(current) ? current : 'prompt')
        const hasFixedProvider = result.providers.some((item) =>
          item.toolCalling && item.allowedModelIds.length > 0
        )
        if (!hasFixedProvider && result.customProviderPolicy?.enabled !== true) {
          setProviderRegistryStatus('unavailable')
          return
        }
        if (first) {
          setProviderId(first.providerId)
          setModelId(first.allowedModelIds[0] ?? '')
          setApiKey(storedKey)
        } else if (result.customProviderPolicy?.enabled) {
          setProviderId('custom-openai')
        }
        setProviderRegistryStatus('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setProviderRegistryStatus('unavailable')
      })
    return () => controller.abort()
  }, [providerRetryKey])

  useEffect(() => {
    let active = true
    void loadCustomProviderPresets().then((items) => {
      if (active) setCustomPresets(items)
    })
    return () => { active = false }
  }, [])

  useEffect(() => () => activeController.current?.abort(), [])

  const provider = providers.find((item) => item.providerId === providerId)
  const providerIdentity = useMemo<ProviderSessionIdentity>(() => ({
    providerId,
    ...(providerId === 'custom-openai' ? { baseUrl: customBaseUrl.trim() } : {})
  }), [customBaseUrl, providerId])
  const customAsciiHost = useMemo(() => {
    try { return new URL(customBaseUrl.trim()).hostname }
    catch { return '' }
  }, [customBaseUrl])

  useEffect(() => {
    if (!providerId) return
    let active = true
    setCapabilityToken('')
    const identity: ProviderSessionIdentity = {
      providerId,
      ...(providerId === 'custom-openai' ? { baseUrl: customBaseUrl.trim() } : {})
    }
    void loadProviderSessionKey(identity).then((storedKey) => {
      if (!active) return
      setApiKey(storedKey)
    })
    return () => { active = false }
  }, [customBaseUrl, providerId])

  const selectedOptions = useMemo(() => candidates.flatMap((candidate) => {
    const option = candidate.options.find((item) => item.optionRef === selections[candidate.candidateId])
    return option ? [{ candidate, option }] : []
  }), [candidates, selections])
  const previewRoute = planResult?.geometryCandidate?.coordinates ??
    selectedOptions.map(({ option }) => option.wgs84)
  const previewStops = planResult
    ? planResult.stops.map((stop, index) => ({
        id: stop.candidateId,
        location: stop.wgs84,
        index: index + 1,
        label: stop.name
      }))
    : selectedOptions.map(({ candidate, option }, index) => ({
        id: candidate.candidateId,
        location: option.wgs84,
        index: index + 1,
        label: option.poiName
      }))

  const fail = (error: unknown) => {
    if (error instanceof AiRouteClientError) {
      setErrorCode(error.code)
      if (['AI_AUTH_REQUIRED', 'AI_ACCOUNT_UNAVAILABLE', 'AI_PROVIDER_AUTH_FAILED'].includes(error.code)) {
        setApiKey('')
        setCapabilityToken('')
        void clearProviderSessionKey(providerIdentity)
      }
    }
    else if (error instanceof AiFileInputError) setErrorCode(error.code)
    else if (error instanceof DOMException && error.name === 'AbortError') setErrorCode('AI_ABORTED')
    else setErrorCode('AI_INTERNAL_ERROR')
  }

  const updateApiKey = (next: string) => {
    setApiKey(next)
    void saveProviderSessionKey(providerIdentity, next)
    if (providerId === 'custom-openai') {
      setCapabilityToken('')
    }
  }

  const invalidateCustomProbe = () => {
    setCapabilityToken('')
  }

  const discoverCustomModels = async () => {
    if (!auth.session?.access_token || !customBaseUrl.trim() || !apiKey) {
      return setErrorCode('AI_REQUEST_INVALID')
    }
    const controller = new AbortController()
    setCatalogLoading(true)
    setErrorCode('')
    try {
      const result = await loadProviderModelCatalog({
        providerId: 'custom-openai',
        baseUrl: customBaseUrl.trim(),
        apiKey
      }, auth.session.access_token, controller.signal)
      setProviderModels(result.models)
      if (!modelId && result.models[0]) setModelId(result.models[0].modelId)
    } catch (error) {
      fail(error)
    } finally {
      setCatalogLoading(false)
    }
  }

  const testCustomProvider = async () => {
    if (!auth.session?.access_token || !customBaseUrl.trim() || !modelId.trim() || !apiKey) {
      return setErrorCode('AI_REQUEST_INVALID')
    }
    const controller = new AbortController()
    setCatalogLoading(true)
    setErrorCode('')
    try {
      const result = await probeCustomProvider({
        providerId: 'custom-openai',
        baseUrl: customBaseUrl.trim(),
        modelId: modelId.trim(),
        apiKey
      }, auth.session.access_token, controller.signal)
      setCapabilityToken(result.capabilityToken)
    } catch (error) {
      fail(error)
    } finally {
      setCatalogLoading(false)
    }
  }

  const saveCurrentCustomPreset = async () => {
    if (!customName.trim() || !customBaseUrl.trim()) return setErrorCode('AI_REQUEST_INVALID')
    const id = customPresetId || crypto.randomUUID()
    const next = await saveCustomProviderPreset({
      id,
      name: customName,
      baseUrl: customBaseUrl,
      modelId
    })
    setCustomPresetId(id)
    setCustomPresets(next)
  }

  const parseTerms = (value: string) => [...new Set(value
    .normalize('NFC')
    .split(/[\n,，]/)
    .map((term) => term.trim().slice(0, 240))
    .filter(Boolean))]

  const warningMessage = (warning: string) => {
    const separator = warning.indexOf(':')
    const code = separator >= 0 ? warning.slice(0, separator) : warning
    const rawDetail = separator >= 0 ? warning.slice(separator + 1) : ''
    const detail = code === 'TIME_BUDGET_EXCEEDED_OPTIONAL'
      ? rawDetail.split(',').map((candidateId) =>
          candidates.find((candidate) => candidate.candidateId === candidateId)
            ?.placeIntent.desiredName ?? candidateId
        ).join(i18n.resolvedLanguage === 'en' ? ', ' : '、')
      : rawDetail
    const keys: Record<string, string> = {
      AVOID_FILTERED: 'avoidFiltered',
      REQUIRED_AVOID_CONFLICT: 'requiredAvoidConflict',
      MUST_INCLUDE_MISSING: 'mustIncludeMissing',
      TIME_BUDGET_EXCEEDED: 'timeBudgetExceeded',
      TIME_BUDGET_EXCEEDED_OPTIONAL: 'timeBudgetExceededOptional',
      AI_ROUTE_UNREACHABLE: 'routeUnavailable',
      AI_ROUTE_PROVIDER_UNAVAILABLE: 'routeUnavailable'
    }
    const key = keys[code]
    return key ? t(`aiRoute.warnings.${key}`, { detail }) : warning
  }

  const analyze = async () => {
    if (!auth.session?.access_token) return setErrorCode('AI_AUTH_REQUIRED')
    if (!auth.user?.phone_confirmed_at) return setErrorCode('AI_PHONE_VERIFICATION_REQUIRED')
    const normalizedRegion = region.normalize('NFC').trim().slice(0, 80)
    if (!normalizedRegion || !providerId || !modelId || !apiKey) {
      return setErrorCode('AI_REQUEST_INVALID')
    }
    if (providerId === 'custom-openai' &&
        (!customProviderEnabled || !customBaseUrl.trim() || !capabilityToken || !customAcknowledged)) {
      return setErrorCode(!capabilityToken ? 'AI_MODEL_PROBE_REQUIRED' : 'AI_REQUEST_INVALID')
    }
    if (providerId !== 'custom-openai' && !provider) {
      return setErrorCode('AI_REQUEST_INVALID')
    }
    if (inputKind === 'prompt' && !prompt.normalize('NFC').trim()) return setErrorCode('AI_REQUEST_INVALID')
    if (inputKind === 'file' && !files.length) return setErrorCode('AI_REQUEST_INVALID')
    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller
    setPhase('analyzing')
    setErrorCode('')
    setPlanResult(undefined)
    setFileProgress(undefined)
    try {
      const parsedDuration = Number(durationMinutes)
      const locale = i18n.resolvedLanguage === 'en' ? 'en' as const : 'zh-CN' as const
      const processed = inputKind === 'file'
        ? await preprocessAiFiles(files, {
            signal: controller.signal,
            onProgress: setFileProgress
          })
        : undefined
      setFileWarnings(processed?.warnings ?? [])
      const input = inputKind === 'prompt'
        ? { kind: 'prompt' as const, text: prompt.normalize('NFC').trim().slice(0, 20_000) }
        : {
            kind: 'file' as const,
            extractedText: processed?.extractedText ?? '',
            sourceFiles: processed?.sourceFiles ?? []
          }
      const providerRequest: AiProviderRequest = providerId === 'custom-openai'
          ? {
              providerId: 'custom-openai',
              modelId: modelId.trim(),
              apiKey,
              baseUrl: customBaseUrl.trim(),
              capabilityToken
            }
          : {
              providerId: providerId as 'deepseek-cn' | 'qwen-cn' | 'kimi-cn',
              modelId,
              apiKey
            }
      const result = await analyzeAiRoute({
        provider: providerRequest,
        input,
        constraints: {
          region: normalizedRegion,
          travelMode,
          ...(Number.isFinite(parsedDuration) && parsedDuration >= 15
            ? { durationMinutes: Math.min(1_440, parsedDuration) }
            : {}),
          maximumStops: Math.max(2, Math.min(10, Number(maximumStops) || 6)),
          roundTrip,
          ...(parseTerms(mustInclude).length ? { mustInclude: parseTerms(mustInclude) } : {}),
          ...(parseTerms(avoid).length ? { avoid: parseTerms(avoid) } : {}),
          ...(parseTerms(preferences).length ? { preferences: parseTerms(preferences) } : {})
        },
        locale
      }, auth.session.access_token, controller.signal)
      setFiles([])
      setFileProgress(undefined)
      setAnalyzeResult(result)
      setCandidates(result.proposedOrder.flatMap((candidateId) => {
        const candidate = result.candidates.find((item) => item.candidateId === candidateId)
        return candidate ? [candidate] : []
      }))
      setSelections(Object.fromEntries(result.candidates.flatMap((candidate) => {
        const selected = candidate.selectedOptionRef ?? candidate.options[0]?.optionRef
        return selected ? [[candidate.candidateId, selected]] : []
      })))
      setPhase('review')
    } catch (error) {
      setPhase('input')
      fail(error)
    }
  }

  const plan = async () => {
    if (!analyzeResult || !auth.session?.access_token ||
        candidates.some((candidate) => !selections[candidate.candidateId])) {
      return setErrorCode('AI_REQUEST_INVALID')
    }
    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller
    setPhase('planning')
    setErrorCode('')
    try {
      const result = await planAiRoute({
        analyzeRequestId: analyzeResult.requestId,
        constraints: analyzeResult.normalizedConstraints,
        selectedStops: candidates.map((candidate, index) => ({
          candidateId: candidate.candidateId,
          optionRef: selections[candidate.candidateId],
          intent: {
            reason: candidate.placeIntent.reason,
            priority: candidate.placeIntent.priority
          },
          userLockedOrder: index,
          ...(candidate.placeIntent.estimatedStayMinutes !== undefined
            ? { estimatedStayMinutes: candidate.placeIntent.estimatedStayMinutes }
            : {})
        })),
        proposedOrder: candidates.map((candidate) => candidate.candidateId)
      }, auth.session.access_token, controller.signal)
      setPlanResult(result)
      setPhase('planned')
    } catch (error) {
      setPhase('review')
      fail(error)
    }
  }

  const cancel = () => {
    activeController.current?.abort()
    setFiles([])
    setFileProgress(undefined)
    setFileWarnings([])
    setPhase(analyzeResult ? 'review' : 'input')
  }

  const createDraft = (confirmGeometry: boolean) => {
    if (!analyzeResult || !planResult) return
    const firstSource = analyzeResult.inputSummary?.sourceRefs[0]
    const generatedTitle = inputKind === 'prompt'
      ? prompt.trim().slice(0, 80)
      : firstSource?.kind === 'file'
        ? firstSource.displayName.replace(/\.[^.]+$/, '').slice(0, 80)
        : ''
    const id = `draft-ai-${Date.now()}`
    addRouteDraft(createAiRouteDraft({
      draftId: id,
      title: generatedTitle || t('aiRoute.defaultTitle'),
      analyze: { ...analyzeResult, candidates },
      plan: planResult,
      confirmGeometry,
      now: new Date().toISOString()
    }))
    navigate(`/create/${id}`)
  }

  if (providerRegistryStatus !== 'ready') {
    return (
      <section className="screen ai-route-screen" data-appearance-state={providerRegistryStatus}>
        <header className="screen-head-row">
          <Button size="sm" variant="ghost" icon="arrow-left" onClick={() => navigate('/create')}>
            {t('record.backToCreate')}
          </Button>
          <h1>{t('aiRoute.title')}</h1>
        </header>
        <Panel variant="dark" padding="14px">
          <div className="stack">
            <p className="quiet">
              {t(providerRegistryStatus === 'loading'
                ? 'aiRoute.loadingProviders'
                : 'aiRoute.unavailable')}
            </p>
            {providerRegistryStatus === 'unavailable' ? (
              <Button block variant="dark" onClick={() => setProviderRetryKey((value) => value + 1)}>
                {t('aiRoute.retryProviders')}
              </Button>
            ) : null}
          </div>
        </Panel>
      </section>
    )
  }

  return (
    <section className="screen ai-route-screen" data-appearance-state={phase}>
      <header className="screen-head-row">
        <Button size="sm" variant="ghost" icon="arrow-left" onClick={() => navigate('/create')}>
          {t('record.backToCreate')}
        </Button>
        <h1>{t('aiRoute.title')}</h1>
      </header>

      {!auth.session ? (
        <Panel variant="dark" padding="14px">
          <div className="stack">
            <b>{t('aiRoute.authTitle')}</b>
            <p className="quiet">{t('aiRoute.authHint')}</p>
            <Button block icon="login" onClick={() => navigate('/auth')}>{t('aiRoute.signIn')}</Button>
          </div>
        </Panel>
      ) : null}

      {phase === 'input' || phase === 'analyzing' ? (
        <Panel variant="dark" padding="14px">
          <div className="stack">
            {supportedInputKinds.length > 1 ? (
              <div role="tablist" aria-label={t('aiRoute.inputModeLabel')}
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))', gap: 6 }}>
                {supportedInputKinds.map((kind) => (
                  <Button key={kind} role="tab" aria-selected={inputKind === kind} block
                    variant={inputKind === kind ? 'solid' : 'dark'} disabled={phase === 'analyzing'}
                    onClick={() => { setInputKind(kind); setErrorCode(''); setFileProgress(undefined) }}>
                    {t(`aiRoute.inputKinds.${kind}`)}
                  </Button>
                ))}
              </div>
            ) : null}
            {inputKind === 'prompt' ? (
              <TextField label={t('aiRoute.promptLabel')} value={prompt} onChange={setPrompt}
                placeholder={t('aiRoute.promptPlaceholder')} multiline rows={5} maxLength={20_000}
                disabled={phase === 'analyzing'} />
            ) : null}
            {inputKind === 'file' ? (
              <fieldset className="nfield" disabled={phase === 'analyzing'}
                style={{ minWidth: 0, padding: 12, border: '2px solid var(--line-ink)', borderRadius: 'var(--radius-md)' }}>
                <legend>{t('aiRoute.fileLabel')}</legend>
                <input type="file" multiple
                  accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                  onChange={(event) => {
                    setFiles(Array.from(event.target.files ?? []))
                    setFileProgress(undefined)
                    setFileWarnings([])
                    setErrorCode('')
                  }} />
                <p className="quiet">{t('aiRoute.fileHint')}</p>
                {files.length ? (
                  <ul style={{ maxHeight: 132, overflow: 'auto', overflowWrap: 'anywhere' }}>
                    {files.map((file) => <li key={`${file.name}-${file.lastModified}`}>{file.name}</li>)}
                  </ul>
                ) : null}
              </fieldset>
            ) : null}
            {fileProgress ? (
              <div className="stack" aria-live="polite">
                <progress max={Math.max(1, fileProgress.total)} value={fileProgress.completed}
                  style={{ width: '100%', accentColor: 'var(--signal-green)' }} />
                <span>{t(`aiRoute.progress.${fileProgress.stage}`)}{fileProgress.fileName ? ` · ${fileProgress.fileName}` : ''}</span>
              </div>
            ) : null}
            {fileWarnings.map((warning) => (
              <p className="quiet" key={warning}>{t('aiRoute.fileImagePagesIgnored', {
                count: Number(warning.split(':')[1] ?? 0)
              })}</p>
            ))}
            <TextField label={t('aiRoute.regionLabel')} value={region} onChange={setRegion}
              placeholder={t('aiRoute.regionPlaceholder')} maxLength={80} disabled={phase === 'analyzing'} />
            <div className="ai-route-grid">
              <label className="nfield">
                <span className="nfield__label">{t('aiRoute.travelMode')}</span>
                <select value={travelMode} onChange={(event) => setTravelMode(event.target.value as TravelMode)}>
                  <option value="walking">{t('record.walkingMode')}</option>
                  <option value="cycling">{t('record.cyclingMode')}</option>
                </select>
              </label>
              <label className="nfield">
                <span className="nfield__label">{t('aiRoute.durationLabel')}</span>
                <select value={durationMinutes} disabled={phase === 'analyzing'}
                  onChange={(event) => setDurationMinutes(event.target.value)}>
                  <option value="">{t('aiRoute.autoOption')}</option>
                  {DURATION_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>{minutes}</option>
                  ))}
                </select>
              </label>
              <label className="nfield">
                <span className="nfield__label">{t('aiRoute.maximumStopsLabel')}</span>
                <select value={maximumStops} disabled={phase === 'analyzing'}
                  onChange={(event) => setMaximumStops(event.target.value)}>
                  <option value="">{t('aiRoute.autoOption')}</option>
                  {MAXIMUM_STOP_OPTIONS.map((stops) => (
                    <option key={stops} value={stops}>{stops}</option>
                  ))}
                </select>
              </label>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
              <input type="checkbox" checked={roundTrip} disabled={phase === 'analyzing'}
                style={{ width: 22, height: 22, accentColor: 'var(--signal-green)' }}
                onChange={(event) => setRoundTrip(event.target.checked)} />
              <span>{t('aiRoute.roundTripLabel')}</span>
            </label>
            <TextField label={t('aiRoute.mustIncludeLabel')} value={mustInclude} onChange={setMustInclude}
              placeholder={t('aiRoute.listPlaceholder')} multiline rows={2} maxLength={2_000}
              disabled={phase === 'analyzing'} />
            <TextField label={t('aiRoute.avoidLabel')} value={avoid} onChange={setAvoid}
              placeholder={t('aiRoute.listPlaceholder')} multiline rows={2} maxLength={2_000}
              disabled={phase === 'analyzing'} />
            <TextField label={t('aiRoute.preferencesLabel')} value={preferences} onChange={setPreferences}
              placeholder={t('aiRoute.listPlaceholder')} multiline rows={2} maxLength={2_000}
              disabled={phase === 'analyzing'} />
            <label className="nfield">
              <span className="nfield__label">{t('aiRoute.providerLabel')}</span>
              <select value={providerId} disabled={phase === 'analyzing'} onChange={(event) => {
                const nextId = event.target.value
                const next = providers.find((item) => item.providerId === nextId)
                invalidateCustomProbe()
                setApiKey('')
                setProviderId(nextId)
                setProviderModels([])
                setCustomAcknowledged(false)
                if (nextId === 'custom-openai') {
                  const preset = customPresets[0]
                  setCustomPresetId(preset?.id ?? '')
                  setCustomName(preset?.name ?? '')
                  setCustomBaseUrl(preset?.baseUrl ?? '')
                  setModelId(preset?.modelId ?? '')
                } else {
                  setModelId(next?.allowedModelIds[0] ?? '')
                }
              }}>
                {providers.map((item) => (
                  <option key={item.providerId} value={item.providerId}>{item.displayName}</option>
                ))}
                {customProviderEnabled ? (
                  <option value="custom-openai">{t('aiRoute.customProvider.option')}</option>
                ) : null}
              </select>
            </label>
            {providerId === 'custom-openai' ? (
              <fieldset className="nfield" disabled={phase === 'analyzing'}
                style={{ minWidth: 0, padding: 12, border: '2px solid var(--line-ink)', borderRadius: 'var(--radius-md)' }}>
                <legend>{t('aiRoute.customProvider.title')}</legend>
                <div className="stack">
                  <label className="nfield">
                    <span className="nfield__label">{t('aiRoute.customProvider.saved')}</span>
                    <select value={customPresetId} onChange={(event) => {
                      const preset = customPresets.find((item) => item.id === event.target.value)
                      invalidateCustomProbe()
                      setApiKey('')
                      setProviderModels([])
                      setCustomAcknowledged(false)
                      setCustomPresetId(event.target.value)
                      setCustomName(preset?.name ?? '')
                      setCustomBaseUrl(preset?.baseUrl ?? '')
                      setModelId(preset?.modelId ?? '')
                    }}>
                      <option value="">{t('aiRoute.customProvider.newPreset')}</option>
                      {customPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                    </select>
                  </label>
                  <TextField label={t('aiRoute.customProvider.name')} value={customName}
                    onChange={setCustomName} maxLength={80} />
                  <TextField label={t('aiRoute.customProvider.baseUrl')} value={customBaseUrl}
                    onChange={(next) => {
                      invalidateCustomProbe()
                      setApiKey('')
                      setCustomBaseUrl(next)
                      setProviderModels([])
                      setCustomAcknowledged(false)
                    }} placeholder="https://llm.example.com/v1" type="url" maxLength={512} />
                  {customAsciiHost ? (
                    <p className="quiet">{t('aiRoute.customProvider.asciiHost', { host: customAsciiHost })}</p>
                  ) : null}
                  <TextField label={t('aiRoute.apiKeyLabel')} value={apiKey} onChange={updateApiKey}
                    type="password" autoComplete="off" maxLength={4_096} />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <Button size="sm" variant="dark" disabled={catalogLoading || !apiKey}
                      onClick={() => void discoverCustomModels()}>
                      {t('aiRoute.customProvider.discover')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void saveCurrentCustomPreset()}>
                      {t('aiRoute.customProvider.save')}
                    </Button>
                    {customPresetId ? (
                      <Button size="sm" variant="ghost" onClick={() => void deleteCustomProviderPreset(customPresetId)
                        .then((next) => {
                          setCustomPresets(next)
                          setCustomPresetId('')
                        })}>
                        {t('aiRoute.customProvider.delete')}
                      </Button>
                    ) : null}
                  </div>
                  {providerModels.length ? (
                    <label className="nfield">
                      <span className="nfield__label">{t('aiRoute.customProvider.discoveredModels')}</span>
                      <select value={providerModels.some((model) => model.modelId === modelId) ? modelId : ''}
                        onChange={(event) => {
                          invalidateCustomProbe()
                          setModelId(event.target.value)
                        }}>
                        <option value="">{t('aiRoute.customProvider.manualModel')}</option>
                        {providerModels.map((model) => (
                          <option key={model.modelId} value={model.modelId}>{model.displayName}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <TextField label={t('aiRoute.customProvider.modelId')} value={modelId}
                    onChange={(next) => {
                      invalidateCustomProbe()
                      setModelId(next)
                    }} maxLength={200} />
                  <Button block variant={capabilityToken ? 'dark' : 'solid'} disabled={catalogLoading || !apiKey}
                    onClick={() => void testCustomProvider()}>
                    {capabilityToken
                      ? t('aiRoute.customProvider.probePassed')
                      : t('aiRoute.customProvider.probe')}
                  </Button>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 44 }}>
                    <input type="checkbox" checked={customAcknowledged}
                      onChange={(event) => setCustomAcknowledged(event.target.checked)} />
                    <span>{t('aiRoute.customProvider.confirmHost', { host: customAsciiHost || customBaseUrl })}</span>
                  </label>
                  <p className="quiet">{t('aiRoute.customProvider.policy')}</p>
                </div>
              </fieldset>
            ) : (
              <label className="nfield">
                <span className="nfield__label">{t('aiRoute.modelLabel')}</span>
                <select value={modelId} disabled={phase === 'analyzing'}
                  onChange={(event) => setModelId(event.target.value)}>
                  {(provider?.allowedModelIds ?? []).map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </label>
            )}
            {providerId !== 'custom-openai' ? (
              <TextField label={t('aiRoute.apiKeyLabel')} value={apiKey} onChange={updateApiKey}
                type="password" autoComplete="off" maxLength={4_096} disabled={phase === 'analyzing'} />
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Button size="sm" variant="ghost" disabled={!apiKey} onClick={() => {
                setApiKey('')
                setCapabilityToken('')
                void clearProviderSessionKey(providerIdentity)
              }}>{t('aiRoute.clearCurrentKey')}</Button>
              <Button size="sm" variant="ghost" onClick={() => {
                clearAllProviderSessionData()
                setApiKey('')
                setCapabilityToken('')
              }}>{t('aiRoute.clearAllKeys')}</Button>
            </div>
            {phase === 'analyzing' ? (
              <Button block variant="dark" icon="close" onClick={cancel}>{t('common.cancel')}</Button>
            ) : (
              <Button block icon="zap" disabled={!auth.session || (!providers.length && !customProviderEnabled)}
                onClick={() => void analyze()}>{t('aiRoute.analyzeAction')}</Button>
            )}
          </div>
        </Panel>
      ) : null}

      {phase === 'review' || phase === 'planning' ? (
        <>
          <Panel variant="paper" shadow padding="0" style={{ overflow: 'hidden' }}>
            <div className="ai-route-map">
              <AmapNetrinMap route={previewRoute} stops={previewStops} framed interactive
                label={t('aiRoute.previewLabel')} mapStyleId={appearanceSettings.mapStyleId} />
            </div>
          </Panel>
          <div className="stack">
            <div><h2 className="section-title">{t('aiRoute.reviewTitle')}</h2>
              <p className="quiet">{t('aiRoute.reviewHint')}</p></div>
            {candidates.map((candidate, index) => (
              <Panel key={candidate.candidateId} variant="dark" padding="12px">
                <div className="ai-candidate">
                  <div className="ai-candidate__number">{index + 1}</div>
                  <div className="ai-candidate__body">
                    <b>{candidate.placeIntent.desiredName}</b>
                    <p className="quiet">{candidate.placeIntent.reason}</p>
                    <label className="nfield">
                      <span className="nfield__label">
                        {candidate.requiresUserChoice ? t('aiRoute.choosePlace') : t('aiRoute.confirmedPoi')}
                      </span>
                      <select value={selections[candidate.candidateId] ?? ''} onChange={(event) =>
                        setSelections((current) => ({ ...current, [candidate.candidateId]: event.target.value }))
                      }>
                        {candidate.options.map((option) => (
                          <option key={option.optionRef} value={option.optionRef}>
                            {[option.poiName, option.district, option.displayAddress].filter(Boolean).join(' · ')}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="ai-candidate__actions">
                      <Button size="sm" variant="ghost" icon="arrow-up" disabled={index === 0}
                        aria-label={t('record.moveUp')}
                        onClick={() => setCandidates((current) => moveAiCandidate(current, index, index - 1))} />
                      <Button size="sm" variant="ghost" icon="chevron-down"
                        disabled={index === candidates.length - 1} aria-label={t('record.moveDown')}
                        onClick={() => setCandidates((current) => moveAiCandidate(current, index, index + 1))} />
                      <Button size="sm" variant="ghost" icon="delete" disabled={candidates.length <= 2}
                        aria-label={t('aiRoute.removePlace')}
                        onClick={() => setCandidates((current) =>
                          removeAiCandidate(current, candidate.candidateId)
                        )} />
                    </div>
                  </div>
                </div>
              </Panel>
            ))}
            {analyzeResult?.warnings.map((warning) => (
              <p className="form-error" key={warning}>
                {t('aiRoute.warning', { warning: warningMessage(warning) })}
              </p>
            ))}
            {phase === 'planning' ? (
              <Button block variant="dark" icon="close" onClick={cancel}>{t('common.cancel')}</Button>
            ) : (
              <Button block icon="directions" onClick={() => void plan()}>{t('aiRoute.planAction')}</Button>
            )}
          </div>
        </>
      ) : null}

      {phase === 'planned' && planResult && analyzeResult ? (
        <>
          <Panel variant="paper" shadow padding="0" style={{ overflow: 'hidden' }}>
            <div className="ai-route-map">
              <AmapNetrinMap route={previewRoute} stops={previewStops} framed interactive
                label={t('aiRoute.previewLabel')} mapStyleId={appearanceSettings.mapStyleId} />
            </div>
          </Panel>
          <Panel variant="dark" padding="14px">
            <div className="stack">
              <h2 className="section-title">{t('aiRoute.planReadyTitle')}</h2>
              <p className="quiet">{t('aiRoute.planSummary', {
                stops: planResult.stops.length,
                distance: Math.round(planResult.distanceMeters ?? 0),
                minutes: Math.round(planResult.totalEstimatedMinutes ?? 0)
              })}</p>
              {planResult.warnings.map((warning) => (
                <p className="form-error" key={warning}>
                  {t('aiRoute.warning', { warning: warningMessage(warning) })}
                </p>
              ))}
              <Button variant="dark" block icon="arrow-left" onClick={() => {
                setPlanResult(undefined)
                setPhase('review')
              }}>
                {t('aiRoute.editPlaces')}
              </Button>
              {planResult.canConfirmGeometry ? (
                <Button block icon="check" onClick={() => createDraft(true)}>
                  {t('aiRoute.confirmAndEdit')}
                </Button>
              ) : (
                <Button block icon="check" onClick={() => createDraft(false)}>
                  {t('aiRoute.savePointsAndEdit')}
                </Button>
              )}
            </div>
          </Panel>
        </>
      ) : null}

      {errorCode ? <p className="form-error" role="alert">
        {t(`aiRoute.errors.${aiRouteErrorMessageKey(errorCode)}`)}
      </p> : null}
    </section>
  )
}
