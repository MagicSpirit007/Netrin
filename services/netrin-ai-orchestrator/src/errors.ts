import type { AiRouteErrorCode, AiRouteErrorResponse } from './contracts/aiRoute.js'

export type ProviderFailureKind =
  | 'http-error'
  | 'completion-shape'
  | 'empty-completion'
  | 'tool-call-shape'
  | 'tool-arguments-json'
  | 'tool-arguments-shape'
  | 'finish-reason'
  | 'payload-build'
  | 'payload-transform'
  | 'payload-serialize'
  | 'response-json'
  | 'response-parse'
  | 'budget'
  | 'timeout'
  | 'transport'
  | 'unknown'

const SAFE_MESSAGES: Record<AiRouteErrorCode, string> = {
  AI_ABORTED: 'The request was cancelled.',
  AI_AUTH_REQUIRED: 'Authentication is required.',
  AI_PHONE_VERIFICATION_REQUIRED: 'Phone verification is required.',
  AI_ACCOUNT_UNAVAILABLE: 'The account cannot use AI route generation.',
  AI_ORIGIN_NOT_ALLOWED: 'The request origin is not allowed.',
  AI_METHOD_NOT_ALLOWED: 'The request method is not allowed.',
  AI_REQUEST_TOO_LARGE: 'The request is too large.',
  AI_REQUEST_INVALID: 'The request is invalid.',
  AI_REGION_REQUIRED: 'A city or region is required.',
  AI_INPUT_NOT_SUPPORTED: 'This input type is not available yet.',
  AI_FILE_TYPE_NOT_ALLOWED: 'This file type is not allowed.',
  AI_FILE_MAGIC_MISMATCH: 'The file contents do not match the declared file type.',
  AI_FILE_TOO_LARGE: 'A file is too large.',
  AI_FILE_LIMIT_EXCEEDED: 'The file input exceeds a processing limit.',
  AI_FILE_ARCHIVE_UNSAFE: 'The document archive is unsafe to process.',
  AI_PDF_PAGE_LIMIT: 'The PDF has too many pages.',
  AI_PDF_TEXT_LAYER_REQUIRED: 'The PDF has no extractable text layer.',
  AI_PROVIDER_ENDPOINT_INVALID: 'The provider endpoint is invalid.',
  AI_PROVIDER_ENDPOINT_BLOCKED: 'The provider endpoint is not allowed.',
  AI_PROVIDER_NOT_ALLOWED: 'The selected provider is not allowed.',
  AI_MODEL_NOT_ALLOWED: 'The selected model is not allowed.',
  AI_MODEL_CATALOG_UNAVAILABLE: 'The provider model catalog is unavailable.',
  AI_MODEL_PROBE_REQUIRED: 'The custom model must pass a compatibility test first.',
  AI_MODEL_PROBE_FAILED: 'The custom model failed the compatibility test.',
  AI_MODEL_PROBE_EXPIRED: 'The custom model compatibility test has expired.',
  AI_MODEL_TOOL_CALLING_REQUIRED: 'The selected model does not support tool calling.',
  AI_PROVIDER_AUTH_FAILED: 'The model provider rejected the API key.',
  AI_PROVIDER_QUOTA_EXHAUSTED: 'The model provider quota is unavailable.',
  AI_PROVIDER_UNAVAILABLE: 'The model provider is temporarily unavailable.',
  AI_PROVIDER_RESPONSE_INVALID: 'The model provider returned an invalid response.',
  AI_MODEL_OUTPUT_INVALID: 'The model returned an invalid route proposal.',
  AI_BUDGET_EXHAUSTED: 'The AI execution budget was exhausted.',
  AI_TIMEOUT: 'The request timed out.',
  AI_CONCURRENCY_LIMIT: 'Another AI request is already running.',
  AI_RATE_LIMITED: 'Too many requests were made.',
  AI_POI_NOT_FOUND: 'No matching place was found.',
  AI_POI_PROVIDER_UNAVAILABLE: 'The place provider is temporarily unavailable.',
  AI_OPTION_REF_INVALID: 'A place selection is invalid.',
  AI_OPTION_REF_EXPIRED: 'A place selection has expired.',
  AI_ROUTE_UNREACHABLE: 'One or more route segments could not be planned.',
  AI_ROUTE_PROVIDER_UNAVAILABLE: 'The route provider is temporarily unavailable.',
  AI_INTERNAL_ERROR: 'The request could not be completed.'
}

export class AiRouteError extends Error {
  readonly code: AiRouteErrorCode
  readonly status: number
  readonly upstreamStatus?: number
  readonly providerFailureKind?: ProviderFailureKind

  constructor(
    code: AiRouteErrorCode,
    status: number,
    upstreamStatus?: number,
    providerFailureKind?: ProviderFailureKind
  ) {
    super(SAFE_MESSAGES[code])
    this.name = 'AiRouteError'
    this.code = code
    this.status = status
    this.upstreamStatus = upstreamStatus
    this.providerFailureKind = providerFailureKind
  }
}

export function errorResponse(error: AiRouteError, requestId: string): AiRouteErrorResponse {
  return {
    requestId,
    error: {
      code: error.code,
      message: SAFE_MESSAGES[error.code]
    }
  }
}

export function asAiRouteError(error: unknown): AiRouteError {
  if (error instanceof AiRouteError) return error
  if (error instanceof Error && error.name === 'AbortError') {
    return new AiRouteError('AI_ABORTED', 499)
  }
  return new AiRouteError('AI_INTERNAL_ERROR', 500)
}
