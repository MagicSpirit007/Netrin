import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import type {
  AiRouteConstraints,
  AnalyzeCandidate,
  PlaceIntent
} from '../contracts/aiRoute.js'
import {
  AI_ROUTE_HARNESS_VERSION,
  AI_ROUTE_PROMPT_VERSION
} from '../contracts/aiRoute.js'
import { AiRouteError } from '../errors.js'
import type { PiRuntime } from '../providers/piAdapter.js'
import { mapPiFailure } from '../providers/piAdapter.js'
import type { PoiProvider } from '../tools/amapPoi.js'
import { createOptionRef } from '../tools/optionRefs.js'
import { DEFAULT_ROUTE_AGENT_LIMITS, RouteAgentBudget } from './budgets.js'
import { RouteAgentStateMachine } from './stateMachine.js'
import {
  buildRouteSystemPrompt,
  routeSubmissionRepairPrompt,
  wrapUntrustedSource
} from './systemPrompt.js'
import { parseSubmittedRoutePlan, type SubmittedRoutePlan } from './validators.js'

const TOOL_NAMES = new Set(['search_pois', 'get_poi_details', 'submit_route_plan'])

const searchSchema = Type.Object({
  queries: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
    minItems: 1,
    maxItems: 10
  })
}, { additionalProperties: false })

const detailSchema = Type.Object({
  poiRef: Type.String({ minLength: 1, maxLength: 120 })
}, { additionalProperties: false })

const submitSchema = Type.Object({
  places: Type.Array(Type.Object({
    desiredName: Type.String({ minLength: 1, maxLength: 160 }),
    poiRefs: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
      minItems: 1,
      maxItems: 5
    }),
    aliases: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 20 })),
    categoryHint: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    priority: Type.Optional(Type.Union([
      Type.Literal('required'),
      Type.Literal('preferred'),
      Type.Literal('optional')
    ])),
    estimatedStayMinutes: Type.Optional(Type.Integer({ minimum: 0, maximum: 720 })),
    preferredPeriod: Type.Optional(Type.Union([
      Type.Literal('morning'),
      Type.Literal('afternoon'),
      Type.Literal('evening')
    ]))
  }, { additionalProperties: false }), { minItems: 2, maxItems: 10 }),
  warnings: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 240 }), {
    maxItems: 20
  })),
  extractedConstraints: Type.Optional(Type.Object({
    durationMinutes: Type.Optional(Type.Integer({ minimum: 15, maximum: 1_440 })),
    startHint: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    endHint: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    roundTrip: Type.Optional(Type.Boolean()),
    mustInclude: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 20 })),
    avoid: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 20 })),
    preferences: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 20 }))
  }, { additionalProperties: false }))
}, { additionalProperties: false })

export type RouteAgentInput = {
  requestId: string
  sourceKind: 'prompt' | 'file'
  sourceText: string
  locale: 'zh-CN' | 'en'
  constraints: AiRouteConstraints
  pi: PiRuntime
  poi: PoiProvider
  optionSigningKey: string
  signal?: AbortSignal
}

export type RouteAgentOutput = {
  harnessVersion: string
  promptVersion: string
  candidates: AnalyzeCandidate[]
  normalizedConstraints: AiRouteConstraints
  proposedOrder: string[]
  warnings: string[]
  budget: ReturnType<RouteAgentBudget['snapshot']>
  state: RouteAgentStateMachine['state']
}

function textResult(value: unknown, details: unknown = value, terminate = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    details,
    ...(terminate ? { terminate: true } : {})
  }
}

function mergeTerms(...lists: Array<string[] | undefined>): string[] | undefined {
  const terms = [...new Set(lists.flatMap((list) => list ?? []).map((term) => term.trim()).filter(Boolean))]
  return terms.length ? terms : undefined
}

function mergeExtractedConstraints(
  requested: AiRouteConstraints,
  extracted: SubmittedRoutePlan['extractedConstraints']
): AiRouteConstraints {
  return {
    ...requested,
    durationMinutes: requested.durationMinutes ?? extracted.durationMinutes,
    startHint: requested.startHint ?? extracted.startHint,
    endHint: requested.endHint ?? extracted.endHint,
    roundTrip: requested.roundTrip ?? extracted.roundTrip,
    mustInclude: mergeTerms(requested.mustInclude, extracted.mustInclude),
    avoid: mergeTerms(requested.avoid, extracted.avoid),
    preferences: mergeTerms(requested.preferences, extracted.preferences)
  }
}

function matchesTerm(intent: PlaceIntent, term: string): boolean {
  const haystack = [
    intent.desiredName,
    ...intent.aliases,
    intent.categoryHint ?? ''
  ].join(' ').toLocaleLowerCase()
  return haystack.includes(term.toLocaleLowerCase())
}

export async function runRouteAgent(input: RouteAgentInput): Promise<RouteAgentOutput> {
  const budget = new RouteAgentBudget()
  const state = new RouteAgentStateMachine()
  state.transition('normalized')
  state.transition('constraints_extracted')
  let submitted: SubmittedRoutePlan | undefined
  let fatalToolError: AiRouteError | undefined

  const searchTool: AgentTool<typeof searchSchema> = {
    name: 'search_pois',
    label: 'Search trusted AMap POIs',
    description: 'Batch-search one or more POI names or categories inside the configured region. Put every independent search term in one queries array. Returns grouped opaque poiRef values and no coordinates.',
    parameters: searchSchema,
    executionMode: 'sequential',
    execute: async (_toolCallId, params, signal) => {
      try {
        const results = []
        for (const query of params.queries) {
          results.push({
            query,
            options: await input.poi.search(query, input.constraints.region, signal)
          })
        }
        return textResult({ results })
      } catch (error) {
        if (!(error instanceof AiRouteError)) throw error
        fatalToolError = error
        return textResult({ error: error.code }, { error: error.code }, true)
      }
    }
  }

  const detailTool: AgentTool<typeof detailSchema> = {
    name: 'get_poi_details',
    label: 'Inspect a trusted AMap POI',
    description: 'Inspect one opaque poiRef. This tool never returns coordinates.',
    parameters: detailSchema,
    executionMode: 'sequential',
    execute: async (_toolCallId, params) => {
      const poi = input.poi.resolveAgentRef(params.poiRef)
      if (!poi) throw new AiRouteError('AI_POI_NOT_FOUND', 404)
      return textResult({
        poiRef: params.poiRef,
        name: poi.name,
        category: poi.category,
        district: poi.district,
        displayAddress: poi.displayAddress
      })
    }
  }

  const submitTool: AgentTool<typeof submitSchema> = {
    name: 'submit_route_plan',
    label: 'Submit route intent plan',
    description: 'Required final action. Submit an ordered places array using only names and opaque poiRef values returned by search_pois. Coordinate fields are forbidden; IDs and route order are assigned by the server.',
    parameters: submitSchema,
    executionMode: 'sequential',
    execute: async (_toolCallId, params) => {
      const normalized = {
        places: params.places.map((place, index) => ({
          intent: {
            candidateId: `candidate-${index + 1}`,
            desiredName: place.desiredName,
            aliases: place.aliases ?? [],
            cityHint: input.constraints.region,
            ...(place.categoryHint ? { categoryHint: place.categoryHint } : {}),
            reason: place.reason ?? `Selected for the requested route: ${place.desiredName}`,
            evidence: 'Selected from trusted AMap search results.',
            priority: place.priority ?? 'preferred',
            ...(place.estimatedStayMinutes !== undefined
              ? { estimatedStayMinutes: place.estimatedStayMinutes }
              : {}),
            ...(place.preferredPeriod ? { preferredPeriod: place.preferredPeriod } : {})
          },
          poiRefs: place.poiRefs
        })),
        proposedOrder: params.places.map((_place, index) => `candidate-${index + 1}`),
        warnings: params.warnings ?? [],
        extractedConstraints: params.extractedConstraints ?? {}
      }
      const parsed = parseSubmittedRoutePlan(normalized, input.constraints.maximumStops)
      parsed.places.forEach((place) => {
        place.poiRefs.forEach((poiRef) => {
          if (!input.poi.resolveAgentRef(poiRef)) {
            throw new AiRouteError('AI_MODEL_OUTPUT_INVALID', 422)
          }
        })
      })
      const trustedPoiIds = parsed.places.map((place) =>
        input.poi.resolveAgentRef(place.poiRefs[0])?.poiId
      )
      if (trustedPoiIds.some((poiId) => !poiId) ||
          new Set(trustedPoiIds).size !== trustedPoiIds.length) {
        throw new AiRouteError('AI_MODEL_OUTPUT_INVALID', 422)
      }
      budget.assertFinalStopCount(parsed.places.length)
      submitted = parsed
      return textResult({ accepted: true }, { accepted: true }, true)
    }
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: buildRouteSystemPrompt(input.locale, input.constraints),
      model: input.pi.model,
      thinkingLevel: 'off',
      tools: [searchTool, detailTool, submitTool],
      messages: []
    },
    streamFn: input.pi.streamFn,
    getApiKey: input.pi.getApiKey,
    toolExecution: 'sequential',
    maxRetryDelayMs: 2_000,
    beforeToolCall: async ({ toolCall, args }) => {
      if (!TOOL_NAMES.has(toolCall.name)) return { block: true, reason: 'tool-not-allowed' }
      const searchUnits = toolCall.name === 'search_pois' &&
        args && typeof args === 'object' && 'queries' in args && Array.isArray(args.queries)
        ? args.queries.length
        : 1
      budget.consumeToolCall(toolCall.name, searchUnits)
      return undefined
    }
  })

  agent.subscribe((event) => {
    if (event.type === 'turn_start') budget.consumeModelTurn()
    if (event.type === 'turn_end' && event.message.role === 'assistant') {
      budget.consumeTokens(event.message.usage.totalTokens)
    }
  })

  const timeoutSignal = AbortSignal.timeout(DEFAULT_ROUTE_AGENT_LIMITS.analysisTimeoutMs)
  const runSignal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal
  const abort = () => agent.abort()
  runSignal.addEventListener('abort', abort, { once: true })
  try {
    await agent.prompt(wrapUntrustedSource(input.sourceKind, input.sourceText))
    if (fatalToolError) throw fatalToolError
    if (!submitted && !runSignal.aborted) {
      await agent.prompt(routeSubmissionRepairPrompt(input.constraints.maximumStops))
      if (fatalToolError) throw fatalToolError
    }
  } catch (error) {
    if (error instanceof AiRouteError) throw error
    if (runSignal.aborted) {
      throw new AiRouteError(input.signal?.aborted ? 'AI_ABORTED' : 'AI_TIMEOUT', input.signal?.aborted ? 499 : 504)
    }
    throw mapPiFailure(
      error instanceof Error ? error.message : undefined,
      undefined,
      input.pi.getLastResponseStatus()
    )
  } finally {
    runSignal.removeEventListener('abort', abort)
  }

  if (runSignal.aborted) {
    throw new AiRouteError(
      input.signal?.aborted ? 'AI_ABORTED' : 'AI_TIMEOUT',
      input.signal?.aborted ? 499 : 504
    )
  }

  const lastAssistant = [...agent.state.messages].reverse().find((message) => message.role === 'assistant')
  if (agent.state.errorMessage || (lastAssistant?.role === 'assistant' &&
      ['error', 'aborted', 'length'].includes(lastAssistant.stopReason))) {
    throw mapPiFailure(
      (lastAssistant?.role === 'assistant' ? lastAssistant.errorMessage : undefined) ?? agent.state.errorMessage,
      lastAssistant?.role === 'assistant' ? lastAssistant.stopReason : undefined,
      input.pi.getLastResponseStatus()
    )
  }
  if (!submitted) throw new AiRouteError('AI_MODEL_OUTPUT_INVALID', 422)

  const normalizedConstraints = mergeExtractedConstraints(
    input.constraints,
    submitted.extractedConstraints
  )
  const deterministicWarnings = [...submitted.warnings]
  const avoid = normalizedConstraints.avoid ?? []
  const filteredPlaces = submitted.places.filter((place) => {
    const avoided = avoid.some((term) => matchesTerm(place.intent, term))
    if (!avoided) return true
    if (place.intent.priority === 'required') {
      deterministicWarnings.push(`REQUIRED_AVOID_CONFLICT:${place.intent.desiredName}`)
      return true
    }
    deterministicWarnings.push(`AVOID_FILTERED:${place.intent.desiredName}`)
    return false
  })
  for (const term of normalizedConstraints.mustInclude ?? []) {
    const match = filteredPlaces.find((place) => matchesTerm(place.intent, term))
    if (match) match.intent.priority = 'required'
    else deterministicWarnings.push(`MUST_INCLUDE_MISSING:${term}`)
  }
  if (filteredPlaces.length < 2) throw new AiRouteError('AI_MODEL_OUTPUT_INVALID', 422)
  submitted.places = filteredPlaces
  submitted.proposedOrder = submitted.proposedOrder.filter((candidateId) =>
    filteredPlaces.some((place) => place.intent.candidateId === candidateId)
  )

  state.transition('poi_candidates')
  const candidates: AnalyzeCandidate[] = submitted.places.map((place) => {
    const trustedOptions = place.poiRefs.map((poiRef) => input.poi.resolveAgentRef(poiRef))
      .filter((poi): poi is NonNullable<typeof poi> => Boolean(poi))
    if (trustedOptions.length === 0) throw new AiRouteError('AI_MODEL_OUTPUT_INVALID', 422)
    const options = trustedOptions.map((poi) => ({
      optionRef: createOptionRef({
        analyzeRequestId: input.requestId,
        candidateId: place.intent.candidateId,
        poiId: poi.poiId,
        region: input.constraints.region
      }, input.optionSigningKey),
      poiName: poi.name,
      ...(poi.category ? { category: poi.category } : {}),
      ...(poi.district ? { district: poi.district } : {}),
      ...(poi.displayAddress ? { displayAddress: poi.displayAddress } : {}),
      wgs84: poi.wgs84
    }))
    return {
      candidateId: place.intent.candidateId,
      placeIntent: place.intent as PlaceIntent,
      confidence: options.length === 1 ? 'high' : options.length === 2 ? 'medium' : 'low',
      options,
      ...(options.length === 1 ? { selectedOptionRef: options[0].optionRef } : {}),
      requiresUserChoice: options.length !== 1
    }
  })
  state.transition(candidates.some((candidate) => candidate.requiresUserChoice)
    ? 'ambiguity_pending'
    : 'resolved')
  return {
    harnessVersion: AI_ROUTE_HARNESS_VERSION,
    promptVersion: AI_ROUTE_PROMPT_VERSION,
    candidates,
    normalizedConstraints,
    proposedOrder: submitted.proposedOrder,
    warnings: deterministicWarnings,
    budget: budget.snapshot(),
    state: state.state
  }
}
