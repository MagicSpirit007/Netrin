import { createEmptyRouteDraft } from '../../data/drafts'
import type {
  AiGenerationProvenance,
  RouteDraft
} from '../../data/types'
import type {
  AnalyzeResponse,
  PlanResponse
} from './contracts'

export type AiDraftAdapterInput = {
  draftId: string
  title: string
  analyze: AnalyzeResponse
  plan: PlanResponse
  confirmGeometry: boolean
  now?: string
}

export function createAiRouteDraft(input: AiDraftAdapterInput): RouteDraft {
  const now = input.now ?? new Date().toISOString()
  const canConfirm = input.confirmGeometry &&
    input.plan.canConfirmGeometry &&
    input.plan.geometrySource === 'amap-planned' &&
    Boolean(input.plan.geometryCandidate)
  const summary = input.analyze.inputSummary ?? { kind: 'prompt' as const, sourceRefs: [] }
  const provenance: AiGenerationProvenance = {
    inputKind: summary.kind,
    generatedAt: now,
    sourceRefs: summary.sourceRefs.flatMap((source): AiGenerationProvenance['sourceRefs'] => {
      return [{ kind: 'file-name', label: source.displayName.slice(0, 160) }]
    }),
    candidateCount: input.analyze.candidates.length,
    ambiguityCount: input.analyze.candidates.filter((candidate) => candidate.requiresUserChoice).length,
    harnessVersion: input.analyze.harnessVersion,
    promptVersion: input.analyze.promptVersion
  }
  const base = createEmptyRouteDraft({
    id: input.draftId,
    authoringMode: 'ai',
    title: input.title.trim().slice(0, 160),
    snapToRoads: false,
    now
  })
  const geometryCandidate = input.plan.geometryCandidate && input.plan.geometrySource === 'amap-planned'
    ? {
        geometry: input.plan.geometryCandidate,
        source: 'amap-planned' as const,
        distanceM: input.plan.distanceMeters,
        durationS: input.plan.walkingOrCyclingMinutes === undefined
          ? undefined
          : input.plan.walkingOrCyclingMinutes * 60,
        generatedAt: now
      }
    : undefined
  return {
    ...base,
    points: input.plan.stops.map((stop, index) => ({
      id: `${input.draftId}-point-${index + 1}`,
      index: index + 1,
      raw: [stop.wgs84[0], stop.wgs84[1]],
      final: [stop.wgs84[0], stop.wgs84[1]],
      snapped: false,
      text: stop.reason.slice(0, 500),
      highlightTitle: stop.name.slice(0, 160),
      ...(stop.category ? { category: stop.category.slice(0, 160) } : {}),
      media: []
    })),
    travelMode: input.analyze.normalizedConstraints.travelMode,
    geometryStatus: canConfirm ? 'confirmed' : 'pending',
    geometryCandidate,
    ...(canConfirm ? {
      geometry: input.plan.geometryCandidate,
      geometrySource: 'amap-planned' as const
    } : {}),
    distanceM: input.plan.distanceMeters,
    durationS: input.plan.walkingOrCyclingMinutes === undefined
      ? undefined
      : input.plan.walkingOrCyclingMinutes * 60,
    metricsUpdatedAt: input.plan.geometryCandidate ? now : undefined,
    isLoop: input.analyze.normalizedConstraints.roundTrip,
    cityName: input.analyze.normalizedConstraints.region,
    aiProvenance: provenance
  }
}
