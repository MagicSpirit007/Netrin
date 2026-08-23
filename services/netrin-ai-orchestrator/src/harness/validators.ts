import {
  AI_ROUTE_FILE_LIMITS,
  type AiLocale,
  type AiRouteConstraints,
  type AnalyzeRequest,
  type ModelCatalogRequest,
  type PlaceIntent,
  type PlanRequest,
  type PlacePriority,
  type ProviderProbeRequest,
  type TravelMode
} from '../contracts/aiRoute.js'
import { AiRouteError } from '../errors.js'
import { normalizedCustomBaseUrl, validateCustomModelId } from '../providers/customEndpoint.js'
import { requireRegisteredProvider } from '../providers/registry.js'

const MAX_PROMPT_CHARS = 20_000
const MAX_API_KEY_CHARS = 4_096
const MAX_REGION_CHARS = 80
const MAX_SHORT_TEXT_CHARS = 240
const MAX_LIST_ITEMS = 20

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiRouteError('AI_REQUEST_INVALID', 400)
  }
  return value as JsonObject
}

function string(value: unknown, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new AiRouteError('AI_REQUEST_INVALID', 400)
  const normalized = value.normalize('NFC').trim()
  if ((!allowEmpty && !normalized) || normalized.length > maxLength) {
    throw new AiRouteError('AI_REQUEST_INVALID', 400)
  }
  return normalized
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  return value === undefined ? undefined : string(value, maxLength)
}

function displayFileName(value: unknown): string {
  const normalized = string(value, 160)
  const baseName = normalized.split(/[\\/]/).pop()?.trim()
  if (!baseName) throw new AiRouteError('AI_REQUEST_INVALID', 400)
  return baseName.slice(0, 160)
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw new AiRouteError('AI_REQUEST_INVALID', 400)
  }
  return value.map((item) => string(item, MAX_SHORT_TEXT_CHARS))
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new AiRouteError('AI_REQUEST_INVALID', 400)
  }
  return value as number
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AiRouteError('AI_REQUEST_INVALID', 400)
  }
  return value as T
}

function rejectCoordinateFields(value: JsonObject): void {
  const forbidden = new Set([
    'coordinate',
    'coordinates',
    'lat',
    'latitude',
    'lng',
    'lon',
    'longitude',
    'wgs84',
    'gcj02',
    'position'
  ])
  if (Object.keys(value).some((key) => forbidden.has(key.toLowerCase()))) {
    throw new AiRouteError('AI_MODEL_OUTPUT_INVALID', 422)
  }
}

export function parseConstraints(value: unknown): AiRouteConstraints {
  const raw = object(value)
  const region = string(raw.region, MAX_REGION_CHARS)
  if (!region) throw new AiRouteError('AI_REGION_REQUIRED', 400)
  const travelMode = enumValue<TravelMode>(raw.travelMode, ['walking', 'cycling'])
  const durationMinutes = raw.durationMinutes === undefined
    ? undefined
    : integer(raw.durationMinutes, 15, 1_440)
  return {
    region,
    travelMode,
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    maximumStops: integer(raw.maximumStops, 2, 10),
    ...(optionalString(raw.startHint, MAX_SHORT_TEXT_CHARS) ? {
      startHint: optionalString(raw.startHint, MAX_SHORT_TEXT_CHARS)
    } : {}),
    ...(optionalString(raw.endHint, MAX_SHORT_TEXT_CHARS) ? {
      endHint: optionalString(raw.endHint, MAX_SHORT_TEXT_CHARS)
    } : {}),
    ...(typeof raw.roundTrip === 'boolean' ? { roundTrip: raw.roundTrip } : {}),
    ...(stringList(raw.mustInclude) ? { mustInclude: stringList(raw.mustInclude) } : {}),
    ...(stringList(raw.avoid) ? { avoid: stringList(raw.avoid) } : {}),
    ...(stringList(raw.preferences) ? { preferences: stringList(raw.preferences) } : {})
  }
}

export type AnalyzeInputCapabilities = {
  fileEnabled?: boolean
  customProviderEnabled?: boolean
}

export function parseAnalyzeRequest(
  value: unknown,
  capabilities: AnalyzeInputCapabilities = {}
): AnalyzeRequest {
  const raw = object(value)
  const provider = object(raw.provider)
  const providerId = string(provider.providerId, 80)
  const modelId = validateCustomModelId(string(provider.modelId, 200))
  const apiKey = string(provider.apiKey, MAX_API_KEY_CHARS)
  let parsedProvider: AnalyzeRequest['provider']
  if (providerId === 'custom-openai') {
    if (!capabilities.customProviderEnabled) throw new AiRouteError('AI_PROVIDER_NOT_ALLOWED', 400)
    parsedProvider = {
      providerId,
      modelId,
      apiKey,
      baseUrl: normalizedCustomBaseUrl(string(provider.baseUrl, 512)),
      capabilityToken: string(provider.capabilityToken, 4_096)
    }
  } else if (['deepseek-cn', 'qwen-cn', 'kimi-cn'].includes(providerId)) {
    requireRegisteredProvider(providerId, modelId)
    parsedProvider = {
      providerId: providerId as 'deepseek-cn' | 'qwen-cn' | 'kimi-cn',
      modelId,
      apiKey
    }
  } else {
    throw new AiRouteError('AI_PROVIDER_NOT_ALLOWED', 400)
  }
  const input = object(raw.input)
  const kind = enumValue(input.kind, ['prompt', 'file'] as const)
  const locale = enumValue<AiLocale>(raw.locale, ['zh-CN', 'en'])
  let parsedInput: AnalyzeRequest['input']
  if (kind === 'prompt') {
    parsedInput = { kind, text: string(input.text, MAX_PROMPT_CHARS) }
  } else {
    if (!capabilities.fileEnabled) throw new AiRouteError('AI_INPUT_NOT_SUPPORTED', 400)
    if (input.imageRecognition !== undefined || input.imagePartIds !== undefined) {
      throw new AiRouteError('AI_REQUEST_INVALID', 400)
    }
    if (!Array.isArray(input.sourceFiles) || input.sourceFiles.length < 1 || input.sourceFiles.length > 12) {
      throw new AiRouteError('AI_REQUEST_INVALID', 400)
    }
    const sourceFiles = input.sourceFiles.map((value) => {
      const file = object(value)
      return {
        displayName: displayFileName(file.displayName),
        mediaType: string(file.mediaType, 120),
        byteSize: integer(file.byteSize, 0, AI_ROUTE_FILE_LIMITS.totalBytes)
      }
    })
    if (sourceFiles.reduce((sum, file) => sum + file.byteSize, 0) > AI_ROUTE_FILE_LIMITS.totalBytes) {
      throw new AiRouteError('AI_FILE_LIMIT_EXCEEDED', 400)
    }
    parsedInput = {
      kind,
      extractedText: string(input.extractedText, AI_ROUTE_FILE_LIMITS.maxTextChars, true),
      sourceFiles
    }
    if (!parsedInput.extractedText) throw new AiRouteError('AI_REQUEST_INVALID', 400)
  }
  return {
    provider: parsedProvider,
    input: parsedInput,
    constraints: parseConstraints(raw.constraints),
    locale
  }
}

export function parseModelCatalogRequest(
  value: unknown,
  capabilities: Pick<AnalyzeInputCapabilities, 'customProviderEnabled'>
): ModelCatalogRequest {
  const raw = object(value)
  const providerId = enumValue(raw.providerId, ['custom-openai'] as const)
  if (!capabilities.customProviderEnabled) throw new AiRouteError('AI_PROVIDER_NOT_ALLOWED', 400)
  return {
    providerId,
    baseUrl: normalizedCustomBaseUrl(string(raw.baseUrl, 512)),
    apiKey: string(raw.apiKey, MAX_API_KEY_CHARS)
  }
}

export function parseProviderProbeRequest(
  value: unknown,
  customProviderEnabled: boolean
): ProviderProbeRequest {
  if (!customProviderEnabled) throw new AiRouteError('AI_PROVIDER_NOT_ALLOWED', 400)
  const raw = object(value)
  if (raw.providerId !== 'custom-openai') {
    throw new AiRouteError('AI_REQUEST_INVALID', 400)
  }
  if (raw.vision !== undefined) throw new AiRouteError('AI_REQUEST_INVALID', 400)
  return {
    providerId: 'custom-openai',
    baseUrl: normalizedCustomBaseUrl(string(raw.baseUrl, 512)),
    modelId: validateCustomModelId(string(raw.modelId, 200)),
    apiKey: string(raw.apiKey, MAX_API_KEY_CHARS)
  }
}

export function parsePlaceIntent(value: unknown): PlaceIntent {
  const raw = object(value)
  rejectCoordinateFields(raw)
  const candidateId = string(raw.candidateId, 80)
  const desiredName = string(raw.desiredName, 160)
  const aliases = stringList(raw.aliases) ?? []
  const priority = enumValue<PlacePriority>(raw.priority, ['required', 'preferred', 'optional'])
  const estimatedStayMinutes = raw.estimatedStayMinutes === undefined
    ? undefined
    : integer(raw.estimatedStayMinutes, 0, 720)
  const preferredPeriod = raw.preferredPeriod === undefined
    ? undefined
    : enumValue(raw.preferredPeriod, ['morning', 'afternoon', 'evening'] as const)
  return {
    candidateId,
    desiredName,
    aliases,
    cityHint: string(raw.cityHint, MAX_REGION_CHARS),
    ...(optionalString(raw.categoryHint, 120) ? {
      categoryHint: optionalString(raw.categoryHint, 120)
    } : {}),
    reason: string(raw.reason, 500),
    evidence: string(raw.evidence, 500),
    priority,
    ...(estimatedStayMinutes !== undefined ? { estimatedStayMinutes } : {}),
    ...(preferredPeriod ? { preferredPeriod } : {})
  }
}

export type SubmittedRoutePlan = {
  places: Array<{
    intent: PlaceIntent
    poiRefs: string[]
  }>
  proposedOrder: string[]
  warnings: string[]
  extractedConstraints: {
    durationMinutes?: number
    startHint?: string
    endHint?: string
    roundTrip?: boolean
    mustInclude?: string[]
    avoid?: string[]
    preferences?: string[]
  }
}

export function parseSubmittedRoutePlan(value: unknown, maximumStops: number): SubmittedRoutePlan {
  const raw = object(value)
  rejectCoordinateFields(raw)
  if (!Array.isArray(raw.places) || raw.places.length < 2 || raw.places.length > maximumStops) {
    throw new AiRouteError('AI_MODEL_OUTPUT_INVALID', 422)
  }
  const places = raw.places.map((item) => {
    const place = object(item)
    rejectCoordinateFields(place)
    if (!Array.isArray(place.poiRefs) || place.poiRefs.length < 1 || place.poiRefs.length > 5) {
      throw new AiRouteError('AI_MODEL_OUTPUT_INVALID', 422)
    }
    return {
      intent: parsePlaceIntent(place.intent),
      poiRefs: place.poiRefs.map((ref) => string(ref, 120))
    }
  })
  if (!Array.isArray(raw.proposedOrder) || raw.proposedOrder.length !== places.length) {
    throw new AiRouteError('AI_MODEL_OUTPUT_INVALID', 422)
  }
  const candidateIds = new Set(places.map((place) => place.intent.candidateId))
  const proposedOrder = raw.proposedOrder.map((candidateId) => string(candidateId, 80))
  if (new Set(proposedOrder).size !== proposedOrder.length ||
      proposedOrder.some((candidateId) => !candidateIds.has(candidateId))) {
    throw new AiRouteError('AI_MODEL_OUTPUT_INVALID', 422)
  }
  const warnings = raw.warnings === undefined ? [] : stringList(raw.warnings) ?? []
  const extractedRaw = raw.extractedConstraints === undefined
    ? {}
    : object(raw.extractedConstraints)
  const durationMinutes = extractedRaw.durationMinutes === undefined
    ? undefined
    : integer(extractedRaw.durationMinutes, 15, 1_440)
  return {
    places,
    proposedOrder,
    warnings,
    extractedConstraints: {
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
      ...(optionalString(extractedRaw.startHint, MAX_SHORT_TEXT_CHARS)
        ? { startHint: optionalString(extractedRaw.startHint, MAX_SHORT_TEXT_CHARS) }
        : {}),
      ...(optionalString(extractedRaw.endHint, MAX_SHORT_TEXT_CHARS)
        ? { endHint: optionalString(extractedRaw.endHint, MAX_SHORT_TEXT_CHARS) }
        : {}),
      ...(typeof extractedRaw.roundTrip === 'boolean' ? { roundTrip: extractedRaw.roundTrip } : {}),
      ...(stringList(extractedRaw.mustInclude)
        ? { mustInclude: stringList(extractedRaw.mustInclude) }
        : {}),
      ...(stringList(extractedRaw.avoid) ? { avoid: stringList(extractedRaw.avoid) } : {}),
      ...(stringList(extractedRaw.preferences)
        ? { preferences: stringList(extractedRaw.preferences) }
        : {})
    }
  }
}

export function parsePlanRequest(value: unknown): PlanRequest {
  const raw = object(value)
  const constraints = parseConstraints(raw.constraints)
  if (!Array.isArray(raw.selectedStops) || raw.selectedStops.length < 2 ||
      raw.selectedStops.length > constraints.maximumStops) {
    throw new AiRouteError('AI_REQUEST_INVALID', 400)
  }
  const selectedStops = raw.selectedStops.map((item) => {
    const stop = object(item)
    const intent = object(stop.intent)
    const estimatedStayMinutes = stop.estimatedStayMinutes === undefined
      ? undefined
      : integer(stop.estimatedStayMinutes, 0, 720)
    const userLockedOrder = stop.userLockedOrder === undefined
      ? undefined
      : integer(stop.userLockedOrder, 0, constraints.maximumStops - 1)
    return {
      candidateId: string(stop.candidateId, 80),
      optionRef: string(stop.optionRef, 4_096),
      intent: {
        reason: string(intent.reason, 500),
        priority: enumValue<PlacePriority>(intent.priority, ['required', 'preferred', 'optional'])
      },
      ...(userLockedOrder !== undefined ? { userLockedOrder } : {}),
      ...(estimatedStayMinutes !== undefined ? { estimatedStayMinutes } : {})
    }
  })
  if (new Set(selectedStops.map((stop) => stop.candidateId)).size !== selectedStops.length) {
    throw new AiRouteError('AI_REQUEST_INVALID', 400)
  }
  if (!Array.isArray(raw.proposedOrder)) throw new AiRouteError('AI_REQUEST_INVALID', 400)
  const proposedOrder = raw.proposedOrder.map((candidateId) => string(candidateId, 80))
  return {
    analyzeRequestId: string(raw.analyzeRequestId, 120),
    constraints,
    selectedStops,
    proposedOrder
  }
}
