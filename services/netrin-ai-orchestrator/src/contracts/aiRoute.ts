export const AI_ROUTE_CONTRACT_VERSION = '1.3.0'
export const AI_ROUTE_HARNESS_VERSION = 'netrin-route-agent/1.0.0'
export const AI_ROUTE_PROMPT_VERSION = 'route-authoring/1.0.0'

export const AI_ROUTE_ERROR_CODES = [
  'AI_ABORTED',
  'AI_AUTH_REQUIRED',
  'AI_PHONE_VERIFICATION_REQUIRED',
  'AI_ACCOUNT_UNAVAILABLE',
  'AI_ORIGIN_NOT_ALLOWED',
  'AI_METHOD_NOT_ALLOWED',
  'AI_REQUEST_TOO_LARGE',
  'AI_REQUEST_INVALID',
  'AI_REGION_REQUIRED',
  'AI_INPUT_NOT_SUPPORTED',
  'AI_FILE_TYPE_NOT_ALLOWED',
  'AI_FILE_MAGIC_MISMATCH',
  'AI_FILE_TOO_LARGE',
  'AI_FILE_LIMIT_EXCEEDED',
  'AI_FILE_ARCHIVE_UNSAFE',
  'AI_PDF_PAGE_LIMIT',
  'AI_PDF_TEXT_LAYER_REQUIRED',
  'AI_PROVIDER_ENDPOINT_INVALID',
  'AI_PROVIDER_ENDPOINT_BLOCKED',
  'AI_PROVIDER_NOT_ALLOWED',
  'AI_MODEL_NOT_ALLOWED',
  'AI_MODEL_CATALOG_UNAVAILABLE',
  'AI_MODEL_PROBE_REQUIRED',
  'AI_MODEL_PROBE_FAILED',
  'AI_MODEL_PROBE_EXPIRED',
  'AI_MODEL_TOOL_CALLING_REQUIRED',
  'AI_PROVIDER_AUTH_FAILED',
  'AI_PROVIDER_QUOTA_EXHAUSTED',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_PROVIDER_RESPONSE_INVALID',
  'AI_MODEL_OUTPUT_INVALID',
  'AI_BUDGET_EXHAUSTED',
  'AI_TIMEOUT',
  'AI_CONCURRENCY_LIMIT',
  'AI_RATE_LIMITED',
  'AI_POI_NOT_FOUND',
  'AI_POI_PROVIDER_UNAVAILABLE',
  'AI_OPTION_REF_INVALID',
  'AI_OPTION_REF_EXPIRED',
  'AI_ROUTE_UNREACHABLE',
  'AI_ROUTE_PROVIDER_UNAVAILABLE',
  'AI_INTERNAL_ERROR'
] as const

export type AiRouteErrorCode = (typeof AI_ROUTE_ERROR_CODES)[number]

export type AiRouteErrorResponse = {
  requestId: string
  error: {
    code: AiRouteErrorCode
    message: string
  }
}

export type ProviderCapabilities = {
  providerId: string
  displayName: string
  allowedModelIds: string[]
  modelSource: 'fixed'
  toolCalling: boolean
  maxContextTokens: number
  supportsThinking: boolean
}

export type ProviderModelDescriptor = {
  modelId: string
  displayName: string
  toolCalling: boolean | null
  contextTokens?: number
  source: 'provider' | 'manual'
}

export type CustomProviderPolicy = {
  enabled: boolean
  protocols: ['openai-chat-completions']
  httpsOnly: true
  defaultPortOnly: true
  publicDnsOnly: true
  customHeadersAllowed: false
}

export const AI_ROUTE_FILE_LIMITS = {
  documentBytes: 10 * 1024 * 1024,
  totalBytes: 10 * 1024 * 1024,
  maxPdfPages: 30,
  maxTextChars: 100_000
} as const

export type AiInputKind = 'prompt' | 'file'
export type AiInputSourceRef = { kind: 'file'; displayName: string }

export type AiInputSummary = {
  kind: AiInputKind
  sourceRefs: AiInputSourceRef[]
}

export type ProviderRegistryResponse = {
  contractVersion: string
  supportedInputKinds: AiInputKind[]
  fileLimits: typeof AI_ROUTE_FILE_LIMITS
  providers: ProviderCapabilities[]
  customProviderPolicy?: CustomProviderPolicy
}

export type ModelCatalogRequest = {
  providerId: 'custom-openai'
  baseUrl: string
  apiKey: string
}

export type ModelCatalogResponse = {
  contractVersion: string
  providerId: 'custom-openai'
  models: ProviderModelDescriptor[]
}

export type ProviderProbeRequest = {
  providerId: 'custom-openai'
  baseUrl: string
  modelId: string
  apiKey: string
}

export type ProviderProbeResponse = {
  contractVersion: string
  capabilityToken: string
  expiresAt: number
  capabilities: {
    toolCalling: true
    maxContextTokens: number
  }
}

export type TravelMode = 'walking' | 'cycling'
export type AiLocale = 'zh-CN' | 'en'
export type PlacePriority = 'required' | 'preferred' | 'optional'
export type Confidence = 'high' | 'medium' | 'low'
export type Coordinate = [number, number]

export type AiRouteConstraints = {
  region: string
  travelMode: TravelMode
  durationMinutes?: number
  maximumStops: number
  startHint?: string
  endHint?: string
  roundTrip?: boolean
  mustInclude?: string[]
  avoid?: string[]
  preferences?: string[]
}

export type AiProviderRequest =
  | {
      providerId: 'deepseek-cn' | 'qwen-cn' | 'kimi-cn'
      modelId: string
      apiKey: string
    }
  | {
      providerId: 'custom-openai'
      modelId: string
      apiKey: string
      baseUrl: string
      capabilityToken: string
    }

export type AnalyzeRequest = {
  provider: AiProviderRequest
  input:
    | { kind: 'prompt'; text: string }
    | {
        kind: 'file'
        extractedText: string
        sourceFiles: Array<{
          displayName: string
          mediaType: string
          byteSize: number
        }>
      }
  constraints: AiRouteConstraints
  locale: AiLocale
}

export type PlaceIntent = {
  candidateId: string
  desiredName: string
  aliases: string[]
  cityHint: string
  categoryHint?: string
  reason: string
  evidence: string
  priority: PlacePriority
  estimatedStayMinutes?: number
  preferredPeriod?: 'morning' | 'afternoon' | 'evening'
}

export type AnalyzeCandidateOption = {
  optionRef: string
  poiName: string
  category?: string
  district?: string
  displayAddress?: string
  wgs84: Coordinate
}

export type AnalyzeCandidate = {
  candidateId: string
  placeIntent: PlaceIntent
  confidence: Confidence
  options: AnalyzeCandidateOption[]
  selectedOptionRef?: string
  requiresUserChoice: boolean
}

export type AnalyzeResponse = {
  requestId: string
  harnessVersion: string
  promptVersion: string
  inputSummary: AiInputSummary
  normalizedConstraints: AiRouteConstraints
  candidates: AnalyzeCandidate[]
  proposedOrder: string[]
  warnings: string[]
}

export type PlanRequest = {
  analyzeRequestId: string
  constraints: AiRouteConstraints
  selectedStops: Array<{
    candidateId: string
    optionRef: string
    intent: {
      reason: string
      priority: PlacePriority
    }
    userLockedOrder?: number
    estimatedStayMinutes?: number
  }>
  proposedOrder: string[]
}

export type Wgs84LineString = {
  type: 'LineString'
  coordinates: Coordinate[]
}

export type PlannedStop = {
  candidateId: string
  name: string
  reason: string
  category?: string
  district?: string
  wgs84: Coordinate
  estimatedStayMinutes?: number
}

export type PlanResponse = {
  requestId: string
  stops: PlannedStop[]
  geometryCandidate?: Wgs84LineString
  geometrySource?: 'amap-planned'
  distanceMeters?: number
  walkingOrCyclingMinutes?: number
  totalEstimatedMinutes?: number
  warnings: string[]
  canConfirmGeometry: boolean
}
