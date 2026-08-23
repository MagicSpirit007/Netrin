export function aiRouteErrorMessageKey(code: string): string {
  if (code === 'AI_ABORTED') return 'cancelled'
  if (code === 'AI_AUTH_REQUIRED' || code === 'AI_ACCOUNT_UNAVAILABLE') return 'auth'
  if (code === 'AI_PHONE_VERIFICATION_REQUIRED') return 'phone'
  if (code === 'AI_PROVIDER_AUTH_FAILED') return 'providerAuth'
  if (code === 'AI_PROVIDER_ENDPOINT_INVALID' || code === 'AI_PROVIDER_ENDPOINT_BLOCKED') return 'endpoint'
  if (code === 'AI_MODEL_CATALOG_UNAVAILABLE') return 'catalog'
  if (code === 'AI_MODEL_PROBE_REQUIRED' || code === 'AI_MODEL_PROBE_FAILED' ||
      code === 'AI_MODEL_PROBE_EXPIRED') return 'probe'
  if (code === 'AI_PROVIDER_RESPONSE_INVALID') return 'providerResponse'
  if (code === 'AI_MODEL_OUTPUT_INVALID') return 'modelOutput'
  if (code === 'AI_PROVIDER_QUOTA_EXHAUSTED' || code === 'AI_RATE_LIMITED') return 'quota'
  if (code === 'AI_BUDGET_EXHAUSTED' || code === 'AI_TIMEOUT') return 'budget'
  if (code === 'AI_OPTION_REF_INVALID' || code === 'AI_OPTION_REF_EXPIRED') return 'expired'
  if (code === 'AI_POI_NOT_FOUND' || code === 'AI_POI_PROVIDER_UNAVAILABLE') return 'poi'
  if (code === 'AI_ROUTE_UNREACHABLE' || code === 'AI_ROUTE_PROVIDER_UNAVAILABLE') return 'route'
  if (code === 'AI_REQUEST_INVALID' || code === 'AI_REGION_REQUIRED' ||
      code === 'AI_REQUEST_TOO_LARGE' || code === 'AI_INPUT_NOT_SUPPORTED') return 'input'
  if (code === 'AI_PDF_TEXT_LAYER_REQUIRED') return 'pdfText'
  if (code.startsWith('AI_FILE_') || code === 'AI_PDF_PAGE_LIMIT') return 'file'
  if (code === 'AI_PROVIDER_UNAVAILABLE' || code === 'AI_CONCURRENCY_LIMIT') return 'unavailable'
  return 'generic'
}
